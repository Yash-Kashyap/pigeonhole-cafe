import { defineMiddleware } from 'astro:middleware';
import { verifyOwnerRequest } from './lib/owner/auth';
import { jsonResponse } from './lib/owner/http';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
].join('; ');

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  const ownerPage = pathname === '/owner' || pathname.startsWith('/owner/');
  const ownerApp =
    pathname === '/owner/app' || pathname.startsWith('/owner/app/');
  const ownerApi = pathname.startsWith('/api/owner/');
  const protectedOwnerApi = ownerApi && pathname !== '/api/owner/login';

  let response: Response;
  if (ownerApp || protectedOwnerApi) {
    const auth = await verifyOwnerRequest(context.url, context.cookies);
    if (auth.kind === 'owner') {
      context.locals.owner = auth.session;
      response = await next();
    } else if (ownerApp) {
      response =
        auth.kind === 'unavailable'
          ? new Response('Owner service is unavailable.', { status: 500 })
          : context.redirect('/owner', 302);
    } else if (auth.kind === 'forbidden') {
      response = jsonResponse({ message: 'Owner access is required.' }, 403);
    } else if (auth.kind === 'unavailable') {
      response = jsonResponse(
        { message: 'Owner service is unavailable.' },
        500,
      );
    } else {
      response = jsonResponse({ message: 'Sign in is required.' }, 401);
    }
  } else {
    response = await next();
  }

  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', contentSecurityPolicy);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  if (ownerPage || ownerApi) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
