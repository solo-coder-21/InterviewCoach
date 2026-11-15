-- Run once in the Supabase SQL editor. All monetary writes are server-only.
create table public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0)
);
create table public.purchases (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (plan_id in ('single', 'five')),
  amount integer not null,
  credits integer not null,
  currency text not null default 'INR' check (currency = 'INR'),
  razorpay_order_id text unique,
  razorpay_payment_id text unique,
  status text not null default 'created' check (status in ('created', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((plan_id = 'single' and amount = 2000 and credits = 1) or
         (plan_id = 'five' and amount = 6000 and credits = 5))
);
create index on public.purchases (user_id, created_at desc);
create table public.interviews (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'active', 'completed', 'failed')),
  configuration jsonb not null,
  session_data jsonb,
  usage jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.interviews (user_id, created_at desc);
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('purchase', 'interview', 'generation_refund')),
  reference text not null,
  created_at timestamptz not null default now(),
  unique (user_id, reason, reference)
);
create table public.request_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_start timestamptz not null,
  count integer not null,
  primary key (user_id, action)
);

alter table public.wallets enable row level security;
alter table public.purchases enable row level security;
alter table public.interviews enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.request_limits enable row level security;
create policy own_wallet on public.wallets for select to authenticated using (auth.uid() = user_id);
create policy own_purchases on public.purchases for select to authenticated using (auth.uid() = user_id);
create policy own_interviews on public.interviews for select to authenticated using (auth.uid() = user_id);
create policy own_ledger on public.credit_ledger for select to authenticated using (auth.uid() = user_id);
revoke all on public.wallets, public.purchases, public.interviews, public.credit_ledger, public.request_limits from anon, authenticated;
grant select on public.wallets, public.purchases, public.interviews, public.credit_ledger to authenticated;
grant all on public.wallets, public.purchases, public.interviews, public.credit_ledger, public.request_limits to service_role;
grant usage, select on sequence public.credit_ledger_id_seq to service_role;

-- Locks the wallet before every credit mutation, including stale recovery.
create function public.recover_interviews(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into wallets(user_id) values(p_user) on conflict do nothing;
  perform 1 from wallets where user_id = p_user for update;
  for v_id in select id from interviews where user_id = p_user
    and status = 'generating' and created_at < now() - interval '10 minutes' for update
  loop
    update interviews set status = 'failed', updated_at = now() where id = v_id;
    insert into credit_ledger(user_id, delta, reason, reference) values(p_user, 1, 'generation_refund', v_id::text);
    update wallets set credits = credits + 1 where user_id = p_user;
  end loop;
end $$;

create function public.reserve_interview(p_user uuid, p_id uuid, p_configuration jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row interviews; v_credits integer;
begin
  perform recover_interviews(p_user);
  select credits into v_credits from wallets where user_id = p_user for update;
  select * into v_row from interviews where id = p_id;
  if found then
    if v_row.user_id <> p_user then raise exception 'INTERVIEW_NOT_FOUND'; end if;
    if v_row.configuration <> p_configuration then raise exception 'REQUEST_CONFLICT'; end if;
    return jsonb_build_object('created', false, 'interview', to_jsonb(v_row));
  end if;
  if v_credits < 1 then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into interviews(id, user_id, configuration) values(p_id, p_user, p_configuration) returning * into v_row;
  update wallets set credits = credits - 1 where user_id = p_user;
  insert into credit_ledger(user_id, delta, reason, reference) values(p_user, -1, 'interview', p_id::text);
  return jsonb_build_object('created', true, 'interview', to_jsonb(v_row));
end $$;

create function public.finish_generation(p_user uuid, p_id uuid, p_session jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row interviews;
begin
  perform 1 from wallets where user_id = p_user for update;
  select * into v_row from interviews where id = p_id and user_id = p_user for update;
  if not found then raise exception 'INTERVIEW_NOT_FOUND'; end if;
  if v_row.status <> 'generating' then raise exception 'GENERATION_EXPIRED'; end if;
  if p_session is null then
    update interviews set status = 'failed', updated_at = now() where id = p_id;
    update wallets set credits = credits + 1 where user_id = p_user;
    insert into credit_ledger(user_id, delta, reason, reference) values(p_user, 1, 'generation_refund', p_id::text);
    return null;
  end if;
  update interviews set status = 'active', session_data = p_session, updated_at = now() where id = p_id;
  return p_session;
end $$;

create function public.fulfill_purchase(p_order text, p_payment text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_row purchases;
begin
  select * into v_row from purchases where razorpay_order_id = p_order;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  insert into wallets(user_id) values(v_row.user_id) on conflict do nothing;
  perform 1 from wallets where user_id = v_row.user_id for update;
  select * into v_row from purchases where razorpay_order_id = p_order for update;
  if v_row.status = 'paid' then return false; end if;
  update purchases set status = 'paid', razorpay_payment_id = p_payment, paid_at = now() where id = v_row.id;
  insert into credit_ledger(user_id, delta, reason, reference) values(v_row.user_id, v_row.credits, 'purchase', p_order);
  update wallets set credits = credits + v_row.credits where user_id = v_row.user_id;
  return true;
end $$;

create function public.claim_interview_usage(p_user uuid, p_id uuid, p_action text, p_max integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_row interviews; v_count integer;
begin
  select * into v_row from interviews where id = p_id and user_id = p_user for update;
  if not found then raise exception 'INTERVIEW_NOT_FOUND'; end if;
  if v_row.status <> 'active' or v_row.created_at < now() - interval '24 hours' then raise exception 'INTERVIEW_CLOSED'; end if;
  v_count := coalesce((v_row.usage ->> p_action)::integer, 0);
  if v_count >= p_max then raise exception 'USAGE_LIMIT'; end if;
  update interviews set usage = jsonb_set(usage, array[p_action], to_jsonb(v_count + 1)) where id = p_id;
end $$;

create function public.claim_request(p_user uuid, p_action text, p_max integer, p_seconds integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  insert into request_limits(user_id, action, window_start, count) values(p_user, p_action, now(), 1)
  on conflict (user_id, action) do update set
    count = case when request_limits.window_start < now() - make_interval(secs => p_seconds) then 1 else request_limits.count + 1 end,
    window_start = case when request_limits.window_start < now() - make_interval(secs => p_seconds) then now() else request_limits.window_start end
  returning count into v_count;
  if v_count > p_max then raise exception 'RATE_LIMIT'; end if;
end $$;

-- SECURITY DEFINER functions must never be executable by a browser JWT.
revoke execute on function public.recover_interviews(uuid), public.reserve_interview(uuid,uuid,jsonb), public.finish_generation(uuid,uuid,jsonb), public.fulfill_purchase(text,text), public.claim_interview_usage(uuid,uuid,text,integer), public.claim_request(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.recover_interviews(uuid), public.reserve_interview(uuid,uuid,jsonb), public.finish_generation(uuid,uuid,jsonb), public.fulfill_purchase(text,text), public.claim_interview_usage(uuid,uuid,text,integer), public.claim_request(uuid,text,integer,integer) to service_role;
