export const OWNER_ACCESS_COOKIE = 'ph_owner_at';
export const OWNER_REFRESH_COOKIE = 'ph_owner_rt';
export const OWNER_EXPIRY_COOKIE = 'ph_owner_exp';
export const OWNER_SESSION_SECONDS = 8 * 60 * 60;

export type OwnerCookieOptions = {
  httpOnly: true;
  sameSite: 'strict';
  secure: boolean;
  path: '/';
  expires: Date;
};

export type OwnerCookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: OwnerCookieOptions): void;
  delete(
    name: string,
    options: Pick<
      OwnerCookieOptions,
      'httpOnly' | 'sameSite' | 'secure' | 'path'
    >,
  ): void;
};

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function signature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(value)),
    ),
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function signOwnerExpiry(
  expiresAtSeconds: number,
  secret: string,
): Promise<string> {
  const value = String(expiresAtSeconds);
  return `${value}.${await signature(value, secret)}`;
}

export async function verifyOwnerExpiry(
  value: string | undefined,
  secret: string,
  now: Date,
): Promise<number | null> {
  if (!value) return null;
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const expiresAt = Number(match[1]);
  const supplied = match[2] ?? '';
  const expected = await signature(String(expiresAt), secret);
  if (!constantTimeEqual(supplied, expected)) return null;
  return isOwnerSessionActive(expiresAt, now) ? expiresAt : null;
}

export function isOwnerSessionActive(
  expiresAtSeconds: number,
  now: Date,
): boolean {
  return (
    Number.isSafeInteger(expiresAtSeconds) &&
    expiresAtSeconds > Math.floor(now.getTime() / 1000)
  );
}

export function ownerSessionExpiry(now: Date): number {
  return Math.floor(now.getTime() / 1000) + OWNER_SESSION_SECONDS;
}

export function buildOwnerCookieOptions(
  requestUrl: URL,
  expiresAtSeconds: number,
): OwnerCookieOptions {
  const localHttp =
    requestUrl.protocol === 'http:' &&
    (requestUrl.hostname === '127.0.0.1' ||
      requestUrl.hostname === 'localhost');
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: !localHttp,
    path: '/',
    expires: new Date(expiresAtSeconds * 1000),
  };
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name || result.has(name)) continue;
    result.set(name, value);
  }
  return result;
}

export function accessTokenExpiresAt(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const parsed: unknown = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== 'object' || !('exp' in parsed))
      return null;
    const exp = (parsed as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isSafeInteger(exp) ? exp : null;
  } catch {
    return null;
  }
}

export function shouldRefreshAccessToken(token: string, now: Date): boolean {
  const expiresAt = accessTokenExpiresAt(token);
  return (
    expiresAt === null || expiresAt - Math.floor(now.getTime() / 1000) < 5 * 60
  );
}

export async function setOwnerSessionCookies(
  cookies: OwnerCookieStore,
  requestUrl: URL,
  accessToken: string,
  refreshToken: string,
  expiresAtSeconds: number,
  secret: string,
): Promise<void> {
  const options = buildOwnerCookieOptions(requestUrl, expiresAtSeconds);
  cookies.set(OWNER_ACCESS_COOKIE, accessToken, options);
  cookies.set(OWNER_REFRESH_COOKIE, refreshToken, options);
  cookies.set(
    OWNER_EXPIRY_COOKIE,
    await signOwnerExpiry(expiresAtSeconds, secret),
    options,
  );
}

export function clearOwnerSessionCookies(
  cookies: OwnerCookieStore,
  requestUrl: URL,
): void {
  const built = buildOwnerCookieOptions(requestUrl, 0);
  const options = {
    httpOnly: built.httpOnly,
    sameSite: built.sameSite,
    secure: built.secure,
    path: built.path,
  };
  cookies.delete(OWNER_ACCESS_COOKIE, options);
  cookies.delete(OWNER_REFRESH_COOKIE, options);
  cookies.delete(OWNER_EXPIRY_COOKIE, options);
}
