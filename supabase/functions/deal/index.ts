import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createGame, execute, viewFor, ensure } from '../../../src/game/engine.ts';
import type { GameState } from '../../../src/game/types.ts';
import { parseAction } from '../../../src/game/commands.ts';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  try {
    const authorization = req.headers.get('Authorization');
    ensure(authorization?.startsWith('Bearer '), 'Sign in to your table first.');
    const service = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const {
      data: { user },
      error: authError,
    } = await service.auth.getUser(authorization!.slice(7));
    ensure(!authError && user, 'Your session expired. Please reconnect.');
    const userId = user!.id;
    const rate = await service.rpc('deal_rate_limit', {
      p_user: userId,
      p_bucket: 'requests',
      p_limit: 90,
      p_seconds: 60,
    });
    ensure(!rate.error && rate.data, 'Please slow down and try again in a minute.');
    const text = await req.text();
    ensure(text.length <= 16000, 'Request too large.');
    const body = JSON.parse(text);
    const commit = async (
      s: GameState,
      expected: number,
      requestId?: string,
      response?: unknown,
    ) => {
      const views = s.players.map((p) => viewFor(s, p.id));
      const { data, error } = await service.rpc('deal_commit', {
        p_game_id: s.id,
        p_expected_version: expected,
        p_state: s,
        p_views: views,
        p_actor_id: requestId ? userId : null,
        p_request_id: requestId ?? null,
        p_response: response ?? null,
      });
      if (error) throw new Error(error.message);
      return data;
    };
    const session = (s: GameState) => ({
      mode: 'online',
      gameId: s.id,
      playerId: userId,
      code: s.code,
    });
    if (body.operation === 'create' || body.operation === 'join') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      ensure(
        name.length > 0 && name.length <= 30 && !/[\u0000-\u001f]/.test(name),
        'Choose a name of 1–30 characters.',
      );
      ensure(
        ['🦭', '🦘', '🐦', '🐋', '🚐'].includes(body.avatar),
        'Choose an available character.',
      );
      if (body.operation === 'create') {
        const limit = await service.rpc('deal_rate_limit', {
          p_user: userId,
          p_bucket: 'create',
          p_limit: 10,
          p_seconds: 3600,
        });
        ensure(limit.data, 'You have created several rooms. Try again later.');
        for (let attempt = 0; attempt < 5; attempt++) {
          const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
          const code = Array.from(
            { length: 5 },
            () => alphabet[Math.floor(rng() * alphabet.length)],
          ).join('');
          const s = createGame(crypto.randomUUID(), code, [
            { id: userId, name, avatar: body.avatar },
          ]);
          try {
            await commit(s, -1);
            return reply({ session: session(s) });
          } catch (e) {
            if (!(e as Error).message.includes('deal_games_code_key')) throw e;
          }
        }
        throw new Error('Could not reserve a room code. Try again.');
      }
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
      ensure(/^[A-Z]{5}$/.test(code), 'Enter a five-letter room code.');
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data, error } = await service
          .from('deal_games')
          .select('state_data')
          .eq('code', code)
          .single();
        ensure(!error && data, 'That room was not found. Check the code.');
        const s = data!.state_data as GameState;
        if (s.players.some((p) => p.id === userId)) return reply({ session: session(s) });
        ensure(s.stage === 'lobby', 'This game has already started.');
        ensure(s.players.length < 5, 'This room is full.');
        s.players.push({
          id: userId,
          name,
          avatar: body.avatar,
          isBot: false,
          hand: [],
          bank: [],
          groups: [],
          reserve: [],
        });
        const old = s.version;
        s.version++;
        try {
          await commit(s, old);
          return reply({ session: session(s) });
        } catch (e) {
          if (!(e as Error).message.includes('STALE_VERSION') || attempt === 3) throw e;
        }
      }
    }
    ensure(uuid(body.gameId), 'Invalid table.');
    const { data: member, error: memberError } = await service
      .from('deal_members')
      .select('user_id')
      .eq('game_id', body.gameId)
      .eq('user_id', userId)
      .single();
    ensure(!memberError && member, 'You are not a member of this table.');
    if (body.operation === 'heartbeat') {
      const { error } = await service
        .from('deal_members')
        .update({ last_seen: new Date().toISOString() })
        .eq('game_id', body.gameId)
        .eq('user_id', userId);
      if (error) throw error;
      return reply({ ok: true });
    }
    ensure(body.operation === 'command', 'Unknown operation.');
    ensure(uuid(body.requestId), 'Invalid request ID.');
    ensure(
      Number.isSafeInteger(body.expectedVersion) && body.expectedVersion >= 0,
      'Invalid state version.',
    );
    const { data: receipt } = await service
      .from('deal_receipts')
      .select('response')
      .eq('game_id', body.gameId)
      .eq('actor_id', userId)
      .eq('request_id', body.requestId)
      .maybeSingle();
    if (receipt) return reply(receipt.response);
    const { data, error } = await service
      .from('deal_games')
      .select('state_data')
      .eq('id', body.gameId)
      .single();
    ensure(!error && data, 'Table not found.');
    const state = data!.state_data as GameState;
    // Another invocation can commit between the first receipt lookup and this read.
    // State and receipt are written atomically, so a second lookup closes that race.
    if (state.version !== body.expectedVersion) {
      const { data: committed } = await service
        .from('deal_receipts')
        .select('response')
        .eq('game_id', body.gameId)
        .eq('actor_id', userId)
        .eq('request_id', body.requestId)
        .maybeSingle();
      if (committed) return reply(committed.response);
    }
    ensure(state.version === body.expectedVersion, 'The table changed. Refresh and try again.');
    const action = parseAction(body.action);
    if (action.type === 'leave') {
      const { data: connected } = await service
        .from('deal_members')
        .select('user_id')
        .eq('game_id', state.id)
        .gt('last_seen', new Date(Date.now() - 45000).toISOString());
      action.connectedIds = (connected ?? []).map((p) => p.user_id);
    }
    const next = execute(state, userId, action, rng);
    const response = {
      view: next.players.some((p) => p.id === userId) ? viewFor(next, userId) : null,
      left: !next.players.some((p) => p.id === userId),
    };
    return reply(await commit(next, state.version, body.requestId, response));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The move could not be completed.';
    return reply(
      { error: message },
      message.includes('STALE_VERSION') || message.includes('table changed') ? 409 : 400,
    );
  }
});
