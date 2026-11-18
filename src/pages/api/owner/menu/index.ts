import type { APIRoute } from 'astro';
import { jsonResponse, queryObject } from '../../../../lib/owner/http';
import { ownerMenuQuerySchema } from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? ownerMenuQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Check the menu search.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    let query = client
      .from('menu_items')
      .select('id,category,subcategory,name,description,price_usd,available')
      .order('category')
      .order('name');
    if (parsed.data.search)
      query = query.ilike('name', `%${parsed.data.search}%`);
    const { data, error } = await query;
    if (error) throw error;
    return jsonResponse({ items: data ?? [] });
  } catch {
    return jsonResponse({ message: 'Menu items are unavailable.' }, 500);
  }
};
