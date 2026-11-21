import type { APIRoute } from 'astro';
import { z } from 'zod';
import { clearKnowledgeOverrideCache } from '../../../../../lib/assistant/facts';
import { answerInputSchema } from '../../../../../lib/owner/ai';
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
  const idCheck = z.uuid().safeParse(params.id);
  if (!idCheck.success)
    return jsonResponse({ message: 'Question not found.' }, 404);
  const parsedId = idCheck.data;
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
    const { data, error } = await client.rpc('owner_add_answer_and_handle', {
      p_log_id: parsedId,
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
      if (error.message.includes('question_not_found'))
        return jsonResponse(
          { message: 'Question not found or already handled.' },
          404,
        );
      throw error;
    }
    clearKnowledgeOverrideCache();
    return jsonResponse({ id: data, handled: true }, 201);
  } catch {
    return jsonResponse({ message: 'The answer could not be saved.' }, 500);
  }
};
