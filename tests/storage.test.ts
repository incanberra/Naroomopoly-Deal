import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createGame, execute, viewFor } from '../src/game/engine';
import type { GameState } from '../src/game/types';
let db: PGlite;
const p0 = '10000000-0000-4000-8000-000000000001',
  p1 = '10000000-0000-4000-8000-000000000002',
  outsider = '10000000-0000-4000-8000-000000000003';
const gid = '20000000-0000-4000-8000-000000000001';
let s: GameState;
const commit = (
  state: GameState,
  version: number,
  request: string | null = null,
  response: unknown = null,
) =>
  db.query('select public.deal_commit($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb) as result', [
    state.id,
    version,
    JSON.stringify(state),
    JSON.stringify(state.players.map((p) => viewFor(state, p.id))),
    request ? p0 : null,
    request,
    JSON.stringify(response),
  ]);
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.exec(`set role authenticated; set request.jwt.claim.sub='${id}';`);
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  const sql = readFileSync(
    new URL('../supabase/migrations/202610260001_deal.sql', import.meta.url),
    'utf8',
  );
  // Embedded Postgres exercises real tables, transactions and RLS; replication requires hosted/local Supabase.
  await db.exec(
    sql.replace('alter publication supabase_realtime add table public.deal_views;', ''),
  );
  await db.query('insert into auth.users values($1),($2),($3)', [p0, p1, outsider]);
  s = createGame(gid, 'ABCDE', [
    { id: p0, name: 'Alice', avatar: '🦭' },
    { id: p1, name: 'Bob', avatar: '🐋' },
  ]);
  await commit(s, -1);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential('Postgres access rules and atomic updates', () => {
  it('publishes one protected projection per player', async () => {
    const result = await db.query('select * from deal_views');
    expect(result.rows).toHaveLength(2);
  });
  it('lets authenticated players read only their own view', async () => {
    await asUser(p0, async () => {
      const result = await db.query<{ user_id: string }>('select user_id from deal_views');
      expect(result.rows.map((r) => r.user_id)).toEqual([p0]);
      const other = await db.query('select * from deal_views where user_id=$1', [p1]);
      expect(other.rows).toHaveLength(0);
    });
  });
  it('gives outsiders zero views', async () => {
    await asUser(outsider, async () =>
      expect((await db.query('select * from deal_views')).rows).toHaveLength(0),
    );
  });
  it('blocks direct reads of full state, receipts and member records', async () => {
    await asUser(p0, async () => {
      for (const table of ['deal_games', 'deal_receipts', 'deal_members'])
        await expect(db.query(`select * from ${table}`)).rejects.toThrow(/permission denied/);
    });
  });
  it('blocks fabricated client state, projection writes and commit calls', async () => {
    await asUser(p0, async () => {
      await expect(db.exec("update deal_views set view_data='{}'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.exec("update deal_games set state_data='{}'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(commit(s, 0)).rejects.toThrow(/permission denied/);
    });
  });
  it('commits state, every view and a command receipt together', async () => {
    s = execute(s, p0, { type: 'start' }, () => 0.5);
    const response = { view: viewFor(s, p0) };
    await commit(s, 0, '30000000-0000-4000-8000-000000000001', response);
    const games = await db.query<{ version: number }>('select version from deal_games');
    const views = await db.query<{ version: number }>('select version from deal_views');
    expect(games.rows[0].version).toBe(1);
    expect(views.rows.map((v) => v.version)).toEqual([1, 1]);
    expect((await db.query('select * from deal_receipts')).rows).toHaveLength(1);
  });
  it('stores public views without other hands or draw order', async () => {
    await asUser(p0, async () => {
      const result = await db.query<{ view_data: any }>('select view_data from deal_views');
      const v = result.rows[0].view_data;
      expect(v.hand).toHaveLength(5);
      expect(v).not.toHaveProperty('deck');
      expect(v.players.every((p: any) => !('hand' in p))).toBe(true);
      const hidden = s.players[1].hand[0];
      expect(JSON.stringify(v)).not.toContain(hidden);
    });
  });
  it('rejects a competing move at the same old version without partial writes', async () => {
    const stale = structuredClone(s);
    stale.version = 1;
    await expect(commit(stale, 0, '30000000-0000-4000-8000-000000000002', {})).rejects.toThrow(
      /STALE_VERSION/,
    );
    expect((await db.query('select * from deal_receipts')).rows).toHaveLength(1);
    expect(
      (await db.query<{ version: number }>('select version from deal_games')).rows[0].version,
    ).toBe(1);
  });
  it('returns the original receipt on a duplicate request without replaying a move', async () => {
    const duplicate = await commit(s, 0, '30000000-0000-4000-8000-000000000001', {
      forged: 'new result',
    });
    expect((duplicate.rows[0] as any).result).toEqual({ view: viewFor(s, p0) });
    expect(
      (await db.query<{ version: number }>('select version from deal_games')).rows[0].version,
    ).toBe(1);
  });
  it('rolls back state if writing a projection fails', async () => {
    const next = structuredClone(s);
    next.version = 2;
    next.players.push({
      id: '10000000-0000-4000-8000-000000000099',
      name: 'No auth user',
      avatar: '🦭',
      isBot: false,
      hand: [],
      bank: [],
      groups: [],
      reserve: [],
    });
    await expect(commit(next, 1)).rejects.toThrow(/foreign key/);
    expect(
      (await db.query<{ version: number }>('select version from deal_games')).rows[0].version,
    ).toBe(1);
    expect((await db.query('select * from deal_views')).rows).toHaveLength(2);
  });
  it('limits API attempts atomically by user and bucket', async () => {
    const hit = () =>
      db.query<{ allowed: boolean }>("select deal_rate_limit($1,'test',2,60) as allowed", [p0]);
    expect((await hit()).rows[0].allowed).toBe(true);
    expect((await hit()).rows[0].allowed).toBe(true);
    expect((await hit()).rows[0].allowed).toBe(false);
  });
});
