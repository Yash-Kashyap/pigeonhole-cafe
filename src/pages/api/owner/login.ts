import type { APIRoute } from 'astro';
import { saltedRateLimitKey } from '../../../lib/orders/place-order';
import {
  jsonResponse,
  readJsonBody,
  requestIp,
  sha256,
} from '../../../lib/owner/http';
import { ownerLoginSchema } from '../../../lib/owner/schemas';
import {
  ownerSessionExpiry,
  setOwnerSessionCookies,
} from '../../../lib/owner/session';
import { readServerEnv } from '../../../lib/server-env';
import {
  createPublicServerSupabaseClient,
  createServerSupabaseClient,
} from '../../../lib/supabase/server';

export const prerender = false;
const GENERIC_ERROR = 'Email or password is wrong.';

async function waitForMinimum(startedAt: number, milliseconds: number) {
  const remaining = milliseconds - (Date.now() - startedAt);
  if (remaining > 0)
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
}

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const startedAt = Date.now();
  const body = await readJsonBody(request, 4_096);
  if (!body.ok) return body.response;

  let env: ReturnType<typeof readServerEnv>;
  let service: ReturnType<typeof createServerSupabaseClient>;
  try {
    env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing rate-limit key.');
    service = createServerSupabaseClient(env);
  } catch {
    return jsonResponse({ message: 'Owner service is unavailable.' }, 500);
  }

  const raw = body.value;
  const rawEmail =
    raw &&
    typeof raw === 'object' &&
    'email' in raw &&
    typeof raw.email === 'string'
      ? raw.email.trim().toLowerCase()
      : 'invalid';
  try {
    const ipKey = await saltedRateLimitKey(
      { hash: sha256, salt: env.RATE_LIMIT_SALT },
      'owner-login-ip',
      requestIp(request),
    );
    const emailKey = await saltedRateLimitKey(
      { hash: sha256, salt: env.RATE_LIMIT_SALT },
      'owner-login-email',
      rawEmail,
    );
    const [ipLimit, emailLimit] = await Promise.all([
      service.rpc('hit_rate_limit', {
        p_key: ipKey,
        p_window_seconds: 600,
        p_max: 5,
      }),
      service.rpc('hit_rate_limit', {
        p_key: emailKey,
        p_window_seconds: 600,
        p_max: 5,
      }),
    ]);
    if (ipLimit.error || emailLimit.error)
      throw ipLimit.error ?? emailLimit.error;
    if (ipLimit.data !== true || emailLimit.data !== true)
      return jsonResponse(
        { message: 'Too many sign-in attempts. Please try again later.' },
        429,
        { 'Retry-After': '600' },
      );
  } catch {
    return jsonResponse({ message: 'Owner service is unavailable.' }, 500);
  }

  const parsed = ownerLoginSchema.safeParse(raw);
  if (!parsed.success) {
    await waitForMinimum(startedAt, 500);
    return jsonResponse({ message: 'Send valid login details.' }, 400);
  }

  try {
    const publicClient = createPublicServerSupabaseClient(env);
    const signedIn = await publicClient.auth.signInWithPassword({
      email: parsed.data.email.toLowerCase(),
      password: parsed.data.password,
    });
    const session = signedIn.data.session;
    if (signedIn.error || !session) {
      await waitForMinimum(startedAt, 500);
      return jsonResponse({ message: GENERIC_ERROR }, 401);
    }

    const verified = await service.auth.getUser(session.access_token);
    if (
      verified.error ||
      !verified.data.user ||
      verified.data.user.app_metadata.role !== 'owner'
    ) {
      await service.auth.admin.signOut(session.access_token, 'local');
      await waitForMinimum(startedAt, 500);
      return jsonResponse({ message: GENERIC_ERROR }, 401);
    }

    const expiresAt = ownerSessionExpiry(new Date());
    await setOwnerSessionCookies(
      cookies,
      url,
      session.access_token,
      session.refresh_token,
      expiresAt,
      env.RATE_LIMIT_SALT,
    );
    await waitForMinimum(startedAt, 500);
    return jsonResponse({ signedIn: true }, 200);
  } catch {
    await waitForMinimum(startedAt, 500);
    return jsonResponse({ message: 'Owner service is unavailable.' }, 500);
  }
};
