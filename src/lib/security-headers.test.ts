import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './security-headers';

describe('security response headers', () => {
  it('sets the required headers on pages', () => {
    const headers = applySecurityHeaders(new Headers(), '/menu');
    expect(headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    expect(headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headers.get('Permissions-Policy')).toContain('microphone=()');
    expect(headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('omits CORP on API paths', () => {
    expect(
      applySecurityHeaders(new Headers(), '/api/orders').has(
        'Cross-Origin-Resource-Policy',
      ),
    ).toBe(false);
  });
});
