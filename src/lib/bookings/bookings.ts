import { z } from 'zod';
import { normalisePhone, saltedRateLimitKey } from '../orders/place-order';
import {
  getBookableDates,
  getBookingHoldUntil,
  validateBooking,
} from '../rules';

const bookingCodeSchema = z.string().regex(/^PH-BK-\d{4,}$/);
const menuIdSchema = z.string().regex(/^PH\d{4}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);
const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const preorderLineSchema = z
  .object({
    id: menuIdSchema,
    qty: z.number().int().min(1).max(20),
  })
  .strict();

const bookingRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .refine(
        (value) => !hasControlCharacter(value),
        'Name contains invalid characters.',
      ),
    phone: z.string(),
    email: z.union([z.literal(''), z.email().trim().max(254)]).optional(),
    date: dateSchema,
    time: timeSchema,
    partySize: z.number().int().min(1).max(12),
    occasion: z
      .enum([
        'none',
        'birthday',
        'date',
        'work_meetup',
        'study_group',
        'trek_stop',
        'other',
      ])
      .optional(),
    notes: z
      .string()
      .max(200)
      .refine(
        (value) => !hasControlCharacter(value),
        'Notes contain invalid characters.',
      )
      .optional(),
    preorder: z.array(preorderLineSchema).max(12).optional(),
    honeypot: z.string(),
    mountedAt: z.union([
      z.iso.datetime({ offset: true }),
      z.number().int().nonnegative(),
    ]),
  })
  .strict();

const cancelRequestSchema = z
  .object({
    code: bookingCodeSchema,
    last4: z.string().regex(/^\d{4}$/),
  })
  .strict();

export const availabilityQuerySchema = z
  .object({
    date: dateSchema,
    party: z.string().regex(/^\d+$/),
  })
  .strict()
  .transform((value, ctx) => {
    const party = Number(value.party);
    if (!Number.isInteger(party) || party < 1 || party > 12) {
      ctx.addIssue({
        code: 'custom',
        message: 'Party must be a whole number from 1 to 12.',
        path: ['party'],
      });
      return z.NEVER;
    }
    return { date: value.date, party };
  });

export type BookingPreorderLine = {
  id: string;
  name: string;
  price: number;
  qty: number;
  lineTotal: number;
};

export type BookingPreorder = {
  lines: BookingPreorderLine[];
  total: number;
};

export type DatabaseBooking = {
  code: string;
  status: string;
  date: string;
  start_time: string;
  party_size: number;
  preorder: BookingPreorder | null;
  slot_labels: string[];
};

export type AvailabilityRow = {
  start_time: string;
  remaining: number | null;
  requestable: boolean;
};

type CreateBookingParams = {
  name: string;
  phone: string;
  email: string | null;
  date: string;
  time: string;
  partySize: number;
  occasion: string | null;
  notes: string | null;
  preorder: { id: string; qty: number }[] | null;
};

export type PlaceBookingDependencies = {
  hitRateLimit(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<boolean>;
  createBooking(params: CreateBookingParams): Promise<string>;
  readBooking(code: string): Promise<DatabaseBooking | null>;
  getAvailability(date: string, party: number): Promise<AvailabilityRow[]>;
  hash(value: string): Promise<string>;
  salt: string;
  now(): Date;
};

export type PlaceBookingResult =
  | {
      status: 201;
      body: {
        code: string;
        status: string;
        slotLabels: string[];
        date: string;
        time: string;
        holdUntil: string;
      };
    }
  | { status: 400; body: { message: string } }
  | { status: 409; body: { message: string; alternatives?: string[] } }
  | { status: 422; body: { message: string; errors?: string[] } }
  | {
      status: 429;
      body: { message: string; retryAfter: number };
      retryAfter: number;
    }
  | { status: 500; body: { message: string } };

export type CancelBookingDependencies = Pick<
  PlaceBookingDependencies,
  'hitRateLimit' | 'hash' | 'salt'
> & {
  cancelBooking(code: string, last4: string): Promise<boolean>;
};

export type CancelBookingResult =
  | { status: 200; body: { cancelled: true } }
  | { status: 400; body: { message: string } }
  | { status: 404; body: { message: string } }
  | { status: 409; body: { message: string } }
  | {
      status: 429;
      body: { message: string; retryAfter: number };
      retryAfter: number;
    }
  | { status: 500; body: { message: string } };

function mountedTime(value: string | number): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitisePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergePreorder(
  lines: z.infer<typeof preorderLineSchema>[],
): { id: string; qty: number }[] | null {
  if (!lines.length) return null;
  const merged = new Map<string, number>();
  for (const line of lines)
    merged.set(line.id, (merged.get(line.id) ?? 0) + line.qty);
  return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  )
    return error.message;
  return '';
}

type BookingErrorCode =
  | 'slot_taken'
  | 'closed_day'
  | 'outside_window'
  | 'bad_time'
  | 'too_late'
  | 'notice_required'
  | 'party_too_large'
  | 'bad_preorder'
  | 'bad_customer'
  | 'already_cancelled';

const bookingErrorCodes: BookingErrorCode[] = [
  'slot_taken',
  'closed_day',
  'outside_window',
  'bad_time',
  'too_late',
  'notice_required',
  'party_too_large',
  'bad_preorder',
  'bad_customer',
  'already_cancelled',
];

function bookingErrorCode(error: unknown): BookingErrorCode | null {
  const message = errorMessage(error);
  return bookingErrorCodes.find((code) => message.includes(code)) ?? null;
}

function nearestAlternatives(
  requested: string,
  rows: AvailabilityRow[],
): string[] {
  const toMinutes = (time: string) => {
    const [hour = 0, minute = 0] = time.slice(0, 5).split(':').map(Number);
    return hour * 60 + minute;
  };
  const target = toMinutes(requested);
  return rows
    .filter((row) => row.requestable || (row.remaining ?? 0) > 0)
    .map((row) => row.start_time.slice(0, 5))
    .filter((time) => time !== requested)
    .sort(
      (left, right) =>
        Math.abs(toMinutes(left) - target) -
          Math.abs(toMinutes(right) - target) ||
        toMinutes(left) - toMinutes(right),
    )
    .slice(0, 3);
}

export async function placeBooking(
  raw: unknown,
  ip: string,
  deps: PlaceBookingDependencies,
): Promise<PlaceBookingResult> {
  if (!raw || typeof raw !== 'object')
    return { status: 400, body: { message: 'Send a valid booking request.' } };
  const basic = raw as Record<string, unknown>;
  if (basic.honeypot !== '')
    return {
      status: 400,
      body: { message: 'This booking could not be accepted.' },
    };
  if (
    typeof basic.mountedAt !== 'string' &&
    typeof basic.mountedAt !== 'number'
  )
    return {
      status: 400,
      body: { message: 'This booking could not be accepted.' },
    };

  const now = deps.now();
  const mounted = mountedTime(basic.mountedAt);
  if (
    !mounted ||
    mounted.getTime() > now.getTime() ||
    now.getTime() - mounted.getTime() > 86_400_000 ||
    now.getTime() - mounted.getTime() < 3_000
  )
    return {
      status: 400,
      body: { message: 'Please wait a moment, then try again.' },
    };

  try {
    const ipKey = await saltedRateLimitKey(deps, 'booking-ip', ip);
    if (!(await deps.hitRateLimit(ipKey, 3600, 10)))
      return {
        status: 429,
        body: {
          message: 'Too many booking attempts. Please try again later.',
          retryAfter: 3600,
        },
        retryAfter: 3600,
      };
  } catch {
    return {
      status: 500,
      body: { message: 'Booking service is unavailable.' },
    };
  }

  const parsed = bookingRequestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: 400,
      body: {
        message:
          parsed.error.issues[0]?.message ?? 'Check the booking details.',
      },
    };

  const phone = normalisePhone(parsed.data.phone);
  if (!phone)
    return { status: 400, body: { message: 'Enter a valid phone number.' } };
  const preorder = mergePreorder(parsed.data.preorder ?? []);
  if (preorder?.some((line) => line.qty > 20))
    return {
      status: 422,
      body: { message: 'Check pre-order quantities.' },
    };
  const rule = validateBooking(
    {
      date: parsed.data.date,
      time: parsed.data.time,
      partySize: parsed.data.partySize,
    },
    now,
  );
  if (!rule.valid)
    return {
      status: 422,
      body: { message: 'Choose another booking time.', errors: rule.errors },
    };

  try {
    const phoneKey = await saltedRateLimitKey(deps, 'booking-phone', phone);
    if (!(await deps.hitRateLimit(phoneKey, 86_400, 5)))
      return {
        status: 429,
        body: {
          message:
            'Too many bookings for this phone. Please try again tomorrow.',
          retryAfter: 86_400,
        },
        retryAfter: 86_400,
      };

    const code = await deps.createBooking({
      name: sanitisePlainText(parsed.data.name),
      phone,
      email: parsed.data.email?.trim().toLowerCase() || null,
      date: parsed.data.date,
      time: parsed.data.time,
      partySize: parsed.data.partySize,
      occasion:
        parsed.data.occasion && parsed.data.occasion !== 'none'
          ? parsed.data.occasion
          : null,
      notes: parsed.data.notes
        ? sanitisePlainText(parsed.data.notes).slice(0, 200) || null
        : null,
      preorder,
    });
    const booking = await deps.readBooking(code);
    if (!booking) throw new Error('Missing booking read-back.');
    const holdUntil = getBookingHoldUntil(
      booking.date,
      booking.start_time.slice(0, 5),
    );
    if (!holdUntil) throw new Error('Invalid booking read-back.');
    return {
      status: 201,
      body: {
        code: booking.code,
        status: booking.status,
        slotLabels: booking.slot_labels,
        date: booking.date,
        time: booking.start_time.slice(0, 5),
        holdUntil: holdUntil.toISOString(),
      },
    };
  } catch (error) {
    const code = bookingErrorCode(error);
    if (code === 'slot_taken') {
      try {
        const rows = await deps.getAvailability(
          parsed.data.date,
          parsed.data.partySize,
        );
        return {
          status: 409,
          body: {
            message: 'That time was just taken.',
            alternatives: nearestAlternatives(parsed.data.time, rows),
          },
        };
      } catch {
        return {
          status: 409,
          body: { message: 'That time was just taken.', alternatives: [] },
        };
      }
    }
    if (code === 'bad_preorder' || code === 'bad_customer')
      return { status: 400, body: { message: 'Check the booking details.' } };
    if (code)
      return {
        status: 422,
        body: { message: 'This booking breaks the booking rules.' },
      };
    return {
      status: 500,
      body: { message: 'We could not create the booking. Please try again.' },
    };
  }
}

export async function cancelBookingRequest(
  raw: unknown,
  ip: string,
  deps: CancelBookingDependencies,
): Promise<CancelBookingResult> {
  const parsed = cancelRequestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: 400,
      body: { message: 'Send a valid booking code and four digits.' },
    };
  try {
    const ipKey = await saltedRateLimitKey(deps, 'booking-cancel-ip', ip);
    const codeKey = await saltedRateLimitKey(
      deps,
      'booking-cancel-code',
      parsed.data.code,
    );
    if (!(await deps.hitRateLimit(ipKey, 3600, 10)))
      return {
        status: 429,
        body: { message: 'Too many cancellation attempts.', retryAfter: 3600 },
        retryAfter: 3600,
      };
    if (!(await deps.hitRateLimit(codeKey, 3600, 5)))
      return {
        status: 429,
        body: { message: 'Too many cancellation attempts.', retryAfter: 3600 },
        retryAfter: 3600,
      };
    const cancelled = await deps.cancelBooking(
      parsed.data.code,
      parsed.data.last4,
    );
    return cancelled
      ? { status: 200, body: { cancelled: true } }
      : { status: 404, body: { message: 'Booking not found.' } };
  } catch (error) {
    const code = bookingErrorCode(error);
    if (code === 'too_late')
      return {
        status: 409,
        body: { message: 'This booking can no longer be cancelled.' },
      };
    if (code === 'already_cancelled')
      return {
        status: 409,
        body: { message: 'This booking is already cancelled.' },
      };
    return {
      status: 500,
      body: { message: 'Cancellation service is unavailable.' },
    };
  }
}

export function validateAvailabilityQuery(
  raw: Record<string, string>,
  now: Date,
): { date: string; party: number } | null {
  const parsed = availabilityQuerySchema.safeParse(raw);
  if (!parsed.success || !getBookableDates(now).includes(parsed.data.date))
    return null;
  return parsed.data;
}
