import { z } from 'zod';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
    );
  }, 'Enter a real calendar date.');
const uuidSchema = z.uuid();
const pageSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((value) => value >= 1 && value <= 10_000);
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum);
const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
const safePlainText = (maximum: number) =>
  plainText(maximum).refine(
    (value) => !hasControlCharacter(value),
    'Text contains invalid characters.',
  );

export const ownerLoginSchema = z
  .object({
    email: z.email().trim().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();

export const ownerLogoutSchema = z.object({}).strict();

export const ownerOrdersQuerySchema = z
  .object({
    status: z
      .enum(['new', 'preparing', 'ready', 'collected', 'cancelled'])
      .optional(),
    date: dateSchema.optional(),
    page: pageSchema.optional().default(1),
  })
  .strict();

export const ownerOrderPatchSchema = z
  .object({
    status: z.enum(['preparing', 'ready', 'collected', 'cancelled']),
    cancel_reason: z
      .enum([
        'customer_request',
        'out_of_stock',
        'cannot_make_it',
        'duplicate',
        'other',
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'cancelled' && !value.cancel_reason)
      context.addIssue({
        code: 'custom',
        message: 'Choose a cancellation reason.',
        path: ['cancel_reason'],
      });
    if (value.status !== 'cancelled' && value.cancel_reason)
      context.addIssue({
        code: 'custom',
        message: 'A reason is only valid when cancelling.',
        path: ['cancel_reason'],
      });
  });

export const ownerBookingsQuerySchema = z.object({ date: dateSchema }).strict();

const bookingActionSchemas = [
  z
    .object({
      action: z.literal('confirm'),
      slotIds: z
        .array(z.string().regex(/^S(?:[1-9]|1[0-6])$/))
        .min(1)
        .max(16),
    })
    .strict(),
  z
    .object({ action: z.literal('decline'), reason: safePlainText(200) })
    .strict(),
  z.object({ action: z.literal('seated') }).strict(),
  z.object({ action: z.literal('no_show') }).strict(),
  z
    .object({ action: z.literal('cancel'), reason: safePlainText(200) })
    .strict(),
] as const;

export const ownerBookingPatchSchema = z.discriminatedUnion(
  'action',
  bookingActionSchemas,
);

const preorderLineSchema = z
  .object({
    id: z.string().regex(/^PH\d{4}$/),
    qty: z.number().int().min(1).max(20),
  })
  .strict();

export const ownerBookingCreateSchema = z
  .object({
    name: safePlainText(60),
    phone: z.string(),
    email: z.union([z.literal(''), z.email().trim().max(254)]).optional(),
    date: dateSchema,
    time: z.string().regex(/^\d{2}:\d{2}$/),
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
      .trim()
      .max(200)
      .refine(
        (value) => !hasControlCharacter(value),
        'Notes contain invalid characters.',
      )
      .optional(),
    preorder: z.array(preorderLineSchema).max(12).optional(),
  })
  .strict();

export const ownerEnquiriesQuerySchema = z
  .object({
    kind: z.enum(['private_table', 'open_mic', 'general']).optional(),
    page: pageSchema.optional().default(1),
  })
  .strict();

export const ownerEnquiryPatchSchema = z
  .object({ status: z.enum(['new', 'contacted', 'done']) })
  .strict();

export const ownerMenuQuerySchema = z
  .object({ search: z.string().trim().max(80).optional() })
  .strict();

export const ownerMenuPatchSchema = z
  .object({
    available: z.boolean().optional(),
    price_usd: z.number().min(0.5).max(50).optional(),
    description: z.string().trim().max(300).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.available !== undefined ||
      value.price_usd !== undefined ||
      value.description !== undefined,
    'Send at least one menu change.',
  );

export const ownerUuidSchema = uuidSchema;
