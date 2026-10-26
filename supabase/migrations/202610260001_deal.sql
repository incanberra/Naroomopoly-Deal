-- A separate database for Naroomopoly Deal. Complete state is service-role only.
create table public.deal_games (
 id uuid primary key,
 code text not null unique check (code ~ '^[A-Z]{5}$'),
 version integer not null,
 state_data jsonb not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.deal_members (
 game_id uuid not null references public.deal_games(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 last_seen timestamptz not null default now(),
 primary key(game_id,user_id)
);
create table public.deal_views (
 game_id uuid not null,
 user_id uuid not null,
 version integer not null,
 view_data jsonb not null,
 primary key(game_id,user_id),
 foreign key(game_id,user_id) references public.deal_members(game_id,user_id) on delete cascade
);
create table public.deal_receipts (
 game_id uuid not null references public.deal_games(id) on delete cascade,
 actor_id uuid not null,
 request_id uuid not null,
 response jsonb not null,
 created_at timestamptz not null default now(),
 primary key(game_id,actor_id,request_id)
);
create table public.deal_rate_limits (
 user_id uuid not null,
 bucket text not null,
 started_at timestamptz not null,
 hits integer not null,
 primary key(user_id,bucket)
);
alter table public.deal_games enable row level security;
alter table public.deal_members enable row level security;
alter table public.deal_views enable row level security;
alter table public.deal_receipts enable row level security;
alter table public.deal_rate_limits enable row level security;
revoke all on public.deal_games, public.deal_members, public.deal_views, public.deal_receipts, public.deal_rate_limits from anon, authenticated;
grant select on public.deal_views to authenticated;
create policy "Only your own game projection" on public.deal_views for select to authenticated using (user_id=auth.uid());
grant all on public.deal_games, public.deal_members, public.deal_views, public.deal_receipts, public.deal_rate_limits to service_role;
alter publication supabase_realtime add table public.deal_views;

-- Compare-and-swap and all player projections commit together. No client can call this.
create or replace function public.deal_commit(
 p_game_id uuid, p_expected_version integer, p_state jsonb, p_views jsonb,
 p_actor_id uuid default null, p_request_id uuid default null, p_response jsonb default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_current integer; v_view jsonb; v_receipt jsonb;
begin
 if p_expected_version = -1 then
  if (p_state->>'version')::integer <> 0 then raise exception 'Invalid initial version'; end if;
  insert into public.deal_games(id,code,version,state_data) values(p_game_id,p_state->>'code',0,p_state);
 else
  select version into v_current from public.deal_games where id=p_game_id for update;
  if not found then raise exception 'Table not found'; end if;
  if p_request_id is not null then
   select response into v_receipt from public.deal_receipts where game_id=p_game_id and actor_id=p_actor_id and request_id=p_request_id;
   if found then return v_receipt; end if;
  end if;
  if v_current <> p_expected_version then raise exception 'STALE_VERSION: The table changed. Refresh and try again.'; end if;
  if (p_state->>'version')::integer <> v_current+1 then raise exception 'Invalid next version'; end if;
  update public.deal_games set version=v_current+1,state_data=p_state,updated_at=now() where id=p_game_id;
 end if;
 delete from public.deal_members m where m.game_id=p_game_id and not exists(select 1 from jsonb_array_elements(p_views) v where (v->>'you')::uuid=m.user_id);
 for v_view in select * from jsonb_array_elements(p_views) loop
  insert into public.deal_members(game_id,user_id) values(p_game_id,(v_view->>'you')::uuid) on conflict do nothing;
  insert into public.deal_views(game_id,user_id,version,view_data) values(p_game_id,(v_view->>'you')::uuid,(p_state->>'version')::integer,v_view)
   on conflict(game_id,user_id) do update set version=excluded.version,view_data=excluded.view_data;
 end loop;
 if p_request_id is not null then
  insert into public.deal_receipts(game_id,actor_id,request_id,response) values(p_game_id,p_actor_id,p_request_id,p_response);
 end if;
 return coalesce(p_response,'{}'::jsonb);
end $$;
revoke all on function public.deal_commit(uuid,integer,jsonb,jsonb,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.deal_commit(uuid,integer,jsonb,jsonb,uuid,uuid,jsonb) to service_role;

create or replace function public.deal_rate_limit(p_user uuid,p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_hits integer;
begin
 insert into public.deal_rate_limits(user_id,bucket,started_at,hits) values(p_user,p_bucket,now(),1)
 on conflict(user_id,bucket) do update set
 hits=case when deal_rate_limits.started_at < now()-make_interval(secs=>p_seconds) then 1 else deal_rate_limits.hits+1 end,
 started_at=case when deal_rate_limits.started_at < now()-make_interval(secs=>p_seconds) then now() else deal_rate_limits.started_at end
 returning hits into v_hits;
 return v_hits<=p_limit;
end $$;
revoke all on function public.deal_rate_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.deal_rate_limit(uuid,text,integer,integer) to service_role;
