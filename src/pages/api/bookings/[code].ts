import type { APIRoute } from 'astro';
import { getBookingHoldUntil } from '../../../lib/rules';
import { saltedRateLimitKey } from '../../../lib/orders/place-order';
import type { BookingPreorder } from '../../../lib/bookings/bookings';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export const prerender = false;

const json = (body: object, status = 200, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
type BookingRow = {
  code: string;
  status: string;
  date: string;
  start_time: string;
  party_size: number;
  preorder: BookingPreorder | null;
  booking_slots:
    { slot_tables: { label: string } | { label: string }[] | null }[] | null;
};

export const GET: APIRoute = async ({ params, request }) => {
  const code = params.code ?? '';
  if (!/^PH-BK-\d{4,}$/.test(code))
    return json({ message: 'Booking not found.' }, 404);
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  try {
    const env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing salt.');
    const client = createServerSupabaseClient(env);
    const key = await saltedRateLimitKey(
      { hash, salt: env.RATE_LIMIT_SALT },
      'booking-status-ip',
      ip,
    );
    const { data: allowed, error: rateError } = await client.rpc(
      'hit_rate_limit',
      { p_key: key, p_window_seconds: 3600, p_max: 720 },
    );
    if (rateError) throw rateError;
    if (allowed !== true)
      return json({ message: 'Please wait before checking again.' }, 429, {
        'Retry-After': '3600',
      });
    const { data, error } = await client
      .from('bookings')
      .select(
        'code,status,date,start_time,party_size,preorder,booking_slots(slot_tables(label))',
      )
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ message: 'Booking not found.' }, 404);
    const row = data as unknown as BookingRow;
    const time = row.start_time.slice(0, 5);
    const holdUntil = getBookingHoldUntil(row.date, time);
    if (!holdUntil) throw new Error('Invalid booking time.');
    const slotLabels = (row.booking_slots ?? []).flatMap((slot) => {
      if (Array.isArray(slot.slot_tables))
        return slot.slot_tables.map((table) => table.label);
      return slot.slot_tables ? [slot.slot_tables.label] : [];
    });
    return json({
      code: row.code,
      status: row.status,
      slotLabels,
      date: row.date,
      time,
      party: row.party_size,
      holdUntil: holdUntil.toISOString(),
      preorder: row.preorder ?? { lines: [], total: 0 },
    });
  } catch {
    return json({ message: 'Booking details are unavailable.' }, 500);
  }
};
