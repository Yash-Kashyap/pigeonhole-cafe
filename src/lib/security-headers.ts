export function applySecurityHeaders(headers: Headers, pathname: string) {
  headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  if (!pathname.startsWith('/api/')) {
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  return headers;
}
