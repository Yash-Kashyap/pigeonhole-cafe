import type { APIRoute } from 'astro';
import { RATE_LIMIT_SALT, PUBLIC_WHATSAPP_NUMBER } from 'astro:env/server';
import { saltedRateLimitKey } from '../lib/orders/place-order';
import { readServerEnv } from '../lib/server-env';
import { createServerSupabaseClient } from '../lib/supabase/server';
import { buildWhatsAppUrl, normaliseWhatsAppNumber } from '../lib/whatsapp';

export const prerender = false;

// Server-side redirect so the WhatsApp number is never written into any page or browser bundle.
const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

export const GET: APIRoute = async ({ url, request }) => {
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  const salt = RATE_LIMIT_SALT;
  if (!salt)
    return new Response('WhatsApp is unavailable.', { status: 503, headers });
  try {
    const ip =
      request.headers.get('CF-Connecting-IP') ??
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';
    const client = createServerSupabaseClient(readServerEnv());
    const key = await saltedRateLimitKey({ hash, salt }, 'whatsapp-ip', ip);
    const { data, error } = await client.rpc('hit_rate_limit', {
      p_key: key,
      p_window_seconds: 3600,
      p_max: 20,
    });
    if (error || data !== true) {
      return new Response(
        data === false ? 'Too many requests.' : 'WhatsApp is unavailable.',
        {
          status: data === false ? 429 : 503,
          headers: {
            ...headers,
            ...(data === false ? { 'Retry-After': '3600' } : {}),
          },
        },
      );
    }
  } catch {
    return new Response('WhatsApp is unavailable.', { status: 503, headers });
  }
  const number = normaliseWhatsAppNumber(PUBLIC_WHATSAPP_NUMBER);
  if (!number) {
    return new Response('WhatsApp is not set up for this demo.', {
      status: 503,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      Location: buildWhatsAppUrl(number, url.searchParams.get('text')),
    },
  });
};
