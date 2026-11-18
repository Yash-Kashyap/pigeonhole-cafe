import type { APIRoute } from 'astro';
import {
  placeEnquiry,
  type DatabaseEnquiry,
} from '../../lib/enquiries/enquiries';
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
    return json({ message: 'Enquiry request is too large.' }, 400);

  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384)
      return json({ message: 'Enquiry request is too large.' }, 400);
    raw = JSON.parse(text) as unknown;
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
    return json({ message: 'Enquiry service is unavailable.' }, 500);
  }

  const result = await placeEnquiry(raw, requestIp(request), {
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
    async createEnquiry(params) {
      const { data, error } = await client
        .from('enquiries')
        .insert({
          kind: params.kind,
          name: params.name,
          phone: params.phone,
          email: params.email,
          payload: params.payload,
        })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Missing enquiry id.');
      return data.id;
    },
    async readEnquiry(id) {
      const { data, error } = await client
        .from('enquiries')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as DatabaseEnquiry | null;
    },
  });

  return json(
    result.body,
    result.status,
    result.status === 429 ? { 'Retry-After': String(result.retryAfter) } : {},
  );
};
