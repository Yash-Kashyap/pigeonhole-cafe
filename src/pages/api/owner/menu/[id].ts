import type { APIRoute } from 'astro';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../lib/owner/http';
import { ownerMenuPatchSchema } from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const id = params.id ?? '';
  if (!/^PH\d{4}$/.test(id))
    return jsonResponse({ message: 'Menu item not found.' }, 404);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = ownerMenuPatchSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the menu change.' }, 400);
  try {
    const env = readServerEnv();
    if (!env.RATE_LIMIT_SALT || !locals.owner)
      throw new Error('Missing owner context.');
    const client = createServerSupabaseClient(env);
    if (
      !(await ownerWriteAllowed(client, env.RATE_LIMIT_SALT, locals.owner.id))
    )
      return jsonResponse({ message: 'Too many owner changes.' }, 429, {
        'Retry-After': '600',
      });
    const { data, error } = await client
      .from('menu_items')
      .update(parsed.data)
      .eq('id', id)
      .select('id,name,description,price_usd,available')
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ message: 'Menu item not found.' }, 404);
    return jsonResponse({ item: data });
  } catch {
    return jsonResponse({ message: 'The owner service is unavailable.' }, 500);
  }
};
