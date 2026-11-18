import type { APIRoute } from 'astro';
import { jsonResponse, queryObject } from '../../../../lib/owner/http';
import { ownerOrdersQuerySchema } from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;
const PAGE_SIZE = 25;

function dateRange(date: string) {
  const start = new Date(`${date}T00:00:00+05:30`);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? ownerOrdersQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Check the order filters.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const from = (parsed.data.page - 1) * PAGE_SIZE;
    let query = client
      .from('orders')
      .select(
        'id,code,name,phone,pickup_at,notes,subtotal,status,source,cancel_reason,created_at,order_items(id,menu_item_id,name_snapshot,price_snapshot,qty,note)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (parsed.data.status) query = query.eq('status', parsed.data.status);
    if (parsed.data.date) {
      const range = dateRange(parsed.data.date);
      query = query.gte('pickup_at', range.start).lt('pickup_at', range.end);
    }
    const { data, error, count } = await query;
    if (error) throw error;
    return jsonResponse({
      orders: data ?? [],
      page: parsed.data.page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
    });
  } catch {
    return jsonResponse({ message: 'Orders are unavailable.' }, 500);
  }
};
