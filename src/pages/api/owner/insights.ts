import type { APIRoute } from 'astro';
import { insightsQuerySchema } from '../../../lib/owner/ai';
import { jsonResponse, queryObject } from '../../../lib/owner/http';
import { readServerEnv } from '../../../lib/server-env';
import { createServerSupabaseClient } from '../../../lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? insightsQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Choose today, 7d or 30d.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const { data, error } = await client.rpc('owner_insights', {
      p_range: parsed.data.range,
    });
    if (error) throw error;
    return jsonResponse({ insights: data });
  } catch {
    return jsonResponse({ message: 'Insights are unavailable.' }, 500);
  }
};
