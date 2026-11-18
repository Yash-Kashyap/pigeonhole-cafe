-- Harden booking creation, availability and cancellation without changing table shapes.
create extension if not exists btree_gist;

-- Older databases may have been created without the overlap guard. Add it only when
-- booking_slots has no exclusion constraint already.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.booking_slots'::regclass
      and contype = 'x'
      and pg_get_constraintdef(oid) ilike '%slot_table_id WITH =%'
      and pg_get_constraintdef(oid) ilike '%during WITH &&%'
  ) then
    alter table public.booking_slots
      add constraint booking_slots_no_overlap
      exclude using gist (slot_table_id with =, during with &&);
  end if;
end
$$;

-- The master spec (docs/00-MASTER-PROMPT.md) says 8 two-seat slots (S1-S8), 6 four-seat
-- slots (S9-S14) and 2 six-seat slots (S15-S16). 0001 built 6/6/4. Correct it here.
-- Safe to run more than once. Existing booking rows keep their slot ids.
update public.slot_tables
set seats = case
  when id in ('S1','S2','S3','S4','S5','S6','S7','S8') then 2
  when id in ('S9','S10','S11','S12','S13','S14') then 4
  else 6
end
where id ~ '^S[0-9]+$';

drop function if exists public.create_booking(text, text, text, date, time, integer, text, text, jsonb);

create function public.create_booking(
  p_name text,
  p_phone text,
  p_email text,
  p_date date,
  p_start time,
  p_party integer,
  p_occasion text default null,
  p_notes text default null,
  p_preorder jsonb default null
)
returns table(code text, status text, slot_labels text[], start_time time)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_start timestamptz;
  v_during tstzrange;
  v_code text := 'PH-BK-' || lpad(nextval('booking_seq')::text, 4, '0');
  v_booking_id uuid;
  v_slot slot_tables;
  v_status text;
  v_open time;
  v_last_start time;
  v_item jsonb;
  v_bad boolean;
  v_preorder jsonb;
begin
  if p_party is null or p_party < 1 or p_party > 12 then
    raise exception using message = 'party_too_large';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 60
    or p_phone is null or p_phone !~ '^\+91[0-9]{10}$'
    or (p_email is not null and char_length(p_email) > 254)
    or (p_notes is not null and char_length(p_notes) > 200)
  then
    raise exception using message = 'bad_customer';
  end if;

  if p_date is null or p_date < v_today or p_date > v_today + 30 then
    raise exception using message = 'outside_window';
  end if;

  if extract(isodow from p_date) = 1 then
    raise exception using message = 'closed_day';
  end if;

  if p_start is null
    or extract(second from p_start) <> 0
    or mod(extract(minute from p_start)::integer, 30) <> 0
  then
    raise exception using message = 'bad_time';
  end if;

  if extract(isodow from p_date) = 7
    and extract(month from p_date) in (10, 11)
  then
    v_open := time '07:00';
    v_last_start := time '22:00';
  elsif extract(isodow from p_date) in (6, 7) then
    v_open := time '08:00';
    v_last_start := time '22:00';
  else
    v_open := time '08:00';
    v_last_start := time '20:30';
  end if;

  if p_start < v_open or p_start > v_last_start then
    raise exception using message = 'bad_time';
  end if;

  v_start := (p_date + p_start) at time zone 'Asia/Kolkata';
  if p_date = v_today and v_start < v_now + interval '2 hours' then
    raise exception using message = 'too_late';
  end if;
  if p_party >= 8 and v_start < v_now + interval '24 hours' then
    raise exception using message = 'notice_required';
  end if;

  if p_preorder is not null then
    if jsonb_typeof(p_preorder) is distinct from 'array'
      or jsonb_array_length(p_preorder) > 12
    then
      raise exception using message = 'bad_preorder';
    end if;

    for v_item in select value from jsonb_array_elements(p_preorder)
    loop
      -- Check the shape first, then the number. Postgres does not promise that the
      -- terms of one OR run left to right, so the cast must sit in its own statement.
      if jsonb_typeof(v_item) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(v_item)) <> 2
        or not (v_item ? 'id' and v_item ? 'qty')
        or coalesce(v_item->>'id', '') !~ '^PH[0-9]{4}$'
        or coalesce(v_item->>'qty', '') !~ '^[0-9]{1,3}$'
      then
        raise exception using message = 'bad_preorder';
      end if;
      if (v_item->>'qty')::integer < 1 or (v_item->>'qty')::integer > 20 then
        raise exception using message = 'bad_preorder';
      end if;
    end loop;

    with collapsed as (
      select item->>'id' as id, sum((item->>'qty')::numeric) as qty
      from jsonb_array_elements(p_preorder) as raw(item)
      group by item->>'id'
    )
    select exists(select 1 from collapsed where qty > 20)
      into v_bad;
    if v_bad then
      raise exception using message = 'bad_preorder';
    end if;

    with collapsed as (
      select item->>'id' as id, sum((item->>'qty')::integer)::integer as qty
      from jsonb_array_elements(p_preorder) as raw(item)
      group by item->>'id'
    )
    select exists(
      select 1
      from collapsed c
      left join menu_items m on m.id = c.id
      where m.id is null or not m.available
    ) into v_bad;
    if v_bad then
      raise exception using message = 'bad_preorder';
    end if;

    if jsonb_array_length(p_preorder) > 0 then
      with collapsed as (
        select item->>'id' as id, sum((item->>'qty')::integer)::integer as qty
        from jsonb_array_elements(p_preorder) as raw(item)
        group by item->>'id'
      )
      select jsonb_build_object(
        'lines', jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'price', m.price_usd,
            'qty', c.qty,
            'lineTotal', round(m.price_usd * c.qty, 2)
          ) order by m.id
        ),
        'total', round(sum(m.price_usd * c.qty), 2)
      )
      into v_preorder
      from collapsed c
      join menu_items m on m.id = c.id;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_date::text));
  v_during := tstzrange(v_start, v_start + interval '90 minutes', '[)');
  v_status := case when p_party <= 6 then 'confirmed' else 'requested' end;

  insert into bookings (
    code, name, phone, email, date, start_time, party_size, status,
    occasion, notes, preorder
  ) values (
    v_code, btrim(p_name), p_phone, nullif(btrim(p_email), ''), p_date,
    p_start, p_party, v_status, nullif(btrim(p_occasion), ''),
    nullif(btrim(p_notes), ''), v_preorder
  ) returning id into v_booking_id;

  if p_party <= 6 then
    select s.*
    into v_slot
    from slot_tables s
    where s.seats >= p_party
      and not exists (
        select 1
        from booking_slots b
        where b.slot_table_id = s.id and b.during && v_during
      )
    order by s.seats, s.label
    limit 1;

    if v_slot.id is null then
      raise exception using message = 'slot_taken';
    end if;

    begin
      insert into booking_slots (booking_id, slot_table_id, during)
      values (v_booking_id, v_slot.id, v_during);
    exception when exclusion_violation then
      raise exception using message = 'slot_taken';
    end;

    return query select v_code, v_status, array[v_slot.label], p_start;
  else
    return query select v_code, v_status, array[]::text[], p_start;
  end if;
end;
$$;

drop function if exists public.cancel_booking(text, text);

create function public.cancel_booking(p_code text, p_phone_last4 text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_actual_last4 text;
  v_matches boolean;
  v_start timestamptz;
begin
  select * into v_booking from bookings where code = p_code;
  v_actual_last4 := case
    when v_booking.id is null then '0000'
    else right(regexp_replace(v_booking.phone, '\D', '', 'g'), 4)
  end;
  -- Built-in sha256 (no extension needed). pgcrypto lives in the "extensions" schema on
  -- Supabase and is not visible with search_path = public.
  v_matches := sha256(convert_to(v_actual_last4, 'UTF8')) =
    sha256(convert_to(coalesce(p_phone_last4, ''), 'UTF8'));

  if v_booking.id is null or not v_matches then
    return false;
  end if;
  if v_booking.status = 'cancelled' then
    raise exception using message = 'already_cancelled';
  end if;

  v_start := (v_booking.date + v_booking.start_time)
    at time zone 'Asia/Kolkata';
  if v_start - clock_timestamp() < interval '2 hours' then
    raise exception using message = 'too_late';
  end if;

  update bookings set status = 'cancelled' where id = v_booking.id;
  delete from booking_slots where booking_id = v_booking.id;
  return true;
end;
$$;

create or replace function public.get_availability(p_date date, p_party integer)
returns table(start_time time, remaining integer, requestable boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_open_minutes integer;
  v_last_minutes integer;
  v_minutes integer;
  v_start timestamptz;
  v_during tstzrange;
begin
  if p_party is null or p_party < 1 or p_party > 12 then
    raise exception using message = 'party_too_large';
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 30 then
    raise exception using message = 'outside_window';
  end if;
  if extract(isodow from p_date) = 1 then
    raise exception using message = 'closed_day';
  end if;

  if extract(isodow from p_date) = 7
    and extract(month from p_date) in (10, 11)
  then
    v_open_minutes := 7 * 60;
    v_last_minutes := 22 * 60;
  elsif extract(isodow from p_date) in (6, 7) then
    v_open_minutes := 8 * 60;
    v_last_minutes := 22 * 60;
  else
    v_open_minutes := 8 * 60;
    v_last_minutes := 20 * 60 + 30;
  end if;

  for v_minutes in v_open_minutes..v_last_minutes by 30
  loop
    start_time := make_time(v_minutes / 60, mod(v_minutes, 60), 0);
    v_start := (p_date + start_time) at time zone 'Asia/Kolkata';
    if p_date = v_today and v_start < v_now + interval '2 hours' then
      continue;
    end if;
    if p_party >= 8 and v_start < v_now + interval '24 hours' then
      continue;
    end if;

    if p_party >= 7 then
      remaining := null;
      requestable := true;
    else
      v_during := tstzrange(v_start, v_start + interval '90 minutes', '[)');
      select count(*)::integer
      into remaining
      from slot_tables s
      where s.seats >= p_party
        and not exists (
          select 1
          from booking_slots b
          where b.slot_table_id = s.id and b.during && v_during
        );
      requestable := false;
    end if;
    return next;
  end loop;
end;
$$;

revoke all on function public.create_booking(text, text, text, date, time, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_booking(text, text) from public, anon, authenticated;
revoke all on function public.get_availability(date, integer) from public, anon, authenticated;
grant execute on function public.create_booking(text, text, text, date, time, integer, text, text, jsonb) to service_role;
grant execute on function public.cancel_booking(text, text) to service_role;
grant execute on function public.get_availability(date, integer) to service_role;
