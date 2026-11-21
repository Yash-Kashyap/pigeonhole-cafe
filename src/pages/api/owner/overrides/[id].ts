import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clearKnowledgeOverrideCache } from '../../../../lib/assistant/facts';
import { overridePatchSchema } from '../../../../lib/owner/ai';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../lib/owner/http';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;
const idSchema = z.uuid();

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  const id = idSchema.safeParse(params.id);
  if (!id.success) return jsonResponse({ message: 'Answer not found.' }, 404);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = overridePatchSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the answer change.' }, 400);
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
      .from('knowledge_overrides')
      .update(parsed.data)
      .eq('id', id.data)
      .select('id,question,answer,created_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ message: 'Answer not found.' }, 404);
    clearKnowledgeOverrideCache();
    return jsonResponse({ override: data });
  } catch {
    return jsonResponse({ message: 'The answer could not be updated.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  const id = idSchema.safeParse(params.id);
  if (!id.success) return jsonResponse({ message: 'Answer not found.' }, 404);
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
      .from('knowledge_overrides')
      .delete()
      .eq('id', id.data)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ message: 'Answer not found.' }, 404);
    clearKnowledgeOverrideCache();
    return jsonResponse({ deleted: true, id: data.id });
  } catch {
    return jsonResponse({ message: 'The answer could not be deleted.' }, 500);
  }
};
