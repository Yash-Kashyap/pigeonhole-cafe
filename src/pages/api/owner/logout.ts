import type { APIRoute } from 'astro';
import { jsonResponse, readJsonBody } from '../../../lib/owner/http';
import { clearOwnerSessionCookies } from '../../../lib/owner/session';
import { ownerLogoutSchema } from '../../../lib/owner/schemas';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url, locals }) => {
  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  if (!ownerLogoutSchema.safeParse(body.value).success)
    return jsonResponse({ message: 'Send an empty JSON object.' }, 400);

  try {
    const env = readServerEnv();
    if (!locals.owner) throw new Error('Missing owner context.');
    const client = createServerSupabaseClient(env);
    await client.auth.admin.signOut(locals.owner.accessToken, 'local');
  } catch {
    clearOwnerSessionCookies(cookies, url);
    return jsonResponse({ message: 'Owner service is unavailable.' }, 500);
  }
  clearOwnerSessionCookies(cookies, url);
  return jsonResponse({ signedOut: true });
};
