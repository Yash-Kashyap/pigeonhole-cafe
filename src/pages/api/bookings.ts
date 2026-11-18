import type { APIRoute } from 'astro';
import {
  placeBooking,
  type AvailabilityRow,
  type BookingPreorder,
  type DatabaseBooking,
} from '../../lib/bookings/bookings';
import { readServerEnv } from '../../lib/server-env';
import { createServerSupabaseClient } from '../../lib/supabase/server';

export const prerender = false;

const json = (body: object, status: number, extra: HeadersInit = {}) =>
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
function requestIp(request: Request) {
  if (import.meta.env.DEV) {
    const testIp = request.headers.get('x-ph-test-ip');
    if (testIp) return testIp;
  }
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
function isSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}
type RawBooking = {
  code: string;
  status: string;
  date: string;
  start_time: string;
  party_size: number;
  preorder: BookingPreorder | null;
  booking_slots:
    | {
        slot_tables: { label: string } | { label: string }[] | null;
      }[]
    | null;
};
function bookingFromRow(row: RawBooking): DatabaseBooking {
  const slotLabels = (row.booking_slots ?? []).flatMap((slot) => {
    if (Array.isArray(slot.slot_tables))
      return slot.slot_tables.map((table) => table.label);
    return slot.slot_tables ? [slot.slot_tables.label] : [];
  });
  return {
    code: row.code,
    status: row.status,
    date: row.date,
    start_time: row.start_time,
    party_size: row.party_size,
    preorder: row.preorder,
    slot_labels: slotLabels,
  };
}

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request))
    return json({ message: 'Invalid request origin.' }, 400);
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return json({ message: 'Send JSON data.' }, 400);
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 16_384)
    return json({ message: 'Booking request is too large.' }, 400);
  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384)
      return json({ message: 'Booking request is too large.' }, 400);
    raw = JSON.parse(text);
  } catch {
    return json({ message: 'Send valid JSON data.' }, 400);
  }

  let env: ReturnType<typeof readServerEnv>;
  let client: ReturnType<typeof createServerSupabaseClient>;
  try {
    env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing salt.');
    client = createServerSupabaseClient(env);
  } catch {
    return json({ message: 'Booking service is unavailable.' }, 500);
  }

  const result = await placeBooking(raw, requestIp(request), {
    salt: env.RATE_LIMIT_SALT,
    hash,
    now: () => new Date(),
    async hitRateLimit(key, windowSeconds, max) {
      const { data, error } = await client.rpc('hit_rate_limit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max: max,
      });
      if (error) throw error;
      return data === true;
    },
    async createBooking(params) {
      const { data, error } = await client.rpc('create_booking', {
        p_name: params.name,
        p_phone: params.phone,
        p_email: params.email,
        p_date: params.date,
        p_start: params.time,
        p_party: params.partySize,
        p_occasion: params.occasion,
        p_notes: params.notes,
        p_preorder: params.preorder,
      });
      if (error) throw new Error(error.message);
      const first = Array.isArray(data) ? data[0] : null;
      if (
        !first ||
        typeof first !== 'object' ||
        !('code' in first) ||
        typeof first.code !== 'string'
      )
        throw new Error('Unexpected booking code.');
      return first.code;
    },
    async readBooking(code) {
      const { data, error } = await client
        .from('bookings')
        .select(
          'code,status,date,start_time,party_size,preorder,booking_slots(slot_tables(label))',
        )
        .eq('code', code)
        .maybeSingle();
      if (error) throw error;
      return data ? bookingFromRow(data as unknown as RawBooking) : null;
    },
    async getAvailability(date, party) {
      const { data, error } = await client.rpc('get_availability', {
        p_date: date,
        p_party: party,
      });
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
  });
  return json(
    result.body,
    result.status,
    result.status === 429 ? { 'Retry-After': String(result.retryAfter) } : {},
  );
};
