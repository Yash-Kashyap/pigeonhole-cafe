import { z } from 'zod';

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const safeText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !hasControlCharacter(value));

const messageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: safeText(1, 500),
  })
  .strict();

const cartLineSchema = z
  .object({
    id: z.string().regex(/^PH\d{4}$/),
    qty: z.number().int().min(1).max(20),
  })
  .strict();

export const assistantRequestSchema = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    messages: z.array(messageSchema).min(1),
    page: z.enum([
      'home',
      'menu',
      'order',
      'reserve',
      'story',
      'visit',
      'gatherings',
      'trek-stop',
      'other',
    ]),
    cart: z.array(cartLineSchema).max(40).optional(),
  })
  .strict()
  .refine(
    (value) => value.messages.at(-1)?.role === 'user',
    'The last message must be from the user.',
  )
  .transform((value) => ({
    ...value,
    messages: value.messages.slice(-12),
  }));

export type AssistantRequest = z.infer<typeof assistantRequestSchema>;
