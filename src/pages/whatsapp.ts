import type { APIRoute } from 'astro';
import { buildWhatsAppUrl, normaliseWhatsAppNumber } from '../lib/whatsapp';

export const prerender = false;

// Server-side redirect so the WhatsApp number is never written into any page or browser bundle.
export const GET: APIRoute = ({ url }) => {
  const number = normaliseWhatsAppNumber(
    import.meta.env.PUBLIC_WHATSAPP_NUMBER,
  );
  const headers = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow',
  };
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
