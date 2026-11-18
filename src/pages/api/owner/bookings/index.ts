import type { APIRoute } from 'astro';
import { normalisePhone } from '../../../../lib/orders/place-order';
import { ownerErrorResponse } from '../../../../lib/owner/errors';
import {
  jsonResponse,
  ownerWriteAllowed,
  queryObject,
  readJsonBody,
} from '../../../../lib/owner/http';
import {
  ownerBookingCreateSchema,
  ownerBookingsQuerySchema,
} from '../../../../lib/owner/schemas';
import {
  buildBookingTimeline,
  type TimelineBooking,
  type TimelineSlot,
} from '../../../../lib/owner/timeline';
import { validateBooking } from '../../../../lib/rules';
import { readServerEnv } from '../../../../lib/server-env';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';

export const prerender = false;

type BookingRow = {
  id: string;
  code: string;
  name: string;
  phone: string;
  email: string | null;
  date: string;
  start_time: string;
  party_size: number;
  status: string;
  occasion: string | null;
  notes: string | null;
  preorder: unknown;
  decline_reason: string | null;
  cancel_reason: string | null;
  created_at: string;
  booking_slots:
    | {
        slot_table_id: string;
        slot_tables:
          | { label: string; seats: number }
          | { label: string; seats: number }[]
          | null;
      }[]
    | null;
};

function bookingResponse(row: BookingRow) {
  const slots = (row.booking_slots ?? []).flatMap((entry) => {
    const table = Array.isArray(entry.slot_tables)
      ? entry.slot_tables[0]
      : entry.slot_tables;
    return table
      ? [{ id: entry.slot_table_id, label: table.label, seats: table.seats }]
      : [];
  });
  const { booking_slots: _bookingSlots, ...booking } = row;
  void _bookingSlots;
  return {
    ...booking,
    slotIds: slots.map((slot) => slot.id),
    slotLabels: slots.map((slot) => slot.label),
  };
}

export const GET: APIRoute = async ({ url }) => {
  const raw = queryObject(url);
  const parsed = raw ? ownerBookingsQuerySchema.safeParse(raw) : null;
  if (!parsed?.success)
    return jsonResponse({ message: 'Choose a valid booking date.' }, 400);
  try {
    const client = createServerSupabaseClient(readServerEnv());
    const [bookingsResult, slotsResult] = await Promise.all([
      client
        .from('bookings')
        .select(
          'id,code,name,phone,email,date,start_time,party_size,status,occasion,notes,preorder,decline_reason,cancel_reason,created_at,booking_slots(slot_table_id,slot_tables(label,seats))',
        )
        .eq('date', parsed.data.date)
        .order('start_time', { ascending: true }),
      client.from('slot_tables').select('id,label,seats').order('label'),
    ]);
    if (bookingsResult.error) throw bookingsResult.error;
    if (slotsResult.error) throw slotsResult.error;
    const rows = (bookingsResult.data ?? []) as unknown as BookingRow[];
    const slots = (slotsResult.data ?? []) as TimelineSlot[];
    const timelineBookings: TimelineBooking[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      start_time: row.start_time,
      party_size: row.party_size,
      status: row.status,
      slot_ids: (row.booking_slots ?? []).map((slot) => slot.slot_table_id),
    }));
    return jsonResponse({
      date: parsed.data.date,
      bookings: rows.map(bookingResponse),
      timeline: buildBookingTimeline(slots, timelineBookings),
    });
  } catch {
    return jsonResponse({ message: 'Bookings are unavailable.' }, 500);
  }
};

function mergePreorder(lines: { id: string; qty: number }[]) {
  const merged = new Map<string, number>();
  for (const line of lines)
    merged.set(line.id, (merged.get(line.id) ?? 0) + line.qty);
  return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
}

function sanitisePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = ownerBookingCreateSchema.safeParse(body.value);
  if (!parsed.success)
    return jsonResponse({ message: 'Check the booking details.' }, 400);
  const phone = normalisePhone(parsed.data.phone);
  if (!phone)
    return jsonResponse({ message: 'Enter a valid phone number.' }, 400);
  const preorder = mergePreorder(parsed.data.preorder ?? []);
  if (preorder.some((line) => line.qty > 20))
    return jsonResponse({ message: 'Check pre-order quantities.' }, 422);
  const rule = validateBooking(
    {
      date: parsed.data.date,
      time: parsed.data.time,
      partySize: parsed.data.partySize,
    },
    new Date(),
  );
  if (!rule.valid)
    return jsonResponse(
      { message: 'Choose another booking time.', errors: rule.errors },
      422,
    );
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
    const { data, error } = await client.rpc('create_booking', {
      p_name: sanitisePlainText(parsed.data.name),
      p_phone: phone,
      p_email: parsed.data.email?.trim().toLowerCase() || null,
      p_date: parsed.data.date,
      p_start: parsed.data.time,
      p_party: parsed.data.partySize,
      p_occasion:
        parsed.data.occasion && parsed.data.occasion !== 'none'
          ? parsed.data.occasion
          : null,
      p_notes: parsed.data.notes
        ? sanitisePlainText(parsed.data.notes) || null
        : null,
      p_preorder: preorder.length ? preorder : null,
    });
    if (error) throw error;
    const created = Array.isArray(data) ? data[0] : null;
    if (!created) throw new Error('Missing booking result.');
    return jsonResponse({ booking: created }, 201);
  } catch (error) {
    const mapped = ownerErrorResponse(error);
    return jsonResponse({ message: mapped.message }, mapped.status);
  }
};
