import { describe, it, expect } from 'vitest';
import { CARDS, DECK, SETS, COLORS, card, type Effect } from '../src/game/catalogue';
import {
  createGame,
  execute,
  viewFor,
  assertConservation,
  complete,
  completed,
  choices,
  botAction,
  payableAssets,
} from '../src/game/engine';
import type { GameState, Group, Action } from '../src/game/types';
const property = (name: string) => DECK.find((c) => c.name === name)!.id;
const effect = (e: Effect, n = 0) => DECK.filter((c) => c.effect === e)[n].id;
const money = (n: number, index = 0) =>
  DECK.filter((c) => c.kind === 'money' && c.value === n)[index].id;
const group = (id: string, color: Group['color'], names: string[]): Group => ({
  id,
  color,
  cards: names.map(property),
});
function fixture(n = 2) {
  const s = createGame(
    'game',
    'ABCDE',
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, avatar: '🦭' })),
  );
  s.stage = 'play';
  s.nextGroup = 100;
  return s;
}
function sync(s: GameState) {
  const occupied = s.players.flatMap((p) => [
    ...p.hand,
    ...p.bank,
    ...p.reserve,
    ...p.groups.flatMap((g) => [
      ...g.cards,
      ...(g.house ? [g.house] : []),
      ...(g.hotel ? [g.hotel] : []),
    ]),
  ]);
  s.deck = DECK.map((c) => c.id).filter((id) => !occupied.includes(id) && !s.discard.includes(id));
  assertConservation(s);
  return s;
}
function play(s: GameState, id: string, props: Record<string, unknown> = {}) {
  return execute(s, 'p0', { type: 'play', mode: 'action', cardId: id, ...props } as Action);
}
function accept(s: GameState) {
  return execute(s, s.pending!.responder, { type: 'respond', block: false });
}
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
describe('catalogue', () => {
  it('contains 106 playable cards with canonical distributions', () => {
    expect(DECK).toHaveLength(106);
    expect(new Set(DECK.map((c) => c.id)).size).toBe(106);
    expect(DECK.filter((c) => c.kind === 'property')).toHaveLength(28);
    expect(DECK.filter((c) => c.kind === 'wild')).toHaveLength(11);
    expect(DECK.filter((c) => c.kind === 'money')).toHaveLength(20);
    expect(DECK.filter((c) => c.kind === 'action')).toHaveLength(34);
    expect(DECK.filter((c) => c.kind === 'rent')).toHaveLength(13);
  });
  it('uses the source game’s locations and full set sizes', () => {
    expect(SETS.yellow.places).toEqual(['Congo', 'Meringo', 'Tuross']);
    expect(SETS.green.places).toEqual(['Kianga', 'Dalmeny', 'Wagonga Inlet']);
    for (const color of COLORS)
      expect(DECK.filter((c) => c.kind === 'property' && c.colors![0] === color)).toHaveLength(
        SETS[color].size,
      );
  });
});
describe('turn lifecycle and visibility', () => {
  it('deals five to each player, uses injected randomness, and preserves input', () => {
    const s = createGame('g', 'ABCDE', [
      { id: 'p0', name: 'A', avatar: '🦭' },
      { id: 'p1', name: 'B', avatar: '🐋' },
    ]);
    const next = execute(s, 'p0', { type: 'start' }, seeded(10));
    expect(s.stage).toBe('lobby');
    expect(next.players.map((p) => p.hand.length)).toEqual([5, 5]);
    expect(next.deck).toHaveLength(96);
    expect(next.stage).toBe('draw');
    assertConservation(next);
    expect(execute(s, 'p0', { type: 'start' }, seeded(10))).toEqual(next);
  });
  it('never gives a player another hand or deck order', () => {
    const s = sync(fixture());
    s.players[1].hand = [s.deck.pop()!];
    const v = viewFor(s, 'p0');
    expect(v).not.toHaveProperty('deck');
    expect(v).not.toHaveProperty('discard');
    expect(v.players[1]).not.toHaveProperty('hand');
    expect(JSON.stringify(v)).not.toContain(s.players[1].hand[0]);
    expect(v.players[1].handCount).toBe(1);
  });
  it('draws five for an empty hand and rejects repeat draws', () => {
    let s = sync(fixture());
    s.stage = 'draw';
    s = execute(s, 'p0', { type: 'draw' });
    expect(s.players[0].hand).toHaveLength(5);
    expect(() => execute(s, 'p0', { type: 'draw' })).toThrow();
  });
  it('draws two for a nonempty hand', () => {
    const s = fixture();
    s.stage = 'draw';
    s.players[0].hand = [money(1)];
    const next = execute(sync(s), 'p0', { type: 'draw' });
    expect(next.players[0].hand).toHaveLength(3);
    assertConservation(next);
  });
  it('enforces plays and discard-to-seven', () => {
    let s = fixture();
    s.players[0].hand = DECK.filter((c) => c.kind === 'money')
      .slice(0, 11)
      .map((c) => c.id);
    sync(s);
    for (let i = 0; i < 3; i++) s = play(s, s.players[0].hand[0], { mode: 'bank' });
    expect(() => play(s, s.players[0].hand[0], { mode: 'bank' })).toThrow('three plays');
    s = execute(s, 'p0', { type: 'endTurn' });
    expect(s.stage).toBe('discard');
    expect(() => execute(s, 'p0', { type: 'discard', cardIds: [] })).toThrow();
    s = execute(s, 'p0', { type: 'discard', cardIds: [s.players[0].hand[0]] });
    expect(s.stage).toBe('draw');
    expect(s.turn).toBe(1);
    assertConservation(s);
  });
  it('rejects out-of-turn moves, unknown cards and foreign cards', () => {
    const s = sync(fixture());
    expect(() => execute(s, 'p1', { type: 'endTurn' })).toThrow('not your turn');
    expect(() => play(s, 'fake')).toThrow();
    expect(() => execute(s, 'intruder', { type: 'draw' })).toThrow('not in this game');
  });
  it('recycles the discard when empty and tolerates no cards available', () => {
    const s = fixture();
    s.stage = 'draw';
    s.players[1].hand = DECK.slice(1).map((c) => c.id);
    s.deck = [];
    s.discard = [DECK[0].id];
    const next = execute(s, 'p0', { type: 'draw' });
    expect(next.players[0].hand).toHaveLength(1);
    expect(next.discard).toEqual([]);
    assertConservation(next);
  });
});
describe('property, rent and buildings', () => {
  it('plays properties and forbids banking them', () => {
    const s = fixture();
    s.players[0].hand = [property('Nelligen')];
    sync(s);
    expect(() => play(s, s.players[0].hand[0], { mode: 'bank' })).toThrow();
    const next = play(s, s.players[0].hand[0], { mode: 'property', color: 'brown' });
    expect(next.players[0].groups[0].cards).toEqual([property('Nelligen')]);
    assertConservation(next);
  });
  it('moves wildcards for free even after three plays and releases buildings from broken sets', () => {
    const s = fixture();
    const wild = DECK.find((c) => c.kind === 'wild' && c.colors?.includes('brown'))!.id;
    s.players[0].groups = [
      {
        id: 'g1',
        color: 'brown',
        cards: [property('Nelligen'), wild],
        house: effect('house'),
        hotel: effect('hotel'),
      },
    ];
    s.plays = 3;
    sync(s);
    const next = execute(s, 'p0', {
      type: 'move',
      cardId: wild,
      fromGroupId: 'g1',
      color: 'lightBlue',
    });
    expect(next.plays).toBe(3);
    expect(next.players[0].reserve).toHaveLength(2);
    expect(next.players[0].groups[0].house).toBeUndefined();
    assertConservation(next);
    expect(choices(viewFor(s, 'p0')).some((a) => a.type === 'move')).toBe(true);
  });
  it('requires a named property for a completed set', () => {
    const wilds = DECK.filter((c) => c.kind === 'wild' && c.colors!.includes('brown'))
      .slice(0, 2)
      .map((c) => c.id);
    expect(complete({ id: 'g', color: 'brown', cards: wilds })).toBe(false);
  });
  it('requires a full colour set and a shack before a resort', () => {
    const s = fixture();
    s.players[0].groups = [group('g1', 'brown', ['Nelligen', 'Long Beach'])];
    s.players[0].hand = [effect('house'), effect('hotel')];
    sync(s);
    expect(() => play(s, effect('hotel'), { groupId: 'g1' })).toThrow();
    let next = play(s, effect('house'), { groupId: 'g1' });
    next = play(next, effect('hotel'), { groupId: 'g1' });
    expect(next.players[0].groups[0].hotel).toBe(effect('hotel'));
    assertConservation(next);
  });
  it('cannot build on hardware or utilities', () => {
    const s = fixture();
    s.players[0].groups = [group('g1', 'utility', ['Eurobodalla Shire Water', 'Essential Energy'])];
    s.players[0].hand = [effect('house')];
    sync(s);
    expect(() => play(s, effect('house'), { groupId: 'g1' })).toThrow();
  });
  it('charges paired rent to all opponents with separate responses and boosters counted as plays', () => {
    const s = fixture(3);
    s.players[0].groups = [group('g1', 'brown', ['Nelligen', 'Long Beach'])];
    const rentId = DECK.find(
      (c) => c.kind === 'rent' && c.colors?.length === 2 && c.colors[0] === 'brown',
    )!.id;
    const boosts = DECK.filter((c) => c.effect === 'doubleRent').map((c) => c.id);
    s.players[0].hand = [rentId, ...boosts];
    sync(s);
    let next = play(s, rentId, { groupId: 'g1', boostIds: boosts });
    expect(next.plays).toBe(3);
    expect(next.pending?.amount).toBe(8);
    next = accept(next);
    next = execute(next, 'p1', { type: 'pay', cardIds: [] });
    expect(next.pending?.responder).toBe('p2');
    next = accept(next);
    next = execute(next, 'p2', { type: 'pay', cardIds: [] });
    expect(next.pending).toBeUndefined();
    expect(next.stage).toBe('play');
    assertConservation(next);
  });
  it('requires a target for any-colour rent', () => {
    const s = fixture();
    const id = DECK.find((c) => c.kind === 'rent' && c.colors?.length === 10)!.id;
    s.players[0].hand = [id];
    s.players[0].groups = [group('g1', 'brown', ['Nelligen'])];
    sync(s);
    expect(() => play(s, id, { groupId: 'g1' })).toThrow('another player');
    expect(play(s, id, { groupId: 'g1', targetPlayerId: 'p1' }).pending?.targets).toEqual(['p1']);
  });
});
describe('responses and payments', () => {
  it('resolves counter-block chains and protects actions until accepted', () => {
    const s = fixture();
    s.players[0].hand = [effect('debt'), effect('no', 0)];
    s.players[1].hand = [effect('no', 1)];
    sync(s);
    let next = play(s, effect('debt'), { targetPlayerId: 'p1' });
    expect(() => execute(next, 'p0', { type: 'endTurn' })).toThrow();
    next = execute(next, 'p1', { type: 'respond', block: true });
    expect(next.pending?.blocked).toBe(true);
    next = execute(next, 'p0', { type: 'respond', block: true });
    next = execute(next, 'p1', { type: 'respond', block: false });
    expect(next.stage).toBe('payment');
    expect(next.plays).toBe(1);
    assertConservation(next);
  });
  it('allows a block to stand without a counter', () => {
    const s = fixture();
    s.players[0].hand = [effect('debt')];
    s.players[1].hand = [effect('no')];
    sync(s);
    let next = play(s, effect('debt'), { targetPlayerId: 'p1' });
    next = execute(next, 'p1', { type: 'respond', block: true });
    next = execute(next, 'p0', { type: 'respond', block: false });
    expect(next.pending).toBeUndefined();
    expect(next.stage).toBe('play');
    assertConservation(next);
  });
  it('rejects hand payments, duplicate assets and underpayments; never gives change', () => {
    const s = fixture();
    s.players[0].hand = [effect('debt')];
    s.players[1].bank = [money(10), money(1)];
    s.players[1].hand = [money(5)];
    sync(s);
    let next = accept(play(s, effect('debt'), { targetPlayerId: 'p1' }));
    expect(() => execute(next, 'p1', { type: 'pay', cardIds: [money(5)] })).toThrow();
    expect(() => execute(next, 'p1', { type: 'pay', cardIds: [money(1), money(1)] })).toThrow();
    expect(() => execute(next, 'p1', { type: 'pay', cardIds: [money(1)] })).toThrow();
    next = execute(next, 'p1', { type: 'pay', cardIds: [money(10)] });
    expect(next.players[0].bank).toEqual([money(10)]);
    expect(next.players[1].bank).toEqual([money(1)]);
    assertConservation(next);
  });
  it('takes all available assets when insolvent without elimination', () => {
    const s = fixture();
    s.players[0].hand = [effect('debt')];
    s.players[1].bank = [money(1)];
    sync(s);
    let next = accept(play(s, effect('debt'), { targetPlayerId: 'p1' }));
    next = execute(next, 'p1', { type: 'pay', cardIds: [money(1)] });
    expect(next.players).toHaveLength(2);
    expect(next.players[1].bank).toHaveLength(0);
    assertConservation(next);
  });
  it('keeps banked actions as money and transfers properties to collections', () => {
    const s = fixture();
    s.players[0].hand = [effect('debt')];
    s.players[1].bank = [effect('house')];
    s.players[1].groups = [group('g1', 'brown', ['Nelligen', 'Long Beach'])];
    sync(s);
    let next = accept(play(s, effect('debt'), { targetPlayerId: 'p1' }));
    next = execute(next, 'p1', {
      type: 'pay',
      cardIds: [effect('house'), property('Nelligen'), property('Long Beach')],
    });
    expect(next.players[0].bank).toContain(effect('house'));
    expect(next.players[0].reserve).toHaveLength(0);
    expect(next.players[0].groups[0].cards).toHaveLength(2);
    assertConservation(next);
  });
  it('does not permit zero-value rainbow wildcards as payment', () => {
    const s = fixture();
    s.players[0].groups = [
      {
        id: 'g',
        color: 'brown',
        cards: [DECK.find((c) => c.kind === 'wild' && c.value === 0)!.id],
      },
    ];
    expect(payableAssets(s.players[0])).toHaveLength(0);
  });
});
describe('steals, swaps and victory', () => {
  it('protects complete sets from Sly Deal and takes incomplete property', () => {
    const s = fixture();
    s.players[0].hand = [effect('steal')];
    s.players[1].groups = [group('g1', 'brown', ['Nelligen', 'Long Beach'])];
    sync(s);
    expect(() =>
      play(s, effect('steal'), {
        targetPlayerId: 'p1',
        targetGroupId: 'g1',
        targetCardId: property('Nelligen'),
      }),
    ).toThrow('protected');
    s.players[1].groups[0].cards.pop();
    sync(s);
    const next = accept(
      play(s, effect('steal'), {
        targetPlayerId: 'p1',
        targetGroupId: 'g1',
        targetCardId: property('Nelligen'),
      }),
    );
    expect(next.players[0].groups[0].cards).toContain(property('Nelligen'));
    assertConservation(next);
  });
  it('swaps two incomplete properties atomically', () => {
    const s = fixture();
    s.players[0].hand = [effect('swap')];
    s.players[0].groups = [group('g1', 'brown', ['Nelligen'])];
    s.players[1].groups = [group('g2', 'orange', ['Broulee'])];
    sync(s);
    const next = accept(
      play(s, effect('swap'), {
        targetPlayerId: 'p1',
        targetGroupId: 'g2',
        targetCardId: property('Broulee'),
        giveGroupId: 'g1',
        giveCardId: property('Nelligen'),
      }),
    );
    expect(next.players[0].groups[0].cards).toContain(property('Broulee'));
    expect(next.players[1].groups[0].cards).toContain(property('Nelligen'));
    assertConservation(next);
  });
  it('transfers buildings with a takeover and wins after the response', () => {
    const s = fixture();
    s.players[0].hand = [effect('takeSet')];
    s.players[0].groups = [
      group('g1', 'utility', ['Eurobodalla Shire Water', 'Essential Energy']),
      group('g2', 'darkBlue', ['Australia Rock', 'Montague Island (Baranguba)']),
    ];
    s.players[1].groups = [
      { ...group('g3', 'brown', ['Nelligen', 'Long Beach']), house: effect('house') },
    ];
    sync(s);
    let next = play(s, effect('takeSet'), { targetPlayerId: 'p1', targetGroupId: 'g3' });
    expect(next.winner).toBeUndefined();
    next = accept(next);
    expect(next.stage).toBe('finished');
    expect(next.winner).toBe('p0');
    expect(next.players[0].groups[2].house).toBe(effect('house'));
    assertConservation(next);
  });
  it('counts different colours rather than duplicate completed sets', () => {
    const s = fixture();
    s.players[0].groups = [
      group('g1', 'brown', ['Nelligen', 'Long Beach']),
      group('g2', 'brown', ['Nelligen', 'Long Beach']),
    ];
    expect(completed(s.players[0])).toBe(1);
  });
  it('does not award an off-turn win received as payment', () => {
    const s = fixture();
    s.turn = 1;
    s.players[0].hand = [effect('debt')];
    s.players[0].groups = [
      group('g1', 'brown', ['Nelligen', 'Long Beach']),
      group('g2', 'utility', ['Eurobodalla Shire Water', 'Essential Energy']),
      group('g3', 'darkBlue', ['Australia Rock', 'Montague Island (Baranguba)']),
    ];
    sync(s);
    s.stage = 'draw';
    const next = execute(s, 'p1', { type: 'draw' });
    expect(next.winner).toBeUndefined();
  });
});
describe('bot games and invariants', () => {
  for (const count of [2, 5])
    it(`finishes complete ${count}-player games without illegal moves or lost cards`, () => {
      for (let seed = 1; seed <= 8; seed++) {
        const rng = seeded(seed);
        let s = createGame(
          'g',
          'ABCDE',
          Array.from({ length: count }, (_, i) => ({
            id: `p${i}`,
            name: `Bot ${i}`,
            avatar: '🐦',
            isBot: true,
          })),
        );
        s = execute(s, 'p0', { type: 'start' }, rng);
        let steps = 0;
        while (s.stage !== 'finished' && steps++ < 2500) {
          const id = s.pending?.responder ?? s.players[s.turn].id;
          const a = botAction(viewFor(s, id));
          expect(a).toBeDefined();
          s = execute(s, id, a!, rng);
          assertConservation(s);
        }
        expect(s.winner, `seed ${seed}, ${steps} steps`).toBeDefined();
      }
    });
  it('all generated commands are accepted from a normal playable position', () => {
    const rng = seeded(55);
    let s = createGame('g', 'ABCDE', [
      { id: 'p0', name: 'A', avatar: '🦭' },
      { id: 'p1', name: 'B', avatar: '🐋' },
    ]);
    s = execute(s, 'p0', { type: 'start' }, rng);
    for (let i = 0; i < 150 && s.stage !== 'finished'; i++) {
      const id = s.pending?.responder ?? s.players[s.turn].id;
      const v = viewFor(s, id);
      for (const a of choices(v)) expect(() => execute(s, id, a, rng)).not.toThrow();
      s = execute(s, id, botAction(v)!, rng);
    }
  });
});
