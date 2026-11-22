import { defineMiddleware } from 'astro:middleware';
import { verifyOwnerRequest } from './lib/owner/auth';
import { jsonResponse } from './lib/owner/http';
import { applySecurityHeaders } from './lib/security-headers';

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
  const contentType = headers.get('Content-Type') ?? '';
  if (contentType.includes('text/html')) {
    const html = await response.text();
    const cspMeta = html.match(
      /<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"\s*\/?\s*>/i,
    );
    const generatedPolicy = cspMeta?.[1];
    if (generatedPolicy) {
      headers.set(
        'Content-Security-Policy',
        `${generatedPolicy.replaceAll('&amp;', '&')}; frame-ancestors 'none'`,
      );
    }
    response = new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  applySecurityHeaders(headers, pathname);
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
