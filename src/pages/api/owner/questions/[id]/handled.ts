import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../../lib/owner/http';
import { readServerEnv } from '../../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../../lib/supabase/server';

export const prerender = false;

export const POST: APIRoute = async ({ request, params, locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  const id = z.uuid().safeParse(params.id);
  if (!id.success) return jsonResponse({ message: 'Question not found.' }, 404);
  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  if (!z.object({}).strict().safeParse(body.value).success)
    return jsonResponse({ message: 'Send an empty JSON object.' }, 400);
  try {
    const env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing rate-limit salt.');
    const client = createServerSupabaseClient(env);
    if (
      !(await ownerWriteAllowed(client, env.RATE_LIMIT_SALT, locals.owner.id))
    )
      return jsonResponse({ message: 'Too many owner changes.' }, 429, {
        'Retry-After': '600',
      });
    const { data, error } = await client
      .from('assistant_logs')
      .update({ handled: true })
      .eq('id', id.data)
      .eq('role', 'assistant')
      .eq('answered', false)
      .not('unanswered_topic', 'is', null)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ message: 'Question not found.' }, 404);
    return jsonResponse({ id: data.id, handled: true });
  } catch {
    return jsonResponse({ message: 'The question could not be updated.' }, 500);
  }
};
