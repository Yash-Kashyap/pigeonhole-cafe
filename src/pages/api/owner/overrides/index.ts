import type { APIRoute } from 'astro';
import { clearKnowledgeOverrideCache } from '../../../../lib/assistant/facts';
import { answerInputSchema } from '../../../../lib/owner/ai';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../lib/owner/http';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const { data, error } = await client
      .from('knowledge_overrides')
      .select('id,question,answer,created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return jsonResponse({ overrides: data ?? [], limit: 50 });
  } catch {
    return jsonResponse({ message: 'Answers are unavailable.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = answerInputSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the question and answer.' }, 400);
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
    const { data, error } = await client.rpc('owner_insert_override', {
      p_question: parsed.data.question,
      p_answer: parsed.data.answer,
    });
    if (error) {
      if (error.message.includes('override_limit'))
        return jsonResponse(
          {
            message:
              'The 50-answer limit has been reached. Delete an answer before adding another.',
          },
          409,
        );
      throw error;
    }
    clearKnowledgeOverrideCache();
    return jsonResponse({ override: data }, 201);
  } catch {
    return jsonResponse({ message: 'The answer could not be saved.' }, 500);
  }
};
