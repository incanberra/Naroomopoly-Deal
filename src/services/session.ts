import { createClient } from '@supabase/supabase-js';
import { createGame, execute, viewFor } from '../game/engine';
import type { Action, GameState, PlayerView } from '../game/types';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const onlineReady = !!url && !!key;
export const supabase = onlineReady ? createClient(url, key) : null;
export interface Session {
  mode: 'local' | 'online';
  gameId: string;
  playerId: string;
  code: string;
}
const SESSION = 'naroomopoly-deal.session.v1',
  LOCAL = 'naroomopoly-deal.practice.v1';
export const AVATARS = ['🦭', '🦘', '🐦', '🐋', '🚐'];
export function savedSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION) ?? 'null');
  } catch {
    return null;
  }
}
export function forgetSession() {
  localStorage.removeItem(SESSION);
}
let local: GameState | null = null;
export function readPractice() {
  if (!local) {
    try {
      local = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
    } catch {
      local = null;
    }
  }
  return local;
}
function saveLocal(s: GameState) {
  local = s;
  localStorage.setItem(LOCAL, JSON.stringify(s));
}
function saveSession(s: Session) {
  localStorage.setItem(SESSION, JSON.stringify(s));
  if (s.mode === 'online') localStorage.setItem('deal.last-online', JSON.stringify(s));
  return s;
}
export function lastOnline(): Session | null {
  try {
    return JSON.parse(localStorage.getItem('deal.last-online') ?? 'null');
  } catch {
    return null;
  }
}
export function practice(name: string, avatar: string, bots: number) {
  const id = crypto.randomUUID(),
    playerId = crypto.randomUUID();
  const names = ['Kangaroo Keith', 'Penny Pelican', 'Willy Whale', 'Kombi Kim'];
  const avatars = ['🦘', '🐦', '🐋', '🚐'];
  let s = createGame(id, 'LOCAL', [
    { id: playerId, name, avatar },
    ...names
      .slice(0, bots)
      .map((name, i) => ({ id: `bot-${i}`, name, avatar: avatars[i], isBot: true })),
  ]);
  s = execute(s, playerId, { type: 'start' });
  saveLocal(s);
  return saveSession({ mode: 'local', gameId: id, playerId, code: 'LOCAL' });
}
async function auth() {
  if (!supabase)
    throw new Error('Online play needs Supabase configuration. Practice is available now.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user!.id;
}
async function call(body: Record<string, unknown>) {
  await auth();
  const { data, error } = await supabase!.functions.invoke('deal', { body });
  if (error) {
    let message = error.message;
    try {
      const details = await (error as any).context?.json();
      message = details?.error ?? message;
    } catch {
      /* keep transport error */
    }
    throw new RemoteError(message, (error as { context?: Response }).context?.status);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
class RemoteError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
export async function createRoom(name: string, avatar: string) {
  const data = await call({ operation: 'create', name, avatar });
  return saveSession(data.session);
}
export async function joinRoom(code: string, name: string, avatar: string) {
  const data = await call({ operation: 'join', code: code.trim().toUpperCase(), name, avatar });
  return saveSession(data.session);
}
export async function fetchView(s: Session): Promise<PlayerView> {
  if (s.mode === 'local') {
    const state = readPractice();
    if (!state || state.id !== s.gameId)
      throw new Error('Your saved practice table is unavailable.');
    return viewFor(state, s.playerId);
  }
  await auth();
  // A refresh after a lost response reuses the persisted request, never a new move.
  await recoverPending(s.gameId);
  const { data, error } = await supabase!
    .from('deal_views')
    .select('view_data')
    .eq('game_id', s.gameId)
    .single();
  if (error) throw error;
  return data.view_data;
}
const PENDING = 'deal.pending-command.v1';
interface PendingCommand {
  key: string;
  gameId: string;
  requestId: string;
  expectedVersion: number;
  action: Action;
}
function pendingCommand(): PendingCommand | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING) ?? 'null');
  } catch {
    return null;
  }
}
async function submitPending(p: PendingCommand) {
  try {
    const result = await call({
      operation: 'command',
      gameId: p.gameId,
      requestId: p.requestId,
      expectedVersion: p.expectedVersion,
      action: p.action,
    });
    if (pendingCommand()?.requestId === p.requestId) localStorage.removeItem(PENDING);
    return result;
  } catch (error) {
    // A definite rejection did not commit; transport failures retain the envelope for safe retry.
    if (
      error instanceof RemoteError &&
      error.status &&
      error.status >= 400 &&
      error.status < 500 &&
      pendingCommand()?.requestId === p.requestId
    )
      localStorage.removeItem(PENDING);
    throw error;
  }
}
async function recoverPending(gameId: string) {
  const pending = pendingCommand();
  if (pending?.gameId !== gameId) return;
  try {
    await submitPending(pending);
  } catch (error) {
    if (!(
      error instanceof RemoteError &&
      error.status &&
      error.status >= 400 &&
      error.status < 500
    ))
      throw error;
  }
}
export async function sendAction(s: Session, v: PlayerView, a: Action): Promise<PlayerView | null> {
  if (s.mode === 'local') {
    const state = readPractice()!;
    const next = execute(state, s.playerId, a);
    saveLocal(next);
    return viewFor(next, s.playerId);
  }
  const actionKey = JSON.stringify({ gameId: s.gameId, a });
  let pending = pendingCommand();
  if (pending?.gameId === s.gameId && pending.key !== actionKey) {
    await recoverPending(s.gameId);
    pending = null;
  }
  if (pending?.key !== actionKey)
    pending = {
      key: actionKey,
      gameId: s.gameId,
      requestId: crypto.randomUUID(),
      expectedVersion: v.version,
      action: a,
    };
  localStorage.setItem(PENDING, JSON.stringify(pending));
  const data = await submitPending(pending);
  return data.view;
}
export function runBot(s: Session, botId: string, a: Action): PlayerView {
  const next = execute(readPractice()!, botId, a);
  saveLocal(next);
  return viewFor(next, s.playerId);
}
export function subscribe(s: Session, onChange: () => void, onStatus: (state: string) => void) {
  if (s.mode === 'local' || !supabase) return () => {};
  const channel = supabase
    .channel(`deal-view:${s.gameId}:${s.playerId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'deal_views', filter: `game_id=eq.${s.gameId}` },
      onChange,
    )
    .subscribe((status) => {
      onStatus(status === 'SUBSCRIBED' ? 'connected' : 'reconnecting');
      if (status === 'SUBSCRIBED') onChange();
    });
  return () => {
    void supabase!.removeChannel(channel);
  };
}
export async function heartbeat(s: Session) {
  if (s.mode === 'online') await call({ operation: 'heartbeat', gameId: s.gameId });
}
