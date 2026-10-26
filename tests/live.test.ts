import { describe, it, expect } from 'vitest';
import { loadEnv } from 'vite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { botAction } from '../src/game/engine';
import type { PlayerView, Action } from '../src/game/types';
const enabled = process.env.DEAL_LIVE_TESTS === '1';
const env = enabled ? loadEnv('production', process.cwd(), '') : {};
async function person() {
  const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  return { c, id: data.user!.id, token: data.session!.access_token };
}
type Person = Awaited<ReturnType<typeof person>>;
async function request(p: Person, body: unknown) {
  const response = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/deal`, {
    method: 'POST',
    headers: {
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${p.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}
async function read(c: SupabaseClient, id: string): Promise<PlayerView> {
  const { data, error } = await c.from('deal_views').select('view_data').eq('game_id', id).single();
  if (error) throw error;
  return data.view_data;
}
describe.skipIf(!enabled)('configured live Supabase backend', () => {
  for (const n of [2, 5])
    it(`supports ${n} separate guests, private views, safe retries and live moves`, async () => {
      const people: Person[] = [];
      for (let i = 0; i < n; i++) people.push(await person());
      const created = await request(people[0], {
        operation: 'create',
        name: `Validation ${n} · host`,
        avatar: '🦭',
      });
      expect(created.status, JSON.stringify(created.data)).toBe(200);
      const game = created.data.session.gameId,
        code = created.data.session.code;
      try {
        for (let i = 1; i < n; i++) {
          const joined = await request(people[i], {
            operation: 'join',
            code,
            name: `Validation ${n} · guest ${i}`,
            avatar: '🐋',
          });
          expect(joined.status, JSON.stringify(joined.data)).toBe(200);
        }
        const lobby = await read(people[0].c, game);
        expect(lobby.players).toHaveLength(n);
        const nonhost = await request(people[1], {
          operation: 'command',
          gameId: game,
          requestId: crypto.randomUUID(),
          expectedVersion: lobby.version,
          action: { type: 'start' },
        });
        expect(nonhost.status).toBe(400);
        const start = {
          operation: 'command',
          gameId: game,
          requestId: crypto.randomUUID(),
          expectedVersion: lobby.version,
          action: { type: 'start' },
        };
        const started = await request(people[0], start);
        expect(started.status, JSON.stringify(started.data)).toBe(200);
        const duplicate = await request(people[0], start);
        expect(duplicate.data).toEqual(started.data);
        const views = await Promise.all(people.map((p) => read(p.c, game)));
        for (const v of views) {
          expect(v.hand).toHaveLength(5);
          expect(v).not.toHaveProperty('deck');
          expect(v.players.every((p) => !('hand' in p))).toBe(true);
        }
        const forbidden = await people[0].c.from('deal_games').select('*').eq('id', game);
        expect(forbidden.error).not.toBeNull();
        const foreign = await people[0].c
          .from('deal_views')
          .select('*')
          .eq('game_id', game)
          .eq('user_id', people[1].id);
        expect(foreign.data).toEqual([]);
        let v = views[0];
        for (let step = 0; step < 18 && v.stage !== 'finished'; step++) {
          const actor = v.pending?.responder ?? v.players[v.turn].id;
          const p = people.find((p) => p.id === actor)!;
          const own = await read(p.c, game);
          const action = botAction(own)!;
          const moved = await request(p, {
            operation: 'command',
            gameId: game,
            requestId: crypto.randomUUID(),
            expectedVersion: own.version,
            action,
          });
          expect(moved.status, JSON.stringify(moved.data)).toBe(200);
          v = moved.data.view;
        }
        // Two copies of one intent must resolve to one commit, even if they arrive together.
        if (v.stage !== 'finished') {
          const actor = v.pending?.responder ?? v.players[v.turn].id;
          const p = people.find((p) => p.id === actor)!;
          const own = await read(p.c, game);
          const action = botAction(own)!;
          const command = {
            operation: 'command',
            gameId: game,
            requestId: crypto.randomUUID(),
            expectedVersion: own.version,
            action,
          };
          const pair = await Promise.all([request(p, command), request(p, command)]);
          expect(pair.map((r) => r.status)).toEqual([200, 200]);
          expect(pair[0].data).toEqual(pair[1].data);
          expect((await read(p.c, game)).version).toBe(own.version + 1);
        }
      } finally {
        const v = await read(people[0].c, game);
        if (v.stage !== 'finished')
          await request(people[0], {
            operation: 'command',
            gameId: game,
            requestId: crypto.randomUUID(),
            expectedVersion: v.version,
            action: { type: 'endGame' } as Action,
          });
      }
    }, 120000);
});
