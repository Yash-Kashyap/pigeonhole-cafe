-- Harden the existing RPC without changing its signature or any table shape.
create or replace function create_order(
  p_name text,
  p_phone text,
  p_pickup timestamptz,
  p_notes text,
  p_source text,
  p_items jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := 'PH-ORD-' || lpad(nextval('order_seq')::text, 4, '0');
  v_order_id uuid;
  v_subtotal numeric(8,2);
  v_items jsonb;
  v_item jsonb;
  v_bad_id text;
  v_total int;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'empty_order';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  if jsonb_array_length(p_items) > 40 then
    raise exception 'too_many_items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or coalesce(v_item->>'id', '') !~ '^PH[0-9]{4}$'
      or coalesce(v_item->>'qty', '') !~ '^[0-9]+$'
    then
      raise exception 'invalid_order_item';
    end if;
  end loop;

  with raw as (
    select value as item, ordinality as ord
    from jsonb_array_elements(p_items) with ordinality
  ), collapsed as (
    select item->>'id' as id, sum((item->>'qty')::int)::int as qty
    from raw
    group by item->>'id'
  ), normalized as (
    select
      c.id,
      c.qty,
      nullif(left(btrim(n.item->>'note'), 80), '') as note
    from collapsed c
    left join lateral (
      select r.item
      from raw r
      where r.item->>'id' = c.id
        and nullif(btrim(r.item->>'note'), '') is not null
      order by r.ord
      limit 1
    ) n on true
  )
  select jsonb_agg(
    jsonb_build_object('id', id, 'qty', qty, 'note', note)
    order by id
  ) into v_items
  from normalized;

  select i.item->>'id' into v_bad_id
  from jsonb_array_elements(v_items) as i(item)
  where (i.item->>'qty')::int < 1 or (i.item->>'qty')::int > 20
  limit 1;
  if v_bad_id is not null then
    raise exception 'too_many_items';
  end if;

  select coalesce(sum((item->>'qty')::int), 0) into v_total
  from jsonb_array_elements(v_items) as i(item);
  if v_total > 40 then
    raise exception 'too_many_items';
  end if;

  select i.item->>'id' into v_bad_id
  from jsonb_array_elements(v_items) as i(item)
  left join menu_items m on m.id = i.item->>'id'
  where m.id is null or not m.available
  limit 1;
  if v_bad_id is not null then
    raise exception 'unavailable_item: %', v_bad_id;
  end if;

  select coalesce(sum(m.price_usd * (i.item->>'qty')::int), 0)
    into v_subtotal
  from jsonb_array_elements(v_items) as i(item)
  join menu_items m on m.id = i.item->>'id';
  if v_subtotal <= 0 then
    raise exception 'empty_order';
  end if;

  insert into orders (code, name, phone, pickup_at, notes, subtotal, source)
  values (v_code, p_name, p_phone, p_pickup, p_notes, v_subtotal, p_source)
  returning id into v_order_id;

  insert into order_items (
    order_id, menu_item_id, name_snapshot, price_snapshot, qty, note
  )
  select
    v_order_id,
    m.id,
    m.name,
    m.price_usd,
    (i.item->>'qty')::int,
    nullif(i.item->>'note', '')
  from jsonb_array_elements(v_items) as i(item)
  join menu_items m on m.id = i.item->>'id';

  return v_code;
end;
$$;
