import type { APIRoute } from 'astro';
import { ownerErrorResponse } from '../../../../lib/owner/errors';
import {
  jsonResponse,
  ownerWriteAllowed,
  readJsonBody,
} from '../../../../lib/owner/http';
import {
  ownerBookingPatchSchema,
  ownerUuidSchema,
} from '../../../../lib/owner/schemas';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  const id = ownerUuidSchema.safeParse(params.id);
  if (!id.success) return jsonResponse({ message: 'Booking not found.' }, 404);
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = ownerBookingPatchSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the booking change.' }, 400);
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

    let result: { data: unknown; error: unknown };
    if (parsed.data.action === 'confirm')
      result = await client.rpc('owner_confirm_booking', {
        p_booking: id.data,
        p_slot_ids: parsed.data.slotIds,
      });
    else if (parsed.data.action === 'decline')
      result = await client.rpc('owner_decline_booking', {
        p_booking: id.data,
        p_reason: parsed.data.reason,
      });
    else if (parsed.data.action === 'cancel')
      result = await client.rpc('owner_cancel_booking', {
        p_booking: id.data,
        p_reason: parsed.data.reason,
      });
    else
      result = await client.rpc('owner_set_booking_status', {
        p_booking: id.data,
        p_status: parsed.data.action,
      });
    if (result.error) throw result.error;
    const updated = Array.isArray(result.data) ? result.data[0] : null;
    if (!updated) throw new Error('Missing booking update.');
    return jsonResponse({ booking: updated });
  } catch (error) {
    const mapped = ownerErrorResponse(error);
    return jsonResponse({ message: mapped.message }, mapped.status);
  }
};
