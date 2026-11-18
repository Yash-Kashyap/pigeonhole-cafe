import type { User } from '@supabase/supabase-js';
import { readServerEnv } from '../server-env';
import {
  createPublicServerSupabaseClient,
  createServerSupabaseClient,
} from '../supabase/server';
import {
  OWNER_ACCESS_COOKIE,
  OWNER_EXPIRY_COOKIE,
  OWNER_REFRESH_COOKIE,
  accessTokenExpiresAt,
  clearOwnerSessionCookies,
  setOwnerSessionCookies,
  shouldRefreshAccessToken,
  verifyOwnerExpiry,
  type OwnerCookieStore,
} from './session';

export type OwnerIdentity = {
  id: string;
  email: string;
  role: 'owner';
  expiresAt: string;
};

export type OwnerSession = OwnerIdentity & {
  accessToken: string;
  refreshToken: string;
};

export type OwnerAuthResult =
  | { kind: 'owner'; session: OwnerSession }
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' };

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}

function invalidAuthError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === 400 || status === 401 || status === 403 || status === 404;
}

function ownerFromUser(
  user: User,
  accessToken: string,
  refreshToken: string,
  expiresAtSeconds: number,
): OwnerSession | null {
  if (user.app_metadata.role !== 'owner') return null;
  return {
    id: user.id,
    email: user.email ?? '',
    role: 'owner',
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    accessToken,
    refreshToken,
  };
}

async function refreshSession(
  source: Record<string, unknown>,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const client = createPublicServerSupabaseClient(source);
  const { data, error } = await client.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data.session) return null;
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

export async function verifyOwnerRequest(
  requestUrl: URL,
  cookies: OwnerCookieStore,
  now = new Date(),
): Promise<OwnerAuthResult> {
  let source: ReturnType<typeof readServerEnv>;
  try {
    source = readServerEnv();
    if (!source.RATE_LIMIT_SALT) throw new Error('Missing session key.');
  } catch {
    return { kind: 'unavailable' };
  }

  const expiresAtSeconds = await verifyOwnerExpiry(
    cookies.get(OWNER_EXPIRY_COOKIE)?.value,
    source.RATE_LIMIT_SALT,
    now,
  );
  const originalAccessToken = cookies.get(OWNER_ACCESS_COOKIE)?.value;
  const originalRefreshToken = cookies.get(OWNER_REFRESH_COOKIE)?.value;
  if (!expiresAtSeconds || !originalAccessToken || !originalRefreshToken) {
    clearOwnerSessionCookies(cookies, requestUrl);
    return { kind: 'unauthenticated' };
  }

  let accessToken = originalAccessToken;
  let refreshToken = originalRefreshToken;
  const service = createServerSupabaseClient(source);
  let verified = await service.auth.getUser(accessToken);

  if (verified.error) {
    const tokenExpiry = accessTokenExpiresAt(accessToken);
    const expired =
      tokenExpiry !== null && tokenExpiry <= Math.floor(now.getTime() / 1000);
    if (!expired) {
      clearOwnerSessionCookies(cookies, requestUrl);
      return invalidAuthError(verified.error)
        ? { kind: 'unauthenticated' }
        : { kind: 'unavailable' };
    }
    const refreshed = await refreshSession(source, refreshToken);
    if (!refreshed) {
      clearOwnerSessionCookies(cookies, requestUrl);
      return { kind: 'unauthenticated' };
    }
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
    verified = await service.auth.getUser(accessToken);
    if (verified.error || !verified.data.user) {
      clearOwnerSessionCookies(cookies, requestUrl);
      return invalidAuthError(verified.error)
        ? { kind: 'unauthenticated' }
        : { kind: 'unavailable' };
    }
    await setOwnerSessionCookies(
      cookies,
      requestUrl,
      accessToken,
      refreshToken,
      expiresAtSeconds,
      source.RATE_LIMIT_SALT,
    );
  }

  const user = verified.data.user;
  if (!user) return { kind: 'unauthenticated' };
  const owner = ownerFromUser(
    user,
    accessToken,
    refreshToken,
    expiresAtSeconds,
  );
  if (!owner) return { kind: 'forbidden' };

  if (shouldRefreshAccessToken(accessToken, now)) {
    const refreshed = await refreshSession(source, refreshToken);
    if (refreshed) {
      const refreshedUser = await service.auth.getUser(refreshed.accessToken);
      const refreshedOwner = refreshedUser.data.user
        ? ownerFromUser(
            refreshedUser.data.user,
            refreshed.accessToken,
            refreshed.refreshToken,
            expiresAtSeconds,
          )
        : null;
      if (refreshedOwner) {
        await setOwnerSessionCookies(
          cookies,
          requestUrl,
          refreshed.accessToken,
          refreshed.refreshToken,
          expiresAtSeconds,
          source.RATE_LIMIT_SALT,
        );
        return { kind: 'owner', session: refreshedOwner };
      }
    }
  }

  return { kind: 'owner', session: owner };
}
