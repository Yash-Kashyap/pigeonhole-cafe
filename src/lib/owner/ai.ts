import { z } from 'zod';

const noControls = (value: string) =>
  !Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159);
  });
const plainText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine(noControls, 'Text contains invalid characters.')
    .refine(
      (value) => !/<\/?[a-z][^>]*>/i.test(value),
      'Enter plain text without markup.',
    );
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    );
  });

export const answerInputSchema = z
  .object({
    question: plainText(3, 300),
    answer: plainText(3, 600),
  })
  .strict();

export const overridePatchSchema = z
  .object({
    question: plainText(3, 300).optional(),
    answer: plainText(3, 600).optional(),
  })
  .strict()
  .refine(
    (value) => value.question !== undefined || value.answer !== undefined,
  );

export const questionsQuerySchema = z
  .object({
    filter: z.enum(['unanswered', 'all']).default('unanswered'),
    day: dateOnly.optional(),
    page: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(10_000))
      .default(1),
  })
  .strict();

export const insightsQuerySchema = z
  .object({ range: z.enum(['today', '7d', '30d']).default('7d') })
  .strict();

export const summaryDayQuerySchema = z
  .object({
    day: dateOnly.optional(),
  })
  .strict();

export const summaryInputSchema = z
  .object({ regenerate: z.boolean().optional().default(false) })
  .strict();

export const generatedSummarySchema = z
  .object({
    bullets: z.array(z.string().trim().min(1).max(160)).length(5),
    suggestion: z.string().trim().min(1).max(200),
  })
  .strict();

export type SummaryAggregate = {
  range: string;
  start: string;
  end: string;
  orderCount: number;
  orderTotal: number;
  bookingCount: number;
  ordersPerDay: { day: string; count: number }[];
  topItems: { id: string; name: string; quantity: number }[];
  ordersPerHour: { hour: number; count: number }[];
  bookingsByPartySize: { partySize: number; count: number }[];
  assistant: {
    conversations: number | null;
    answeredRate: number | null;
    cartActions: number | null;
    bookingActions: number | null;
  };
};

export function dayFromRequest(value: string | null, now = new Date()): string {
  if (value) return value;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function buildSummaryPayload(value: SummaryAggregate): string {
  return JSON.stringify({
    day: value.end,
    orderCount: value.orderCount,
    orderTotal: value.orderTotal,
    bookingCount: value.bookingCount,
    ordersPerDay: value.ordersPerDay,
    topItems: value.topItems.map(({ name, quantity }) => ({ name, quantity })),
    peakHour: value.ordersPerHour.reduce<{
      hour: number;
      count: number;
    } | null>(
      (best, row) => (!best || row.count > best.count ? row : best),
      null,
    ),
    bookingsByPartySize: value.bookingsByPartySize,
    assistant: value.assistant,
  });
}

export function parseGeneratedSummary(text: string) {
  let value: unknown;
  try {
    // Models sometimes wrap JSON in a markdown code fence; strip one if present.
    value = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    );
  } catch {
    throw new Error('summary_invalid');
  }
  const parsed = generatedSummarySchema.safeParse(value);
  if (!parsed.success) throw new Error('summary_invalid');
  return parsed.data;
}

export function summarySystemInstruction(): string {
  return 'Write a concise daily cafe operations summary from the aggregate JSON supplied by the owner server. Return only strict JSON with exactly keys bullets and suggestion. bullets must contain exactly five strings, each at most 160 characters. suggestion must be one string at most 200 characters. Do not add facts, names, phone numbers, email addresses, codes, or guest text. Use only the supplied counts and item names.';
}
