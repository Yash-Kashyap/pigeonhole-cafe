import type { APIRoute } from 'astro';
import { jsonResponse, queryObject } from '../../../../lib/owner/http';
import { ownerEnquiriesQuerySchema } from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;
const PAGE_SIZE = 25;

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? ownerEnquiriesQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Check the enquiry filters.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const from = (parsed.data.page - 1) * PAGE_SIZE;
    let query = client
      .from('enquiries')
      .select('id,kind,name,phone,email,payload,status,created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (parsed.data.kind) query = query.eq('kind', parsed.data.kind);
    const { data, error, count } = await query;
    if (error) throw error;
    return jsonResponse({
      enquiries: data ?? [],
      page: parsed.data.page,
      pageSize: PAGE_SIZE,
      total: count ?? 0,
    });
  } catch {
    return jsonResponse({ message: 'Enquiries are unavailable.' }, 500);
  }
};
