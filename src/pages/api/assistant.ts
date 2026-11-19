import type { APIRoute } from 'astro';
import { z } from 'zod';
import { MENU_CATEGORIES, type MenuItem } from '../../lib/menu';
import type { AvailabilityRow } from '../../lib/bookings/bookings';
import { callProvider } from '@assistant-provider';
import {
  formatAssistantFallbackWarning,
  handleAssistantRequest,
  type AssistantLogInput,
} from '../../lib/assistant/handler';
import { readServerEnv } from '../../lib/server-env';
import { createServerSupabaseClient } from '../../lib/supabase/server';

export const prerender = false;

const json = (body: object, status: number, extra: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });

const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

function requestIp(request: Request) {
  if (import.meta.env.DEV) {
    const testIp = request.headers.get('x-ph-test-ip');
    if (testIp) return testIp;
  }
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function requestNow(request: Request): Date | null {
  const value = import.meta.env.DEV
    ? request.headers.get('x-ph-test-now')
    : null;
  const now = value ? new Date(value) : new Date();
  return Number.isNaN(now.getTime()) ? null : now;
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

const menuRowSchema = z.object({
  id: z.string().regex(/^PH\d{4}$/),
  category: z.enum(MENU_CATEGORIES),
  subcategory: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  price_usd: z.coerce.number().nonnegative(),
  vegan: z.boolean(),
  jain_option: z.boolean(),
  gluten_free: z.boolean(),
  allergens: z.array(z.string()),
  spice_level: z.number().int().min(0).max(3),
  prep_minutes: z.number().int().positive(),
  tags: z.array(z.string()),
  available: z.boolean(),
});

function menuFromRows(rows: unknown): MenuItem[] {
  return z
    .array(menuRowSchema)
    .parse(rows)
    .map((row, sourceIndex) => ({
      ...row,
      subcategory: row.subcategory ?? row.category,
      description: row.description ?? '',
      diet: 'vegetarian' as const,
      spice_level: row.spice_level as 0 | 1 | 2 | 3,
      sourceIndex,
    }));
}

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request))
    return json({ message: 'Invalid request origin.' }, 400);
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return json({ message: 'Send JSON data.' }, 400);
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 16_384)
    return json({ message: 'Assistant request is too large.' }, 400);

  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 16_384)
      return json({ message: 'Assistant request is too large.' }, 400);
    raw = JSON.parse(text) as unknown;
  } catch {
    return json({ message: 'Send valid JSON data.' }, 400);
  }
  const now = requestNow(request);
  if (!now) return json({ message: 'Invalid test clock.' }, 400);

  let env: ReturnType<typeof readServerEnv>;
  let client: ReturnType<typeof createServerSupabaseClient>;
  try {
    env = readServerEnv();
    if (!env.RATE_LIMIT_SALT) throw new Error('Missing rate-limit salt.');
    client = createServerSupabaseClient(env);
  } catch {
    return json({ message: 'Assistant service is unavailable.' }, 500);
  }

  const apiKey = env.GEMINI_API_KEY ?? '';
  let pendingUnansweredLogId: string | null = null;
  const result = await handleAssistantRequest(raw, requestIp(request), now, {
    salt: env.RATE_LIMIT_SALT,
    hash,
    dailyTokenCap: env.ASSISTANT_DAILY_TOKEN_CAP,
    configured: Boolean(apiKey),
    async hitRateLimit(key, windowSeconds, maximum) {
      const { data, error } = await client.rpc('hit_rate_limit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max: maximum,
      });
      if (error) throw error;
      return data === true;
    },
    async readDailyTokens(day) {
      const { data, error } = await client
        .from('daily_usage')
        .select('input_tokens,output_tokens')
        .eq('day', day)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.input_tokens) + Number(data.output_tokens) : 0;
    },
    async loadMenu() {
      const { data, error } = await client
        .from('menu_items')
        .select(
          'id,category,subcategory,name,description,price_usd,vegan,jain_option,gluten_free,allergens,spice_level,prep_minutes,tags,available',
        )
        .order('id');
      if (error) throw error;
      return menuFromRows(data ?? []);
    },
    async loadOverrides() {
      const { data, error } = await client
        .from('knowledge_overrides')
        .select('question,answer')
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    async loadAvailability(date, partySize) {
      const { data, error } = await client.rpc('get_availability', {
        p_date: date,
        p_party: partySize,
      });
      if (error) throw error;
      return (data ?? []) as AvailabilityRow[];
    },
    async callModel(input) {
      return callProvider(
        {
          apiKey,
          model: env.GEMINI_MODEL,
          systemInstruction: input.systemInstruction,
          contents: input.contents,
          tools: input.tools,
        },
        fetch,
        { timeoutMs: input.timeoutMs, budgetMs: input.budgetMs },
      );
    },
    async recordUsage(day, usage) {
      const { error } = await client.rpc('add_usage', {
        p_day: day,
        p_in: usage.promptTokenCount,
        p_out: usage.candidatesTokenCount + usage.thoughtsTokenCount,
        p_cache_read: usage.cachedContentTokenCount,
        p_cache_write: 0,
        p_cost: 0,
      });
      if (error) throw error;
    },
    async logUnanswered(sessionId, topic) {
      if (pendingUnansweredLogId) return;
      const { data, error } = await client
        .from('assistant_logs')
        .insert({
          session_id: sessionId,
          role: 'assistant',
          content: topic,
          answered: false,
          unanswered_topic: topic,
          tool_calls: [{ name: 'log_unanswered' }],
        })
        .select('id')
        .single();
      if (error || !data) throw error ?? new Error('Missing log id.');
      pendingUnansweredLogId = data.id;
    },
    async logExchange(input: AssistantLogInput) {
      const { error: userError } = await client.from('assistant_logs').insert({
        session_id: input.sessionId,
        role: 'user',
        content: input.userText,
        answered: true,
        unanswered_topic: null,
        tool_calls: null,
      });
      if (userError) throw userError;
      const assistantRow = {
        session_id: input.sessionId,
        role: 'assistant',
        content: input.assistantText,
        answered: input.answered,
        unanswered_topic: input.unansweredTopic,
        tool_calls: input.toolCalls,
      };
      if (pendingUnansweredLogId) {
        const { error } = await client
          .from('assistant_logs')
          .update(assistantRow)
          .eq('id', pendingUnansweredLogId);
        if (error) throw error;
        return;
      }
      const { error } = await client
        .from('assistant_logs')
        .insert(assistantRow);
      if (error) throw error;
    },
    onPromptSize(characterCount) {
      console.info(`assistant_prompt_characters=${characterCount}`);
    },
    warnFallback(info) {
      console.warn(formatAssistantFallbackWarning(info));
    },
  });
  return json(
    result.body,
    result.status,
    result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {},
  );
};
