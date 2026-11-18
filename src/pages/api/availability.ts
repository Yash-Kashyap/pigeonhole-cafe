import type { APIRoute } from 'astro';
import {
  saltedRateLimitKey,
  type PlaceOrderDependencies,
} from '../../lib/orders/place-order';
import {
  validateAvailabilityQuery,
  type AvailabilityRow,
} from '../../lib/bookings/bookings';
import { readServerEnv } from '../../lib/server-env';
import { createServerSupabaseClient } from '../../lib/supabase/server';

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
const hash: PlaceOrderDependencies['hash'] = async (value) =>
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

export const GET: APIRoute = async ({ request }) => {
  const search = new URL(request.url).searchParams;
  const keys = [...search.keys()];
  if (
    keys.length !== 2 ||
    search.getAll('date').length !== 1 ||
    search.getAll('party').length !== 1 ||
    keys.some((key) => key !== 'date' && key !== 'party')
  )
    return json({ message: 'Send one date and one party size.' }, 400);
  const query = validateAvailabilityQuery(
    { date: search.get('date') ?? '', party: search.get('party') ?? '' },
    new Date(),
  );
  if (!query)
    return json({ message: 'Choose a valid date and party size.' }, 400);

  try {
    const env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing salt.');
    const client = createServerSupabaseClient(env);
    const key = await saltedRateLimitKey(
      { hash, salt: env.RATE_LIMIT_SALT },
      'booking-availability-ip',
      requestIp(request),
    );
    const { data: allowed, error: rateError } = await client.rpc(
      'hit_rate_limit',
      { p_key: key, p_window_seconds: 60, p_max: 60 },
    );
    if (rateError) throw rateError;
    if (allowed !== true)
      return json({ message: 'Please wait before checking again.' }, 429, {
        'Retry-After': '60',
      });
    const { data, error } = await client.rpc('get_availability', {
      p_date: query.date,
      p_party: query.party,
    });
    if (error) throw error;
    const rows = (data ?? []) as AvailabilityRow[];
    return json({
      times: rows.map((row) => ({
        time: row.start_time.slice(0, 5),
        remaining: row.remaining,
        requestable: row.requestable,
      })),
    });
  } catch {
    return json({ message: 'Availability is unavailable.' }, 500);
  }
};
