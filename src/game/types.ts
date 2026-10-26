import type { Color } from './catalogue.ts';
export interface Group {
  id: string;
  color: Color;
  cards: string[];
  house?: string;
  hotel?: string;
}
export interface Player {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  hand: string[];
  bank: string[];
  groups: Group[];
  reserve: string[];
}
export type Stage = 'lobby' | 'draw' | 'play' | 'response' | 'payment' | 'discard' | 'finished';
export interface Pending {
  actor: string;
  effect: 'rent' | 'debt' | 'birthday' | 'steal' | 'swap' | 'takeSet';
  targets: string[];
  index: number;
  responder: string;
  blocked: boolean;
  amount?: number;
  targetGroupId?: string;
  targetCardId?: string;
  giveGroupId?: string;
  giveCardId?: string;
}
export interface GameState {
  id: string;
  code: string;
  version: number;
  hostId: string;
  players: Player[];
  deck: string[];
  discard: string[];
  stage: Stage;
  turn: number;
  plays: number;
  pending?: Pending;
  winner?: string;
  endedReason?: string;
  events: { id: number; text: string }[];
  nextGroup: number;
}
export interface PublicPlayer extends Omit<Player, 'hand'> {
  handCount: number;
}
export interface PlayerView extends Omit<GameState, 'players' | 'deck' | 'discard'> {
  players: PublicPlayer[];
  you: string;
  hand: string[];
  deckCount: number;
  discardCount: number;
  discardTop?: string;
}
export type Action =
  | { type: 'start' }
  | { type: 'draw' }
  | { type: 'endTurn' }
  | { type: 'discard'; cardIds: string[] }
  | {
      type: 'play';
      cardId: string;
      mode: 'bank' | 'property' | 'action';
      color?: Color;
      groupId?: string;
      targetPlayerId?: string;
      targetGroupId?: string;
      targetCardId?: string;
      giveGroupId?: string;
      giveCardId?: string;
      boostIds?: string[];
    }
  | { type: 'respond'; block: boolean }
  | { type: 'pay'; cardIds: string[] }
  | { type: 'move'; cardId: string; fromGroupId: string; color: Color; toGroupId?: string }
  | { type: 'moveBuilding'; cardId: string; toGroupId: string }
  | { type: 'leave'; connectedIds?: string[] }
  | { type: 'endGame' };
export interface GameCommand {
  gameId: string;
  requestId: string;
  expectedVersion: number;
  action: Action;
}
