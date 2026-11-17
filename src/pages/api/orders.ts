import type { APIRoute } from 'astro';
import {
  placeOrder,
  type DatabaseMenuItem,
} from '../../lib/orders/place-order';
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
    const testName = ['x', 'ph', 'test', 'ip'].join('-');
    const testIp = request.headers.get(testName);
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
    return json({ message: 'Order request is too large.' }, 400);
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 16_384)
      return json({ message: 'Order request is too large.' }, 400);
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
    return json({ message: 'Order service is unavailable.' }, 500);
  }
  const result = await placeOrder(raw, requestIp(request), {
    salt: env.RATE_LIMIT_SALT,
    hash,
    now: () => new Date(),
    async loadMenuItems(ids) {
      const { data, error } = await client
        .from('menu_items')
        .select('id,name,price_usd,prep_minutes,available')
        .in('id', ids);
      if (error) throw error;
      return (data ?? []) as DatabaseMenuItem[];
    },
    async hitRateLimit(key, windowSeconds, max) {
      const { data, error } = await client.rpc('hit_rate_limit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max: max,
      });
      if (error) throw error;
      return data === true;
    },
    async createOrder(params) {
      const { data, error } = await client.rpc('create_order', {
        p_name: params.name,
        p_phone: params.phone,
        p_pickup: params.pickupAt,
        p_notes: params.notes,
        p_source: params.source,
        p_items: params.items,
      });
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('Unexpected order code.');
      return data;
    },
    async readOrder(code) {
      const { data, error } = await client
        .from('orders')
        .select('code,pickup_at,subtotal')
        .eq('code', code)
        .maybeSingle();
      if (error) throw error;
      return data as {
        code: string;
        pickup_at: string;
        subtotal: number;
      } | null;
    },
  });
  return json(
    result.body,
    result.status,
    result.status === 429 ? { 'Retry-After': String(result.retryAfter) } : {},
  );
};
