import type { APIRoute } from 'astro';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export const prerender = false;
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
export const GET: APIRoute = async ({ params, request }) => {
  const code = params.code ?? '';
  if (!/^PH-ORD-\d{4,}$/.test(code))
    return json({ message: 'Order not found.' }, 404);
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  try {
    const env = readServerEnv();
    const client = createServerSupabaseClient(env);
    const key = await hash(`${env.RATE_LIMIT_SALT}:order-status:${ip}`);
    const { data: allowed, error: rateError } = await client.rpc(
      'hit_rate_limit',
      { p_key: key, p_window_seconds: 3600, p_max: 720 },
    );
    if (rateError) throw rateError;
    if (allowed !== true)
      return new Response(
        JSON.stringify({ message: 'Please wait before checking again.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Retry-After': '3600',
          },
        },
      );
    const { data, error } = await client
      .from('orders')
      .select('status')
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    return data
      ? json({ status: data.status })
      : json({ message: 'Order not found.' }, 404);
  } catch {
    return json({ message: 'Order status is unavailable.' }, 500);
  }
};
