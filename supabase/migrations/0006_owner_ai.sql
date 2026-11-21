-- Owner AI server functions. Run after migrations 0001 through 0005.

alter table public.knowledge_overrides enable row level security;
alter table public.daily_summaries enable row level security;
drop policy if exists "owner all" on public.knowledge_overrides;
drop policy if exists "owner all" on public.daily_summaries;
revoke all on table public.knowledge_overrides, public.daily_summaries from public, anon, authenticated;
grant select, insert, update, delete on table public.knowledge_overrides, public.daily_summaries to service_role;
create index if not exists assistant_logs_owner_questions_idx
  on public.assistant_logs (created_at desc)
  where role = 'assistant' and answered = false;
create index if not exists assistant_logs_session_excerpt_idx
  on public.assistant_logs (session_id, created_at);

create or replace function public.owner_add_answer_and_handle(
  p_log_id uuid,
  p_question text,
  p_answer text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override_id uuid;
begin
  perform pg_advisory_xact_lock(681042);
  if (select count(*) from public.knowledge_overrides) >= 50 then
    raise exception using message = 'override_limit';
  end if;
  if not exists (
    select 1 from public.assistant_logs
    where id = p_log_id and role = 'assistant' and answered = false
      and handled = false and unanswered_topic is not null
  ) then
    raise exception using message = 'question_not_found';
  end if;
  insert into public.knowledge_overrides (question, answer)
  values (p_question, p_answer)
  returning id into v_override_id;
  update public.assistant_logs set handled = true where id = p_log_id;
  return v_override_id;
end;
$$;

revoke all on function public.owner_add_answer_and_handle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.owner_add_answer_and_handle(uuid, text, text) to service_role;

create or replace function public.owner_insert_override(p_question text, p_answer text)
returns public.knowledge_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.knowledge_overrides;
begin
  perform pg_advisory_xact_lock(681042);
  if (select count(*) from public.knowledge_overrides) >= 50 then
    raise exception using message = 'override_limit';
  end if;
  insert into public.knowledge_overrides (question, answer)
  values (p_question, p_answer)
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.owner_insert_override(text, text) from public, anon, authenticated;
grant execute on function public.owner_insert_override(text, text) to service_role;

create or replace function public.owner_insights(p_range text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_days integer;
  v_start date;
  v_result jsonb;
begin
  if p_range not in ('today', '7d', '30d') then
    raise exception using message = 'invalid_range';
  end if;
  v_days := case p_range when 'today' then 1 when '7d' then 7 else 30 end;
  v_start := v_today - (v_days - 1);

  with order_days as (
    select (o.created_at at time zone 'Asia/Kolkata')::date as day, count(*)::integer as count
    from public.orders o
    where o.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata')
      and o.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata')
      and o.status <> 'cancelled'
    group by 1
  ), days as (
    select generate_series(v_start, v_today, interval '1 day')::date as day
  ), order_hours as (
    select extract(hour from o.created_at at time zone 'Asia/Kolkata')::integer as hour,
      count(*)::integer as count
    from public.orders o
    where o.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata')
      and o.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata')
      and o.status <> 'cancelled'
    group by 1
  ), top_items as (
    select oi.menu_item_id as id, oi.name_snapshot as name, sum(oi.qty)::integer as quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata')
      and o.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata')
      and o.status <> 'cancelled'
    group by oi.menu_item_id, oi.name_snapshot
    order by sum(oi.qty) desc, oi.name_snapshot
    limit 10
  ), party_sizes as (
    select b.party_size, count(*)::integer as count
    from public.bookings b
    where b.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata')
      and b.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata')
      and b.status not in ('declined', 'cancelled')
    group by b.party_size
    order by b.party_size
  ), assistant_rows as (
    select * from public.assistant_logs a
    where a.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata')
      and a.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata')
  ), assistant_stats as (
    select count(distinct a.session_id)::integer as conversations,
      count(*) filter (where a.role = 'assistant' and a.answered)::integer as answered,
      count(*) filter (where a.role = 'assistant' and a.unanswered_topic is not null)::integer as unanswered,
      count(*) filter (where a.role = 'assistant' and a.tool_calls @> '[{"name":"propose_cart_add"}]'::jsonb)::integer as cart_actions,
      count(*) filter (where a.role = 'assistant' and a.tool_calls @> '[{"name":"propose_booking"}]'::jsonb)::integer as booking_actions
    from assistant_rows a
  )
  select jsonb_build_object(
    'range', p_range,
    'start', v_start,
    'end', v_today,
    'orderCount', (select count(*)::integer from public.orders o where o.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata') and o.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata') and o.status <> 'cancelled'),
    'orderTotal', (select coalesce(sum(o.subtotal), 0)::numeric(10,2) from public.orders o where o.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata') and o.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata') and o.status <> 'cancelled'),
    'bookingCount', (select count(*)::integer from public.bookings b where b.created_at >= (v_start::timestamp at time zone 'Asia/Kolkata') and b.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Kolkata') and b.status not in ('declined', 'cancelled')),
    'ordersPerDay', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(od.count, 0)) order by d.day) from days d left join order_days od using (day)), '[]'::jsonb),
    'topItems', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'quantity', t.quantity)) from top_items t), '[]'::jsonb),
    'ordersPerHour', coalesce((select jsonb_agg(jsonb_build_object('hour', h.hour, 'count', h.count) order by h.hour) from order_hours h), '[]'::jsonb),
    'bookingsByPartySize', coalesce((select jsonb_agg(jsonb_build_object('partySize', b.party_size, 'count', b.count) order by b.party_size) from party_sizes b), '[]'::jsonb),
    'assistant', (select jsonb_build_object(
      'conversations', case when exists (select 1 from assistant_rows) then a.conversations else null end,
      'answeredRate', case when a.answered + a.unanswered > 0 then round(a.answered::numeric / (a.answered + a.unanswered), 4) else null end,
      'cartActions', case when exists (select 1 from assistant_rows where tool_calls is not null) then a.cart_actions else null end,
      'bookingActions', case when exists (select 1 from assistant_rows where tool_calls is not null) then a.booking_actions else null end
    ) from assistant_stats a)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.owner_insights(text) from public, anon, authenticated;
grant execute on function public.owner_insights(text) to service_role;

-- These tables remain server-only. No grants or anonymous policies are added.
