import { z } from 'zod';
import type { AvailabilityRow } from './bookings';
import { getBookableDates, getBookableTimes } from '../rules';

export const availabilityInputSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    partySize: z.number().int().min(1).max(12),
  })
  .strict();

export type AvailabilityResult = {
  date: string;
  partySize: number;
  times: { time: string; remaining: number | null; requestable: boolean }[];
};

export async function checkBookingAvailability(
  raw: unknown,
  now: Date,
  load: (date: string, partySize: number) => Promise<AvailabilityRow[]>,
): Promise<AvailabilityResult> {
  const parsed = availabilityInputSchema.parse(raw);
  if (!getBookableDates(now).includes(parsed.date))
    throw new Error('invalid_date');
  const allowedTimes = new Set(getBookableTimes(parsed.date, now));
  if (parsed.time && !allowedTimes.has(parsed.time))
    throw new Error('invalid_time');
  const rows = await load(parsed.date, parsed.partySize);
  const times = rows
    .map((row) => ({
      time: row.start_time.slice(0, 5),
      remaining: row.remaining,
      requestable: row.requestable,
    }))
    .filter((row) => allowedTimes.has(row.time))
    .filter((row) => !parsed.time || row.time === parsed.time);
  return { date: parsed.date, partySize: parsed.partySize, times };
}
