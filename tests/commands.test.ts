import { describe, it, expect } from 'vitest';
import { parseAction } from '../src/game/commands';
describe('untrusted command parsing', () => {
  it('accepts a minimal legitimate play', () =>
    expect(parseAction({ type: 'play', cardId: 'c001', mode: 'property', color: 'brown' })).toEqual(
      { type: 'play', cardId: 'c001', mode: 'property', color: 'brown' },
    ));
  it.each([
    null,
    [],
    {},
    'draw',
    { type: 'invent' },
    { type: 'play', cardId: 'c001', mode: 'cheat' },
    { type: 'respond', block: 'false' },
    { type: 'pay', cardIds: 'c001' },
    { type: 'pay', cardIds: [{ id: 'c001' }] },
    { type: 'move', cardId: 'c001', fromGroupId: 'g1', color: 'purple' },
    { type: 'leave', connectedIds: ['forged-player'] },
    { type: 'endTurn', actorId: 'another-player' },
    { type: 'draw', state_data: { winner: 'me' } },
    { type: 'start', deck: ['c001'] },
    { type: 'moveBuilding' },
  ])('rejects malformed or authority-bearing payload %j', (raw) =>
    expect(() => parseAction(raw)).toThrow(),
  );
});
