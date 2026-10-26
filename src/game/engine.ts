import { card, COLORS, DECK, SETS, type Color } from './catalogue.ts';
import type { Action, GameState, Group, Pending, Player, PlayerView } from './types.ts';
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const complete = (g: Group) =>
  g.cards.length === SETS[g.color].size && g.cards.some((id) => card(id).kind === 'property');
export const completed = (p: Pick<Player, 'groups'>) =>
  new Set(p.groups.filter(complete).map((g) => g.color)).size;
export const rent = (g: Group) =>
  (SETS[g.color].rent[g.cards.length - 1] ?? 0) + (g.house ? 3 : 0) + (g.hotel ? 4 : 0);
export function createGame(
  id: string,
  code: string,
  people: { id: string; name: string; avatar: string; isBot?: boolean }[],
): GameState {
  ensure(people.length >= 1 && people.length <= 5, 'A table holds up to five players.');
  ensure(new Set(people.map((p) => p.id)).size === people.length, 'Duplicate player.');
  return {
    id,
    code,
    version: 0,
    hostId: people[0].id,
    players: people.map((p) => ({
      ...p,
      isBot: !!p.isBot,
      hand: [],
      bank: [],
      groups: [],
      reserve: [],
    })),
    deck: DECK.map((c) => c.id),
    discard: [],
    stage: 'lobby',
    turn: 0,
    plays: 0,
    events: [],
    nextGroup: 1,
  };
}
export function viewFor(s: GameState, id: string): PlayerView {
  const me = s.players.find((p) => p.id === id);
  ensure(me, 'You are not in this game.');
  const { deck, discard, players, ...rest } = s;
  return {
    ...structuredClone(rest),
    players: players.map(({ hand, ...p }) => ({ ...structuredClone(p), handCount: hand.length })),
    you: id,
    hand: [...me.hand],
    deckCount: deck.length,
    discardCount: discard.length,
    discardTop: discard.at(-1),
  };
}
function log(s: GameState, text: string) {
  s.events.push({ id: (s.events.at(-1)?.id ?? 0) + 1, text });
  s.events = s.events.slice(-80);
}
function draw(s: GameState, p: Player, n: number, rng: () => number) {
  for (let i = 0; i < n; i++) {
    if (!s.deck.length) {
      s.deck = shuffle(s.discard, rng);
      s.discard = [];
    }
    if (!s.deck.length) break;
    p.hand.push(s.deck.pop()!);
  }
}
function remove(a: string[], id: string) {
  const i = a.indexOf(id);
  ensure(i >= 0, 'That card is not available.');
  a.splice(i, 1);
}
function group(p: Pick<Player, 'groups'>, id?: string) {
  const g = p.groups.find((g) => g.id === id);
  ensure(g, 'Choose an available property group.');
  return g;
}
function newGroup(s: GameState, p: Player, color: Color) {
  const g: Group = { id: `g${s.nextGroup++}`, color, cards: [] };
  p.groups.push(g);
  return g;
}
function place(s: GameState, p: Player, id: string, color: Color, groupId?: string) {
  ensure(COLORS.includes(color) && card(id).colors?.includes(color), 'Choose a matching colour.');
  const g = groupId ? group(p, groupId) : newGroup(s, p, color);
  ensure(
    g.color === color && g.cards.length < SETS[color].size,
    'That group is full or has a different colour.',
  );
  g.cards.push(id);
}
function receive(s: GameState, p: Player, id: string, color?: Color) {
  const c = card(id);
  if (c.kind === 'property' || c.kind === 'wild') {
    const col = color ?? c.colors![0];
    const g = p.groups.find((g) => g.color === col && g.cards.length < SETS[col].size);
    place(s, p, id, col, g?.id);
  } else if (c.effect === 'house' || c.effect === 'hotel') p.reserve.push(id);
  else p.bank.push(id);
}
function tidy(p: Player) {
  for (const g of p.groups) {
    if (!complete(g)) {
      if (g.house) p.reserve.push(g.house);
      if (g.hotel) p.reserve.push(g.hotel);
      delete g.house;
      delete g.hotel;
    }
  }
  p.groups = p.groups.filter((g) => g.cards.length > 0);
}
function winner(s: GameState) {
  if (s.pending || s.stage === 'lobby' || s.stage === 'finished') return;
  const p = s.players[s.turn];
  if (completed(p) >= 3) {
    s.winner = p.id;
    s.stage = 'finished';
    log(s, `${p.name} collected three coastal sets and wins!`);
  }
}
function nextTarget(s: GameState) {
  const q = s.pending!;
  q.index++;
  if (q.index >= q.targets.length) {
    delete s.pending;
    s.stage = 'play';
    winner(s);
  } else {
    q.responder = q.targets[q.index];
    q.blocked = false;
    s.stage = 'response';
  }
}
function finishResponse(s: GameState) {
  const q = s.pending!;
  const target = s.players.find((p) => p.id === q.targets[q.index])!;
  const actor = s.players.find((p) => p.id === q.actor)!;
  if (q.blocked) {
    log(s, `${target.name} blocked ${actor.name}’s action.`);
    nextTarget(s);
    return;
  }
  if (q.effect === 'rent' || q.effect === 'debt' || q.effect === 'birthday') {
    s.stage = 'payment';
    q.responder = target.id;
    return;
  }
  const tg = group(target, q.targetGroupId);
  if (q.effect === 'takeSet') {
    removeGroup(target, tg.id);
    actor.groups.push(tg);
    log(s, `${actor.name} took ${target.name}’s ${SETS[tg.color].name} set.`);
  } else {
    const taken = q.targetCardId!;
    remove(tg.cards, taken);
    if (q.effect === 'swap') {
      const gg = group(actor, q.giveGroupId);
      remove(gg.cards, q.giveCardId!);
      receive(s, target, q.giveCardId!, gg.color);
    }
    receive(s, actor, taken, tg.color);
    tidy(actor);
    tidy(target);
    log(
      s,
      `${actor.name} ${q.effect === 'swap' ? 'swapped for' : 'picked up'} ${card(taken).name}.`,
    );
  }
  nextTarget(s);
}
function removeGroup(p: Player, id: string) {
  p.groups = p.groups.filter((g) => g.id !== id);
}
export function payableAssets(p: Pick<Player, 'bank' | 'groups' | 'reserve'>): string[] {
  return [
    ...p.bank,
    ...p.reserve,
    ...p.groups.flatMap((g) => [
      ...g.cards,
      ...(g.house ? [g.house] : []),
      ...(g.hotel ? [g.hotel] : []),
    ]),
  ].filter((id) => card(id).value > 0);
}
function withdraw(p: Player, id: string): Color | undefined {
  if (p.bank.includes(id)) {
    remove(p.bank, id);
    return;
  }
  if (p.reserve.includes(id)) {
    remove(p.reserve, id);
    return;
  }
  for (const g of p.groups) {
    if (g.cards.includes(id)) {
      remove(g.cards, id);
      return g.color;
    }
    if (g.house === id) {
      delete g.house;
      if (g.hotel) {
        p.reserve.push(g.hotel);
        delete g.hotel;
      }
      return;
    }
    if (g.hotel === id) {
      delete g.hotel;
      return;
    }
  }
  throw new Error('You do not own that asset.');
}
function attach(p: Player, id: string, g: Group) {
  ensure(
    complete(g) && g.color !== 'hardware' && g.color !== 'utility',
    'Buildings need a complete coastal colour set.',
  );
  if (card(id).effect === 'house') {
    ensure(!g.house, 'This set already has a shack.');
    g.house = id;
  } else {
    ensure(
      card(id).effect === 'hotel' && g.house && !g.hotel,
      'A resort needs a shack and no existing resort.',
    );
    g.hotel = id;
  }
}
export function execute(
  state: GameState,
  actorId: string,
  a: Action,
  rng: () => number = Math.random,
): GameState {
  const s = structuredClone(state);
  const p = s.players.find((p) => p.id === actorId);
  ensure(p, 'You are not in this game.');
  ensure(s.stage !== 'finished', 'This game has ended.');
  if (a.type === 'endGame') {
    ensure(actorId === s.hostId, 'Only the host can end this game.');
    s.stage = 'finished';
    s.endedReason = 'The host ended this table.';
    log(s, s.endedReason);
  } else if (a.type === 'leave') {
    if (s.stage === 'lobby') {
      s.players = s.players.filter((x) => x.id !== actorId);
      ensure(s.players.length, 'The last player must end the room.');
      if (s.hostId === actorId) s.hostId = s.players[0].id;
    } else {
      ensure(
        actorId === s.hostId,
        'Only the host can leave a live table without ending it. Reconnect to resume your seat.',
      );
      const next = s.players.find(
        (x) => x.id !== actorId && !x.isBot && a.connectedIds?.includes(x.id),
      );
      ensure(next, 'No connected player can take ownership. End the table instead.');
      s.hostId = next.id;
      log(s, `${next.name} is now the host. ${p.name}’s seat is waiting for them.`);
    }
  } else if (a.type === 'start') {
    ensure(s.stage === 'lobby' && actorId === s.hostId, 'Only the host can start a waiting table.');
    ensure(s.players.length >= 2, 'At least two players are needed.');
    s.deck = shuffle(
      DECK.map((c) => c.id),
      rng,
    );
    for (const pl of s.players) draw(s, pl, 5, rng);
    s.turn = Math.floor(rng() * s.players.length);
    s.stage = 'draw';
    log(s, `Welcome to the coast. ${s.players[s.turn].name} goes first.`);
  } else if (a.type === 'respond') {
    ensure(s.stage === 'response' && s.pending?.responder === actorId, 'It is not your response.');
    if (a.block) {
      const id = p.hand.find((id) => card(id).effect === 'no');
      ensure(id, 'You need a Yeah, Nah! card.');
      remove(p.hand, id);
      s.discard.push(id);
      s.pending.blocked = !s.pending.blocked;
      s.pending.responder =
        s.pending.responder === s.pending.actor
          ? s.pending.targets[s.pending.index]
          : s.pending.actor;
      log(s, `${p.name}: Yeah, Nah!`);
    } else finishResponse(s);
  } else if (a.type === 'pay') {
    ensure(s.stage === 'payment' && s.pending?.responder === actorId, 'It is not your payment.');
    const assets = payableAssets(p);
    ensure(
      new Set(a.cardIds).size === a.cardIds.length && a.cardIds.every((id) => assets.includes(id)),
      'Choose only your payable assets, once each.',
    );
    const total = a.cardIds.reduce((n, id) => n + card(id).value, 0),
      available = assets.reduce((n, id) => n + card(id).value, 0);
    ensure(
      total >= Math.min(available, s.pending.amount!),
      `Pay at least ${Math.min(available, s.pending.amount!)}M, or all you have.`,
    );
    const recipient = s.players.find((x) => x.id === s.pending!.actor)!;
    // Banked action cards stay money when transferred.
    for (const id of a.cardIds) {
      const banked = p.bank.includes(id);
      const col = withdraw(p, id);
      if (banked) recipient.bank.push(id);
      else receive(s, recipient, id, col);
    }
    tidy(p);
    log(
      s,
      `${p.name} paid ${total}M to ${recipient.name}${total > s.pending.amount! ? ' (no change)' : ''}.`,
    );
    nextTarget(s);
  } else {
    ensure(s.players[s.turn]?.id === actorId, 'It is not your turn.');
    if (a.type === 'draw') {
      ensure(s.stage === 'draw', 'You have already drawn this turn.');
      const n = p.hand.length === 0 ? 5 : 2;
      const before = p.hand.length;
      draw(s, p, n, rng);
      s.plays = 0;
      s.stage = 'play';
      log(s, `${p.name} drew ${p.hand.length - before} cards.`);
      winner(s);
    } else if (a.type === 'discard') {
      ensure(s.stage === 'discard', 'No discard is due.');
      ensure(
        a.cardIds.length === p.hand.length - 7 && new Set(a.cardIds).size === a.cardIds.length,
        'Discard exactly enough to keep seven cards.',
      );
      for (const id of a.cardIds) {
        remove(p.hand, id);
        s.discard.push(id);
      }
      advance(s);
    } else {
      ensure(s.stage === 'play', 'Resolve the current action first.');
      if (a.type === 'endTurn') {
        if (p.hand.length > 7) s.stage = 'discard';
        else advance(s);
      } else if (a.type === 'move') {
        const g = group(p, a.fromGroupId);
        ensure(
          card(a.cardId).kind === 'wild' && g.cards.includes(a.cardId),
          'Only a wildcard in your collection can move.',
        );
        remove(g.cards, a.cardId);
        place(s, p, a.cardId, a.color, a.toGroupId);
        tidy(p);
        log(s, `${p.name} rearranged a coastal connection.`);
        winner(s);
      } else if (a.type === 'moveBuilding') {
        const source = p.groups.find((g) => g.house === a.cardId || g.hotel === a.cardId);
        ensure(p.reserve.includes(a.cardId) || source, 'Choose a building you own.');
        if (source) {
          if (source.house === a.cardId) {
            ensure(!source.hotel, 'Move the resort before its shack.');
            delete source.house;
          } else delete source.hotel;
        } else remove(p.reserve, a.cardId);
        attach(p, a.cardId, group(p, a.toGroupId));
        log(s, `${p.name} moved ${card(a.cardId).name}.`);
      } else if (a.type === 'play') {
        ensure(s.plays < 3, 'You have used all three plays.');
        ensure(p.hand.includes(a.cardId), 'That card is not in your hand.');
        const c = card(a.cardId);
        const boosts = a.boostIds ?? [];
        ensure(
          new Set(boosts).size === boosts.length &&
            boosts.every(
              (id) => p.hand.includes(id) && card(id).effect === 'doubleRent' && id !== a.cardId,
            ),
          'Choose available rent boosters.',
        );
        ensure(
          !boosts.length || (c.effect === 'rent' && a.mode === 'action'),
          'Boosters must accompany rent.',
        );
        ensure(s.plays + 1 + boosts.length <= 3, 'Rent and each booster use one play.');
        if (a.mode === 'bank') {
          ensure(
            c.kind === 'money' || c.kind === 'action' || c.kind === 'rent',
            'Properties cannot go in the bank.',
          );
          p.bank.push(c.id);
        } else if (a.mode === 'property') {
          ensure(c.kind === 'property' || c.kind === 'wild', 'Choose a property card.');
          place(s, p, c.id, a.color ?? c.colors![0], a.groupId);
        } else {
          ensure(
            c.effect && c.effect !== 'no' && c.effect !== 'doubleRent',
            'This card must be banked or used in a response/rent combination.',
          );
          if (c.effect === 'draw2') draw(s, p, 2, rng);
          else if (c.effect === 'house' || c.effect === 'hotel')
            attach(p, c.id, group(p, a.groupId));
          else {
            let targets: string[] = [];
            let amount: number | undefined;
            if (c.effect === 'rent') {
              const g = group(p, a.groupId);
              ensure(
                c.colors!.includes(g.color) && g.cards.length > 0,
                'Choose a matching property group.',
              );
              amount = rent(g) * 2 ** boosts.length;
              targets =
                c.colors!.length === 10
                  ? [a.targetPlayerId!]
                  : s.players.filter((x) => x.id !== actorId).map((x) => x.id);
            } else if (c.effect === 'birthday') {
              amount = 2;
              targets = s.players.filter((x) => x.id !== actorId).map((x) => x.id);
            } else {
              targets = [a.targetPlayerId!];
              if (c.effect === 'debt') amount = 5;
            }
            ensure(
              targets.length > 0 &&
                targets.every((id) => id !== actorId && s.players.some((x) => x.id === id)),
              'Choose another player.',
            );
            if (c.effect === 'steal' || c.effect === 'swap' || c.effect === 'takeSet') {
              const target = s.players.find((x) => x.id === targets[0])!;
              const tg = group(target, a.targetGroupId);
              ensure(
                c.effect === 'takeSet' ? complete(tg) : !complete(tg),
                c.effect === 'takeSet' ? 'Choose a complete set.' : 'Complete sets are protected.',
              );
              if (c.effect !== 'takeSet')
                ensure(tg.cards.includes(a.targetCardId!), 'Choose a property in that group.');
              if (c.effect === 'swap') {
                const gg = group(p, a.giveGroupId);
                ensure(
                  !complete(gg) && gg.cards.includes(a.giveCardId!),
                  'Offer a property from your incomplete sets.',
                );
              }
            }
            s.pending = {
              actor: actorId,
              effect: c.effect as Pending['effect'],
              targets,
              index: 0,
              responder: targets[0],
              blocked: false,
              amount,
              targetGroupId: a.targetGroupId,
              targetCardId: a.targetCardId,
              giveGroupId: a.giveGroupId,
              giveCardId: a.giveCardId,
            };
            s.stage = 'response';
          }
          if (c.effect !== 'house' && c.effect !== 'hotel') s.discard.push(c.id);
        }
        remove(p.hand, c.id);
        for (const id of boosts) {
          remove(p.hand, id);
          s.discard.push(id);
        }
        s.plays += 1 + boosts.length;
        log(
          s,
          `${p.name} ${a.mode === 'bank' ? 'banked' : a.mode === 'property' ? 'collected' : 'played'} ${c.name}${boosts.length ? ` with ${boosts.length} rent booster${boosts.length > 1 ? 's' : ''}` : ''}.`,
        );
        winner(s);
      } else throw new Error('Unknown action.');
    }
  }
  s.version++;
  return s;
}
function advance(s: GameState) {
  s.turn = (s.turn + 1) % s.players.length;
  s.stage = 'draw';
  s.plays = 0;
}
// Generate choices from a player view only, so bots and UI never need hidden information.
export function choices(v: PlayerView): Action[] {
  const p = v.players.find((p) => p.id === v.you)!;
  const actions: Action[] = [];
  if (v.stage === 'response' && v.pending?.responder === v.you) {
    return [
      { type: 'respond', block: false },
      ...(v.hand.some((id) => card(id).effect === 'no')
        ? [{ type: 'respond', block: true } as Action]
        : []),
    ];
  }
  if (v.stage === 'payment' && v.pending?.responder === v.you) {
    const assets = payableAssets(p).sort((a, b) => card(a).value - card(b).value);
    let sum = 0;
    const ids: string[] = [];
    for (const id of assets) {
      if (sum >= v.pending.amount!) break;
      ids.push(id);
      sum += card(id).value;
    }
    return [{ type: 'pay', cardIds: ids }];
  }
  if (v.players[v.turn]?.id !== v.you) return [];
  if (v.stage === 'draw') return [{ type: 'draw' }];
  if (v.stage === 'discard')
    return [
      {
        type: 'discard',
        cardIds: [...v.hand]
          .sort((a, b) => discardScore(a) - discardScore(b))
          .slice(0, v.hand.length - 7),
      },
    ];
  if (v.stage !== 'play') return [];
  actions.push({ type: 'endTurn' });
  for (const from of p.groups)
    for (const id of from.cards.filter((id) => card(id).kind === 'wild'))
      for (const color of card(id).colors!) {
        if (color !== from.color)
          actions.push({ type: 'move', cardId: id, fromGroupId: from.id, color });
        for (const to of p.groups.filter(
          (g) => g.id !== from.id && g.color === color && g.cards.length < SETS[color].size,
        ))
          actions.push({ type: 'move', cardId: id, fromGroupId: from.id, color, toGroupId: to.id });
      }
  for (const id of [
    ...p.reserve,
    ...p.groups.flatMap((g) => [
      ...(g.hotel ? [g.hotel] : []),
      ...(g.house && !g.hotel ? [g.house] : []),
    ]),
  ])
    for (const g of p.groups.filter(
      (g) =>
        complete(g) &&
        !['hardware', 'utility'].includes(g.color) &&
        (card(id).effect === 'house' ? !g.house : g.house && !g.hotel),
    ))
      actions.push({ type: 'moveBuilding', cardId: id, toGroupId: g.id });
  if (v.plays >= 3) return actions;
  for (const id of v.hand) {
    const c = card(id);
    const base = { type: 'play' as const, cardId: id, mode: 'action' as const };
    if (c.kind === 'property' || c.kind === 'wild') {
      for (const color of c.colors!) {
        actions.push({ ...base, mode: 'property', color });
        for (const g of p.groups.filter(
          (g) => g.color === color && g.cards.length < SETS[color].size,
        ))
          actions.push({ ...base, mode: 'property', color, groupId: g.id });
      }
      continue;
    }
    actions.push({ ...base, mode: 'bank' });
    if (c.effect === 'draw2' || c.effect === 'birthday') actions.push(base);
    if (c.effect === 'house' || c.effect === 'hotel')
      for (const g of p.groups.filter(
        (g) =>
          complete(g) &&
          !['hardware', 'utility'].includes(g.color) &&
          (c.effect === 'house' ? !g.house : g.house && !g.hotel),
      ))
        actions.push({ ...base, groupId: g.id });
    if (c.effect === 'rent')
      for (const g of p.groups.filter((g) => c.colors!.includes(g.color))) {
        const targets =
          c.colors!.length === 10
            ? v.players.filter((x) => x.id !== v.you).map((x) => x.id)
            : [undefined];
        const boosterIds = v.hand
          .filter((b) => card(b).effect === 'doubleRent')
          .slice(0, 2 - v.plays);
        for (const targetPlayerId of targets)
          for (let n = 0; n <= boosterIds.length; n++)
            actions.push({
              ...base,
              groupId: g.id,
              targetPlayerId,
              boostIds: boosterIds.slice(0, n),
            });
      }
    for (const other of v.players.filter((x) => x.id !== v.you)) {
      if (c.effect === 'debt') actions.push({ ...base, targetPlayerId: other.id });
      if (c.effect === 'steal' || c.effect === 'swap' || c.effect === 'takeSet')
        for (const g of other.groups) {
          if (c.effect === 'takeSet') {
            if (complete(g))
              actions.push({ ...base, targetPlayerId: other.id, targetGroupId: g.id });
          } else if (!complete(g))
            for (const targetCardId of g.cards) {
              const b = { ...base, targetPlayerId: other.id, targetGroupId: g.id, targetCardId };
              if (c.effect === 'steal') actions.push(b);
              else
                for (const give of p.groups.filter((g) => !complete(g)))
                  for (const giveCardId of give.cards)
                    actions.push({ ...b, giveGroupId: give.id, giveCardId });
            }
        }
    }
  }
  return actions;
}
function discardScore(id: string) {
  const c = card(id);
  return c.kind === 'money'
    ? c.value
    : c.effect === 'doubleRent'
      ? 2
      : c.kind === 'property'
        ? 6
        : c.kind === 'wild'
          ? 8
          : c.effect === 'no'
            ? 9
            : c.effect === 'takeSet'
              ? 10
              : 4;
}
export function botAction(v: PlayerView): Action | undefined {
  const options = choices(v);
  const me = v.players.find((p) => p.id === v.you)!;
  const score = (a: Action) => {
    if (a.type === 'move') {
      const from = me.groups.find((g) => g.id === a.fromGroupId)!;
      const to = me.groups.find((g) => g.id === a.toGroupId);
      const potential = (g: Group) =>
        g.cards.some((id) => card(id).kind === 'property')
          ? g.cards.length ** 2 + (complete(g) ? 100 : 0)
          : 0;
      const remaining = { ...from, cards: from.cards.filter((id) => id !== a.cardId) };
      const destination: Group = to
        ? { ...to, cards: [...to.cards, a.cardId] }
        : { id: 'new', color: a.color, cards: [a.cardId] };
      const gain =
        potential(remaining) + potential(destination) - potential(from) - (to ? potential(to) : 0);
      return gain > 0 ? 45 + gain : -200;
    }
    if (a.type === 'respond')
      return a.block
        ? v.pending?.effect === 'takeSet'
          ? 100
          : v.pending?.effect === 'steal'
            ? 65
            : v.pending?.amount! >= 4
              ? 55
              : 0
        : 30;
    if (a.type !== 'play')
      return a.type === 'endTurn'
        ? -100
        : a.type === 'moveBuilding'
          ? me.reserve.includes(a.cardId)
            ? 45
            : -200
          : 100;
    const c = card(a.cardId);
    const target = a.targetPlayerId ? v.players.find((p) => p.id === a.targetPlayerId) : undefined;
    const danger = target ? completed(target) * 5 : 0;
    if (a.mode === 'bank')
      return (
        4 +
        (me.bank.reduce((n, id) => n + card(id).value, 0) < 5 ? 12 : 0) +
        c.value -
        (c.effect === 'no' ? 10 : 0) -
        (c.kind === 'wild' ? 10 : 0)
      );
    if (a.mode === 'property') {
      const g = me.groups.find((g) => g.id === a.groupId);
      return (
        35 +
        (g ? g.cards.length * 9 : 0) +
        (g && g.cards.length + 1 === SETS[g.color].size ? 30 : 0)
      );
    }
    return c.effect === 'takeSet'
      ? 100 + danger
      : c.effect === 'steal'
        ? 60 +
          danger +
          (a.targetCardId &&
          me.groups.some((g) => g.color === card(a.targetCardId!).colors?.[0] && !complete(g))
            ? 10
            : 0)
        : c.effect === 'swap'
          ? 20 + danger
          : c.effect === 'draw2'
            ? 25
            : c.effect === 'rent'
              ? 30 +
                rent(me.groups.find((g) => g.id === a.groupId)!) * (1 + (a.boostIds?.length ?? 0))
              : c.effect === 'house' || c.effect === 'hotel'
                ? 40
                : 23;
  };
  return options.sort((a, b) => score(b) - score(a))[0];
}
export function assertConservation(s: GameState) {
  const ids = [
    ...s.deck,
    ...s.discard,
    ...s.players.flatMap((p) => [
      ...p.hand,
      ...p.bank,
      ...p.reserve,
      ...p.groups.flatMap((g) => [
        ...g.cards,
        ...(g.house ? [g.house] : []),
        ...(g.hotel ? [g.hotel] : []),
      ]),
    ]),
  ];
  ensure(
    ids.length === DECK.length &&
      new Set(ids).size === DECK.length &&
      ids.every((id) => DECK.some((c) => c.id === id)),
    'Card conservation failed.',
  );
}
