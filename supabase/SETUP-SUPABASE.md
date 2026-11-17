# Supabase setup for The Pigeonhole Café (demo)

## Why Supabase
The booking rules need a database that can refuse a double booking even when two people click at the same moment. Postgres does this with an exclusion constraint (`booking_slots`), which is why the plan uses Supabase. It also gives you owner login (Auth), live updates for the dashboard (Realtime) and row-level security in one free-tier project. Alternatives (Firebase, Cloudflare D1, PocketBase) can work, but none has an exclusion constraint, so you would write that safety logic yourself.

The Design prototype (the artifact) cannot talk to Supabase: published pages block outside network calls. Supabase is for the real Astro build described in `docs/00-MASTER-PROMPT.md`.

## Steps (about 20 minutes)
1. Create a free account at supabase.com and a new project. Region: pick one near your clients (for example Frankfurt for Europe, N. Virginia for America). Save the database password in your password manager.
2. Open **SQL Editor**. Paste and run `migrations/0001_init.sql`, then `migrations/0002_seed_menu.sql`. Check **Table Editor**: `menu_items` should show 240 rows and `slot_tables` 16.
3. Open **Project Settings > API Keys**. Copy the Project URL (`https://<project-ref>.supabase.co`, without `/rest/v1/`), the **publishable key** (`sb_publishable_...`) and the **secret key** (`sb_secret_...`) into your local `.env` (see `.env.example`). The secret key goes only on the server (Cloudflare secret). Never put it in browser code or in git. Do not use the legacy `anon` and `service_role` keys; they are retired in early 2027.
4. Create the owner login: **Authentication > Users > Add user**, enter an email and a strong password you choose, tick auto-confirm. Then in the SQL Editor run (with your email):
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"owner"}' where email = 'you@example.com';`
   Only users with this role can read bookings, orders and enquiries. Do not put the password in the repo.
5. **Authentication > Providers**: keep Email on. For the owner dashboard turn off "Allow new users to sign up" so strangers cannot create accounts.
6. **Authentication > URL configuration**: add your site URL and `http://localhost:4321`.
7. Test with the SQL editor:
   - `select * from create_booking('Demo Guest','+910000000000',null,current_date + 2,'19:00',4);` should return a code, `confirmed` and a slot label (skip if that date is a Monday).
   - Run the same call again for 7 people: status `requested`, no slot.
   - `select cancel_booking('PH-BK-1000','0000');`

## Customers: sign up and sign in
The plan deliberately has no customer accounts: guests book with name and phone, and look up a booking with its code plus the last 4 digits of the phone. That keeps the demo fast. If a client wants accounts later, use Supabase Auth with email magic links (no passwords to store), add a `user_id` column to `bookings` and `orders`, and add a row-level-security policy `user_id = auth.uid()`. Ask before adding it, because it changes the booking and order pages.

## Safety checklist
- All public writes go through server endpoints that validate with Zod, then call the functions with the service-role key.
- Never trust prices from the browser: `create_order` reads prices from `menu_items`.
- Rate limits use `hit_rate_limit` with hashed keys. Do not store raw IPs or phone numbers there.
- Seed demo history with `seeded = true` rows so `scripts/wipe-seed.ts` can remove it before a client launch.
