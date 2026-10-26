import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, viewFor } from '../src/game/engine';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), single: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'p0' } } } }) },
    functions: { invoke: mocks.invoke },
    from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }),
  }),
}));
const session = { mode: 'online' as const, gameId: 'g', playerId: 'p0', code: 'ABCDE' };
const view = viewFor(
  createGame('g', 'ABCDE', [
    { id: 'p0', name: 'A', avatar: '🦭' },
    { id: 'p1', name: 'B', avatar: '🐋' },
  ]),
  'p0',
);
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key');
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  mocks.invoke.mockReset();
  mocks.single.mockReset();
  mocks.single.mockResolvedValue({ data: { view_data: view }, error: null });
});
describe('online reconnection and request recovery', () => {
  it('retries a lost response with the original request ID and original version even after a view update', async () => {
    const service = await import('../src/services/session');
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('Connection lost') });
    await expect(service.sendAction(session, view, { type: 'start' })).rejects.toThrow(
      'Connection lost',
    );
    const first = mocks.invoke.mock.calls[0][1].body;
    mocks.invoke.mockResolvedValueOnce({ data: { view: { ...view, version: 1 } }, error: null });
    await service.sendAction(session, { ...view, version: 1 }, { type: 'start' });
    const retry = mocks.invoke.mock.calls[1][1].body;
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.expectedVersion).toBe(0);
    expect(localStorage.getItem('deal.pending-command.v1')).toBeNull();
  });
  it('recovers an uncertain command after a page reload before fetching the latest view', async () => {
    let service = await import('../src/services/session');
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('Connection lost') });
    await expect(service.sendAction(session, view, { type: 'start' })).rejects.toThrow();
    const request = mocks.invoke.mock.calls[0][1].body;
    vi.resetModules();
    service = await import('../src/services/session');
    mocks.invoke.mockResolvedValueOnce({ data: { view: { ...view, version: 1 } }, error: null });
    await service.fetchView(session);
    expect(mocks.invoke.mock.calls[1][1].body).toEqual(request);
    expect(mocks.single).toHaveBeenCalledOnce();
    expect(localStorage.getItem('deal.pending-command.v1')).toBeNull();
  });
  it('clears a definitely rejected request and uses a fresh ID for the next intent', async () => {
    const service = await import('../src/services/session');
    const error = Object.assign(new Error('HTTP error'), {
      context: new Response(JSON.stringify({ error: 'The table changed.' }), { status: 409 }),
    });
    mocks.invoke.mockResolvedValueOnce({ error, data: null });
    await expect(service.sendAction(session, view, { type: 'start' })).rejects.toThrow(
      'table changed',
    );
    expect(localStorage.getItem('deal.pending-command.v1')).toBeNull();
    const old = mocks.invoke.mock.calls[0][1].body;
    mocks.invoke.mockResolvedValueOnce({ data: { view }, error: null });
    await service.sendAction(session, { ...view, version: 2 }, { type: 'start' });
    const next = mocks.invoke.mock.calls[1][1].body;
    expect(next.requestId).not.toBe(old.requestId);
    expect(next.expectedVersion).toBe(2);
  });
  it('does not turn failed online creation into an offline game', async () => {
    const service = await import('../src/services/session');
    mocks.invoke.mockResolvedValueOnce({ error: new Error('Offline'), data: null });
    await expect(service.createRoom('A', '🦭')).rejects.toThrow('Offline');
    expect(localStorage.getItem('naroomopoly-deal.practice.v1')).toBeNull();
    expect(localStorage.getItem('naroomopoly-deal.session.v1')).toBeNull();
  });
});
