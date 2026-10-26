import { COLORS } from './catalogue.ts';
import { ensure } from './engine.ts';
import type { Action } from './types.ts';
// Parse untrusted network commands before running the shared engine.
export function parseAction(raw: unknown): Action {
  ensure(raw && typeof raw === 'object' && !Array.isArray(raw), 'Invalid action.');
  const a = raw as Record<string, unknown>;
  ensure(
    [
      'start',
      'draw',
      'endTurn',
      'discard',
      'play',
      'respond',
      'pay',
      'move',
      'moveBuilding',
      'leave',
      'endGame',
    ].includes(a.type as string),
    'Unknown action.',
  );
  const allowed: Record<string, string[]> = {
    start: [],
    draw: [],
    endTurn: [],
    endGame: [],
    leave: [],
    discard: ['cardIds'],
    pay: ['cardIds'],
    respond: ['block'],
    move: ['cardId', 'fromGroupId', 'color', 'toGroupId'],
    moveBuilding: ['cardId', 'toGroupId'],
    play: [
      'cardId',
      'mode',
      'color',
      'groupId',
      'targetPlayerId',
      'targetGroupId',
      'targetCardId',
      'giveGroupId',
      'giveCardId',
      'boostIds',
    ],
  };
  ensure(
    Object.keys(a).every((k) => k === 'type' || allowed[a.type as string].includes(k)),
    'Unexpected action field.',
  );
  for (const k of [
    'cardId',
    'fromGroupId',
    'toGroupId',
    'groupId',
    'targetPlayerId',
    'targetGroupId',
    'targetCardId',
    'giveGroupId',
    'giveCardId',
  ])
    if (a[k] !== undefined)
      ensure(typeof a[k] === 'string' && (a[k] as string).length <= 100, 'Invalid card or target.');
  for (const k of ['cardIds', 'boostIds'])
    if (a[k] !== undefined)
      ensure(
        Array.isArray(a[k]) &&
          (a[k] as unknown[]).length <= 106 &&
          (a[k] as unknown[]).every((x) => typeof x === 'string' && x.length < 100),
        'Invalid card selection.',
      );
  if (a.type === 'play')
    ensure(
      typeof a.cardId === 'string' && ['bank', 'property', 'action'].includes(a.mode as string),
      'Choose a card and use.',
    );
  if (a.type === 'move' || a.color !== undefined)
    ensure(COLORS.includes(a.color as any), 'Invalid colour.');
  if (a.type === 'move')
    ensure(
      typeof a.cardId === 'string' && typeof a.fromGroupId === 'string',
      'Choose a wildcard and source.',
    );
  if (a.type === 'moveBuilding')
    ensure(
      typeof a.cardId === 'string' && typeof a.toGroupId === 'string',
      'Choose a building and destination.',
    );
  if (a.type === 'respond') ensure(typeof a.block === 'boolean', 'Invalid response.');
  if (a.type === 'pay' || a.type === 'discard') ensure(Array.isArray(a.cardIds), 'Choose cards.');
  return a as unknown as Action;
}
