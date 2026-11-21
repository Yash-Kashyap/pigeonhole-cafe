import type { APIRoute } from 'astro';
import { callProvider } from '@assistant-provider';
import { ASSISTANT_GLOBAL_DAILY_CAP } from '../../../lib/assistant/handler';
import {
  summaryInputSchema,
  summarySystemInstruction,
  summaryDayQuerySchema,
  buildSummaryPayload,
  dayFromRequest,
  type SummaryAggregate,
} from '../../../lib/owner/ai';
import {
  jsonResponse,
  ownerWriteAllowed,
  queryObject,
  readJsonBody,
  sha256,
} from '../../../lib/owner/http';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { createDailySummary } from '../../../lib/owner/summary';

export const prerender = false;
const FRIENDLY_UNAVAILABLE =
  'A summary is unavailable right now. Please try again later.';

async function readCached(
  client: ReturnType<typeof createServerSupabaseClient>,
  day: string,
) {
  const { data, error } = await client
    .from('daily_summaries')
    .select('day,content,created_at')
    .eq('day', day)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? summaryDayQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Choose a valid summary day.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const day = dayFromRequest(parsed.data.day ?? null);
    return jsonResponse({ summary: await readCached(client, day) });
  } catch {
    return jsonResponse({ message: 'The summary is unavailable.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.owner)
    return jsonResponse({ message: 'Sign in is required.' }, 401);
  const body = await readJsonBody(request, 1_024);
  if (!body.ok) return body.response;
  const parsed = summaryInputSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the summary request.' }, 400);

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
    const day = dayFromRequest(null);
    const existing = await readCached(client, day);
    if (existing && !parsed.data.regenerate)
      return jsonResponse({ summary: existing });

    if (parsed.data.regenerate) {
      const key = await sha256(
        `${env.RATE_LIMIT_SALT}:owner-summary-regenerate:${day}:${locals.owner.id}`,
      );
      const { data, error } = await client.rpc('hit_rate_limit', {
        p_key: key,
        p_window_seconds: 86_400,
        p_max: 3,
      });
      if (error) throw error;
      if (data !== true)
        return jsonResponse(
          { message: 'The daily regenerate limit has been reached.' },
          429,
          { 'Retry-After': '86400' },
        );
    }

    if (!env.GEMINI_API_KEY)
      return jsonResponse({ message: FRIENDLY_UNAVAILABLE }, 503);
    const globalKey = await sha256(
      `${env.RATE_LIMIT_SALT}:assistant-global-day:${day}`,
    );
    const { data: withinGlobalLimit, error: globalError } = await client.rpc(
      'hit_rate_limit',
      {
        p_key: globalKey,
        p_window_seconds: 86_400,
        p_max: ASSISTANT_GLOBAL_DAILY_CAP,
      },
    );
    if (globalError) throw globalError;
    if (withinGlobalLimit !== true)
      return jsonResponse({ message: FRIENDLY_UNAVAILABLE }, 503);

    const { data: usage, error: usageError } = await client
      .from('daily_usage')
      .select('input_tokens,output_tokens')
      .eq('day', day)
      .maybeSingle();
    if (usageError) throw usageError;
    if (
      Number(usage?.input_tokens ?? 0) + Number(usage?.output_tokens ?? 0) >=
      env.ASSISTANT_DAILY_TOKEN_CAP
    )
      return jsonResponse({ message: FRIENDLY_UNAVAILABLE }, 503);

    const { data: aggregate, error: aggregateError } = await client.rpc(
      'owner_insights',
      { p_range: 'today' },
    );
    if (aggregateError) throw aggregateError;
    const payload = buildSummaryPayload(aggregate as SummaryAggregate);
    const result = await createDailySummary(payload, {
      generate: (input) =>
        callProvider({
          apiKey: env.GEMINI_API_KEY!,
          model: env.GEMINI_MODEL,
          systemInstruction: summarySystemInstruction(),
          contents: [{ role: 'user', parts: [{ text: input }] }],
          tools: [],
        }),
      async recordUsage(providerUsage) {
        const { error } = await client.rpc('add_usage', {
          p_day: day,
          p_in: providerUsage.promptTokenCount,
          p_out:
            providerUsage.candidatesTokenCount +
            providerUsage.thoughtsTokenCount,
          p_cache_read: providerUsage.cachedContentTokenCount,
          p_cache_write: 0,
          p_cost: 0,
        });
        if (error) throw error;
      },
      async save(content) {
        const { data, error } = await client
          .from('daily_summaries')
          .upsert({ day, content }, { onConflict: 'day' })
          .select('day,content,created_at')
          .single();
        if (error) throw error;
        return data;
      },
    });
    if (!result.ok && result.reason === 'invalid') {
      return jsonResponse(
        {
          message:
            'The generated summary was not in the expected format. Please try again.',
        },
        502,
      );
    }
    if (!result.ok)
      return jsonResponse(
        {
          message:
            result.reason === 'quota'
              ? 'The assistant quota is used for today. Please try again tomorrow.'
              : FRIENDLY_UNAVAILABLE,
        },
        503,
      );
    return jsonResponse({ summary: result.value });
  } catch {
    return jsonResponse({ message: FRIENDLY_UNAVAILABLE }, 503);
  }
};
