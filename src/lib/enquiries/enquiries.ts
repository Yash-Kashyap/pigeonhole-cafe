import { z } from 'zod';
import { normalisePhone, saltedRateLimitKey } from '../orders/place-order';
import { validateBooking } from '../rules';

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
    .refine(
      (value) => !hasControlCharacter(value),
      'Text contains invalid characters.',
    );
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine(
      (value) => !hasControlCharacter(value),
      'Text contains invalid characters.',
    )
    .optional();
const phoneText = z
  .string()
  .trim()
  .max(32)
  .refine(
    (value) => !hasControlCharacter(value),
    'Phone contains invalid characters.',
  );
const botFields = {
  honeypot: z
    .string()
    .max(200)
    .refine(
      (value) => !hasControlCharacter(value),
      'Honeypot contains invalid characters.',
    ),
  mountedAt: z.union([
    z.iso.datetime({ offset: true }),
    z.number().int().nonnegative(),
  ]),
};

const openMicSchema = z
  .object({
    kind: z.literal('open_mic'),
    name: safeText(2, 60),
    phone: phoneText,
    performanceType: z.enum(['Music', 'Poetry', 'Story', 'Comedy', 'Other']),
    notes: optionalText(200),
    consent: z.literal(true),
    ...botFields,
  })
  .strict();

const privateTableSchema = z
  .object({
    kind: z.literal('private_table'),
    name: safeText(2, 60),
    phone: phoneText,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    partySize: z.number().int().min(7).max(12),
    occasion: z.enum([
      'Birthday',
      'Small party',
      'Study group',
      'Work meet-up',
      'Other',
    ]),
    notes: optionalText(200),
    ...botFields,
  })
  .strict();

const generalSchema = z
  .object({
    kind: z.literal('general'),
    name: safeText(2, 60),
    phone: phoneText.optional(),
    email: z.union([z.literal(''), z.email().trim().max(254)]).optional(),
    message: safeText(5, 1_000),
    ...botFields,
  })
  .strict()
  .refine(
    (value) => Boolean(value.phone?.trim() || value.email?.trim()),
    'Enter a phone number or email address.',
  );

export const enquiryRequestSchema = z.discriminatedUnion('kind', [
  openMicSchema,
  privateTableSchema,
  generalSchema,
]);

export type EnquiryKind = z.infer<typeof enquiryRequestSchema>['kind'];
export type CreateEnquiryParams = {
  kind: EnquiryKind;
  name: string;
  phone: string | null;
  email: string | null;
  payload: Record<string, string | number>;
};
export type DatabaseEnquiry = { id: string };

export type EnquiryDependencies = {
  hitRateLimit(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<boolean>;
  createEnquiry(params: CreateEnquiryParams): Promise<string>;
  readEnquiry(id: string): Promise<DatabaseEnquiry | null>;
  hash(value: string): Promise<string>;
  salt: string;
  now(): Date;
};

export type EnquiryResult =
  | { status: 201; body: { reference: string } }
  | { status: 400; body: { message: string } }
  | { status: 422; body: { message: string } }
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

export function enquiryReference(id: string): string {
  return `ENQ-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export async function placeEnquiry(
  raw: unknown,
  ip: string,
  deps: EnquiryDependencies,
): Promise<EnquiryResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { status: 400, body: { message: 'Check the enquiry details.' } };
  const basic = raw as Record<string, unknown>;
  if (basic.honeypot !== '')
    return {
      status: 400,
      body: { message: 'This enquiry could not be accepted.' },
    };
  if (
    typeof basic.mountedAt !== 'string' &&
    typeof basic.mountedAt !== 'number'
  )
    return {
      status: 400,
      body: { message: 'This enquiry could not be accepted.' },
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
    const ipKey = await saltedRateLimitKey(deps, 'enquiry-ip', ip);
    if (!(await deps.hitRateLimit(ipKey, 3_600, 10)))
      return {
        status: 429,
        body: {
          message: 'Too many enquiries. Please try again later.',
          retryAfter: 3_600,
        },
        retryAfter: 3_600,
      };
  } catch {
    return {
      status: 500,
      body: { message: 'Enquiry service is unavailable.' },
    };
  }

  const parsed = enquiryRequestSchema.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { message: 'Check the enquiry details.' } };

  const phoneValue =
    'phone' in parsed.data ? parsed.data.phone?.trim() : undefined;
  const phone = phoneValue ? normalisePhone(phoneValue) : null;
  if (phoneValue && !phone)
    return { status: 400, body: { message: 'Check the enquiry details.' } };
  if (parsed.data.kind !== 'general' && !phone)
    return { status: 400, body: { message: 'Check the enquiry details.' } };

  if (parsed.data.kind === 'private_table') {
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
        body: { message: 'Choose another date or time.' },
      };
  }

  const name = sanitisePlainText(parsed.data.name);
  if (name.length < 2)
    return { status: 400, body: { message: 'Check the enquiry details.' } };

  try {
    if (phone) {
      const phoneKey = await saltedRateLimitKey(deps, 'enquiry-phone', phone);
      if (!(await deps.hitRateLimit(phoneKey, 86_400, 3)))
        return {
          status: 429,
          body: {
            message: 'Too many enquiries. Please try again tomorrow.',
            retryAfter: 86_400,
          },
          retryAfter: 86_400,
        };
    }

    let payload: Record<string, string | number>;
    let email: string | null = null;
    if (parsed.data.kind === 'open_mic') {
      payload = {
        performanceType: parsed.data.performanceType,
        ...(parsed.data.notes
          ? { notes: sanitisePlainText(parsed.data.notes) }
          : {}),
      };
    } else if (parsed.data.kind === 'private_table') {
      payload = {
        date: parsed.data.date,
        time: parsed.data.time,
        partySize: parsed.data.partySize,
        occasion: parsed.data.occasion,
        ...(parsed.data.notes
          ? { notes: sanitisePlainText(parsed.data.notes) }
          : {}),
      };
    } else {
      const message = sanitisePlainText(parsed.data.message);
      if (message.length < 5)
        return { status: 400, body: { message: 'Check the enquiry details.' } };
      email = parsed.data.email?.trim().toLowerCase() || null;
      payload = { message };
    }

    const id = await deps.createEnquiry({
      kind: parsed.data.kind,
      name,
      phone,
      email,
      payload,
    });
    const saved = await deps.readEnquiry(id);
    if (!saved) throw new Error('Missing enquiry read-back.');
    return {
      status: 201,
      body: { reference: enquiryReference(saved.id) },
    };
  } catch {
    return {
      status: 500,
      body: { message: 'Enquiry service is unavailable.' },
    };
  }
}
