-- Owner RLS review before adding privileged functions:
-- The owner may write menu_items, bookings, booking_slots, orders, order_items,
-- enquiries, assistant_logs, knowledge_overrides and daily_summaries through the
-- existing owner policies. The public anon role can read only menu_items and
-- slot_tables. This migration does not weaken or add any public policy.

create or replace function public.owner_set_order_status(
  p_order uuid,
  p_status text,
  p_cancel_reason text
)
returns table(code text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order for update;
  if v_order.id is null then
    raise exception using message = 'not_found';
  end if;

  if p_status = 'cancelled' then
    if v_order.status not in ('new', 'preparing', 'ready') then
      raise exception using message = 'bad_transition';
    end if;
    if p_cancel_reason is null or p_cancel_reason not in (
      'customer_request', 'out_of_stock', 'cannot_make_it', 'duplicate', 'other'
    ) then
      raise exception using message = 'reason_required';
    end if;
  elsif not (
    (v_order.status = 'new' and p_status = 'preparing')
    or (v_order.status = 'preparing' and p_status = 'ready')
    or (v_order.status = 'ready' and p_status = 'collected')
  ) then
    raise exception using message = 'bad_transition';
  end if;

  return query
  update orders as o
  set status = p_status,
      cancel_reason = case when p_status = 'cancelled' then p_cancel_reason else null end
  where o.id = p_order
  returning o.code, o.status;
end;
$$;

create or replace function public.owner_confirm_booking(
  p_booking uuid,
  p_slot_ids text[]
)
returns table(code text, status text, slot_labels text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_start timestamptz;
  v_during tstzrange;
  v_requested_count integer;
  v_slot_count integer;
  v_seats integer;
  v_labels text[];
begin
  select * into v_booking from bookings where id = p_booking for update;
  if v_booking.id is null then
    raise exception using message = 'not_found';
  end if;
  if v_booking.status <> 'requested' then
    raise exception using message = 'bad_transition';
  end if;
  if p_slot_ids is null or cardinality(p_slot_ids) = 0 then
    raise exception using message = 'bad_slots';
  end if;

  select count(*), count(distinct slot_id)
    into v_requested_count, v_slot_count
  from unnest(p_slot_ids) as chosen(slot_id);
  if v_requested_count <> v_slot_count then
    raise exception using message = 'bad_slots';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_booking.date::text));
  v_start := (v_booking.date + v_booking.start_time) at time zone 'Asia/Kolkata';
  v_during := tstzrange(v_start, v_start + interval '90 minutes', '[)');

  select count(*), coalesce(sum(s.seats), 0), array_agg(s.label order by s.label)
    into v_slot_count, v_seats, v_labels
  from slot_tables as s
  where s.id = any(p_slot_ids);
  if v_slot_count <> v_requested_count then
    raise exception using message = 'bad_slots';
  end if;
  if v_seats < v_booking.party_size then
    raise exception using message = 'too_few_seats';
  end if;
  if exists (
    select 1
    from booking_slots as occupied
    where occupied.slot_table_id = any(p_slot_ids)
      and occupied.during && v_during
      and occupied.booking_id <> v_booking.id
  ) then
    raise exception using message = 'slot_taken';
  end if;

  begin
    insert into booking_slots (booking_id, slot_table_id, during)
    select v_booking.id, chosen.slot_id, v_during
    from unnest(p_slot_ids) as chosen(slot_id);
  exception when exclusion_violation then
    raise exception using message = 'slot_taken';
  end;

  update bookings set status = 'confirmed' where id = v_booking.id;
  return query select v_booking.code, 'confirmed'::text, v_labels;
end;
$$;

create or replace function public.owner_decline_booking(
  p_booking uuid,
  p_reason text
)
returns table(code text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if v_booking.id is null then
    raise exception using message = 'not_found';
  end if;
  if v_booking.status not in ('requested', 'confirmed') then
    raise exception using message = 'bad_transition';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception using message = 'reason_required';
  end if;
  delete from booking_slots where booking_id = v_booking.id;
  return query
  update bookings as b
  set status = 'declined', decline_reason = left(btrim(p_reason), 200)
  where b.id = v_booking.id
  returning b.code, b.status;
end;
$$;

create or replace function public.owner_set_booking_status(
  p_booking uuid,
  p_status text
)
returns table(code text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if v_booking.id is null then
    raise exception using message = 'not_found';
  end if;
  if v_booking.status <> 'confirmed' or p_status not in ('seated', 'no_show') then
    raise exception using message = 'bad_transition';
  end if;
  return query
  update bookings as b
  set status = p_status
  where b.id = v_booking.id
  returning b.code, b.status;
end;
$$;

create or replace function public.owner_cancel_booking(
  p_booking uuid,
  p_reason text
)
returns table(code text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking for update;
  if v_booking.id is null then
    raise exception using message = 'not_found';
  end if;
  if v_booking.status not in ('requested', 'confirmed') then
    raise exception using message = 'bad_transition';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception using message = 'reason_required';
  end if;
  delete from booking_slots where booking_id = v_booking.id;
  return query
  update bookings as b
  set status = 'cancelled', cancel_reason = left(btrim(p_reason), 200)
  where b.id = v_booking.id
  returning b.code, b.status;
end;
$$;

revoke all on function public.owner_set_order_status(uuid, text, text) from public, anon, authenticated;
revoke all on function public.owner_confirm_booking(uuid, text[]) from public, anon, authenticated;
revoke all on function public.owner_decline_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.owner_set_booking_status(uuid, text) from public, anon, authenticated;
revoke all on function public.owner_cancel_booking(uuid, text) from public, anon, authenticated;

grant execute on function public.owner_set_order_status(uuid, text, text) to service_role;
grant execute on function public.owner_confirm_booking(uuid, text[]) to service_role;
grant execute on function public.owner_decline_booking(uuid, text) to service_role;
grant execute on function public.owner_set_booking_status(uuid, text) to service_role;
grant execute on function public.owner_cancel_booking(uuid, text) to service_role;
