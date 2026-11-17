import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createPublicSupabaseClient } from '../../../lib/supabase/public';

export const prerender = false;
const rowsSchema = z.array(z.object({ id: z.string().regex(/^PH\d{4}$/) }));

async function readUnavailableIds(): Promise<string[]> {
  try {
    const { data, error } = await createPublicSupabaseClient()
      .from('menu_items')
      .select('id')
      .eq('available', false)
      .limit(240);
    if (error) throw error;
    return rowsSchema.parse(data).map((row) => row.id);
  } catch {
    return [];
  }
}

export const GET = (async () => {
  const unavailableIds = await readUnavailableIds();
  return new Response(JSON.stringify({ unavailableIds }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control':
        'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
    },
  });
}) satisfies APIRoute;
