-- The Pigeonhole Café (fictional demo). Run in the Supabase SQL editor, or with `supabase db push`.
-- Order: this file, then 0002_seed_menu.sql.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ───────── tables ─────────
create table menu_items (
  id text primary key,
  category text not null, subcategory text,
  name text not null, description text,
  price_usd numeric(6,2) not null check (price_usd >= 0),
  vegan boolean not null default false, jain_option boolean not null default false, gluten_free boolean not null default false,
  allergens text[] not null default '{}', spice_level int not null default 0,
  prep_minutes int, tags text[] not null default '{}',
  available boolean not null default true
);

create table slot_tables (
  id text primary key, label text not null unique,
  seats int not null check (seats in (2,4,6))
);
insert into slot_tables (id,label,seats)
select 'S'||n, 'SLOT '||lpad(n::text,2,'0'), case when n<=6 then 2 when n<=12 then 4 else 6 end
from generate_series(1,16) n;

create sequence booking_seq start 1000;
create sequence order_seq start 1000;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null, phone text not null, email text,
  date date not null, start_time time not null, party_size int not null check (party_size between 1 and 12),
  status text not null check (status in ('confirmed','requested','declined','cancelled','seated','no_show')),
  occasion text, notes text check (char_length(notes) <= 200),
  preorder jsonb, preorder_sent boolean not null default false,
  decline_reason text, cancel_reason text,
  seeded boolean not null default false, created_at timestamptz not null default now()
);
create index on bookings (date, start_time);

create table booking_slots (
  booking_id uuid not null references bookings(id) on delete cascade,
  slot_table_id text not null references slot_tables(id),
  during tstzrange not null,
  exclude using gist (slot_table_id with =, during with &&)   -- final guard against double booking
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null, phone text not null,
  pickup_at timestamptz, notes text check (char_length(notes) <= 200),
  subtotal numeric(8,2) not null,
  status text not null default 'new' check (status in ('new','preparing','ready','collected','cancelled')),
  source text not null default 'site' check (source in ('site','assistant')),
  cancel_reason text, seeded boolean not null default false, created_at timestamptz not null default now()
);
create index on orders (created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id text not null, name_snapshot text not null, price_snapshot numeric(6,2) not null,
  qty int not null check (qty between 1 and 20), note text
);

create table enquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('private_table','open_mic','general')),
  name text not null, phone text, email text, payload jsonb not null default '{}',
  status text not null default 'new' check (status in ('new','contacted','done')),
  seeded boolean not null default false, created_at timestamptz not null default now()
);

create table assistant_logs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null, role text not null, content text not null,
  answered boolean not null default true, unanswered_topic text, handled boolean not null default false,
  tool_calls jsonb, seeded boolean not null default false, created_at timestamptz not null default now()
);

create table knowledge_overrides (
  id uuid primary key default gen_random_uuid(),
  question text not null, answer text not null, created_at timestamptz not null default now()
);

create table rate_limits (key text not null, window_start timestamptz not null, hits int not null default 0, primary key (key, window_start));
create table daily_usage (day date primary key, input_tokens bigint not null default 0, output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0, cache_write_tokens bigint not null default 0, est_cost_usd numeric(8,4) not null default 0);
create table daily_summaries (day date primary key, content text not null, created_at timestamptz not null default now());

-- ───────── row level security ─────────
-- Public (anon) can only read the menu and slot list. All other writes go through server endpoints using the service-role key.
-- The owner is a Supabase Auth user whose app_metadata.role = 'owner'.
create or replace function is_owner() returns boolean language sql stable as
$$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'owner' $$;

alter table menu_items enable row level security;
alter table slot_tables enable row level security;
create policy "public read menu" on menu_items for select using (true);
create policy "public read slots" on slot_tables for select using (true);
create policy "owner edits menu" on menu_items for update using (is_owner()) with check (is_owner());

do $$ declare t text; begin
  foreach t in array array['bookings','booking_slots','orders','order_items','enquiries','assistant_logs','knowledge_overrides','daily_summaries']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "owner all" on %I for all using (is_owner()) with check (is_owner())', t);
  end loop;
end $$;
-- rate_limits and daily_usage: RLS on, no policies => only the service role can touch them.
alter table rate_limits enable row level security;
alter table daily_usage enable row level security;

-- Realtime for the owner dashboard
alter publication supabase_realtime add table orders, bookings, enquiries, assistant_logs;

-- ───────── atomic functions (called with the service-role client) ─────────
create or replace function create_booking(
  p_name text, p_phone text, p_email text, p_date date, p_start time, p_party int,
  p_occasion text default null, p_notes text default null, p_preorder jsonb default null
) returns table(code text, status text, slot_labels text[])
language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz := (p_date + p_start) at time zone 'Asia/Kolkata';
  v_during tstzrange := tstzrange(v_start, v_start + interval '90 minutes');
  v_code text := 'PH-BK-' || lpad(nextval('booking_seq')::text, 4, '0');
  v_id uuid; v_slot slot_tables; v_status text;
begin
  if p_party < 1 or p_party > 12 then raise exception 'party_size_out_of_range'; end if;
  if extract(dow from p_date) = 1 then raise exception 'closed_monday'; end if;
  perform pg_advisory_xact_lock(hashtext(p_date::text));
  v_status := case when p_party <= 6 then 'confirmed' else 'requested' end;
  insert into bookings (code,name,phone,email,date,start_time,party_size,status,occasion,notes,preorder)
    values (v_code,p_name,p_phone,p_email,p_date,p_start,p_party,v_status,p_occasion,p_notes,p_preorder) returning id into v_id;
  if p_party <= 6 then
    select s.* into v_slot from slot_tables s
      where s.seats >= p_party
        and not exists (select 1 from booking_slots b where b.slot_table_id = s.id and b.during && v_during)
      order by s.seats, s.label limit 1;
    if v_slot.id is null then raise exception 'no_slot_free'; end if;
    insert into booking_slots (booking_id, slot_table_id, during) values (v_id, v_slot.id, v_during);
    return query select v_code, v_status, array[v_slot.label];
  else
    return query select v_code, v_status, array[]::text[];
  end if;
end $$;

create or replace function cancel_booking(p_code text, p_phone_last4 text)
returns boolean language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where code = p_code and right(regexp_replace(phone,'\D','','g'),4) = p_phone_last4;
  if b.id is null then return false; end if;
  if ((b.date + b.start_time) at time zone 'Asia/Kolkata') - now() < interval '2 hours' then raise exception 'too_late_to_cancel'; end if;
  update bookings set status = 'cancelled' where id = b.id;
  delete from booking_slots where booking_id = b.id;
  return true;
end $$;

create or replace function create_order(p_name text, p_phone text, p_pickup timestamptz, p_notes text, p_source text, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := 'PH-ORD-' || lpad(nextval('order_seq')::text, 4, '0'); v_id uuid; v_sub numeric(8,2);
begin
  select coalesce(sum(m.price_usd * (i->>'qty')::int),0) into v_sub
    from jsonb_array_elements(p_items) i join menu_items m on m.id = i->>'id' where m.available;
  if v_sub <= 0 then raise exception 'empty_order'; end if;
  insert into orders (code,name,phone,pickup_at,notes,subtotal,source) values (v_code,p_name,p_phone,p_pickup,p_notes,v_sub,p_source) returning id into v_id;
  insert into order_items (order_id,menu_item_id,name_snapshot,price_snapshot,qty)
    select v_id, m.id, m.name, m.price_usd, (i->>'qty')::int from jsonb_array_elements(p_items) i join menu_items m on m.id = i->>'id' where m.available;
  return v_code;   -- prices always come from the database, never from the browser
end $$;

create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); h int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits into h;
  return h <= p_max;
end $$;

create or replace function add_usage(p_day date, p_in bigint, p_out bigint, p_cache_read bigint, p_cache_write bigint, p_cost numeric)
returns void language sql security definer set search_path = public as $$
  insert into daily_usage as d (day,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,est_cost_usd)
  values (p_day,p_in,p_out,p_cache_read,p_cache_write,p_cost)
  on conflict (day) do update set input_tokens = d.input_tokens + excluded.input_tokens, output_tokens = d.output_tokens + excluded.output_tokens,
    cache_read_tokens = d.cache_read_tokens + excluded.cache_read_tokens, cache_write_tokens = d.cache_write_tokens + excluded.cache_write_tokens,
    est_cost_usd = d.est_cost_usd + excluded.est_cost_usd $$;

-- Only the server (service role) may call these.
revoke all on function create_booking, cancel_booking, create_order, hit_rate_limit, add_usage from public, anon, authenticated;
grant execute on function create_booking, cancel_booking, create_order, hit_rate_limit, add_usage to service_role;
