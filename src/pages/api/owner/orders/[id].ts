import type { APIRoute } from 'astro';
import { ownerErrorResponse } from '../../../../lib/owner/errors';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../lib/owner/http';
import {
  ownerOrderPatchSchema,
  ownerUuidSchema,
} from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const id = ownerUuidSchema.safeParse(params.id);
  if (!id.success) return jsonResponse({ message: 'Order not found.' }, 404);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = ownerOrderPatchSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the order status change.' }, 400);
  try {
    const env = readServerEnv();
    if (!env.RATE_LIMIT_SALT || !locals.owner)
      throw new Error('Missing owner context.');
    const client = createServerSupabaseClient(env);
    if (
      !(await ownerWriteAllowed(client, env.RATE_LIMIT_SALT, locals.owner.id))
    )
      return jsonResponse({ message: 'Too many owner changes.' }, 429, {
        'Retry-After': '600',
      });
    const { data, error } = await client.rpc('owner_set_order_status', {
      p_order: id.data,
      p_status: parsed.data.status,
      p_cancel_reason: parsed.data.cancel_reason ?? null,
    });
    if (error) throw error;
    const updated = Array.isArray(data) ? data[0] : null;
    if (!updated) throw new Error('Missing order update.');
    return jsonResponse({ order: updated });
  } catch (error) {
    const mapped = ownerErrorResponse(error);
    return jsonResponse({ message: mapped.message }, mapped.status);
  }
};
