import { z } from 'zod';
import {
  estimatedPrepMinutes,
  getAsapPickup,
  MAX_ITEMS_PER_ORDER,
  MAX_QUANTITY_PER_ITEM,
  validateOrder,
} from '../rules';

const idSchema = z.string().regex(/^PH\d{4}$/);
const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
const requestSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: idSchema,
            qty: z.number().int().min(1).max(20),
            note: z.string().max(80).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
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
    asap: z.boolean().optional(),
    pickupAt: z.iso.datetime({ offset: true }).optional(),
    notes: z.string().max(200).optional(),
    honeypot: z.string(),
    mountedAt: z.union([
      z.iso.datetime({ offset: true }),
      z.number().int().nonnegative(),
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.asap === true && value.pickupAt)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose one pickup method.',
        path: ['pickupAt'],
      });
    if (value.asap !== true && !value.pickupAt)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a pickup time.',
        path: ['pickupAt'],
      });
  });

export type DatabaseMenuItem = {
  id: string;
  name: string;
  price_usd: number;
  prep_minutes: number | null;
  available: boolean;
};
export type DatabaseOrder = {
  code: string;
  pickup_at: string;
  subtotal: number;
};
export type PlaceOrderDependencies = {
  loadMenuItems(ids: string[]): Promise<DatabaseMenuItem[]>;
  hitRateLimit(
    key: string,
    windowSeconds: number,
    max: number,
  ): Promise<boolean>;
  createOrder(params: {
    name: string;
    phone: string;
    pickupAt: string;
    notes: string | null;
    source: 'site';
    items: { id: string; qty: number; note?: string }[];
  }): Promise<string>;
  readOrder(code: string): Promise<DatabaseOrder | null>;
  hash(value: string): Promise<string>;
  salt: string;
  now(): Date;
};

export type PlaceOrderResult =
  | { status: 201; body: { code: string; pickupAt: string; subtotal: number } }
  | { status: 400; body: { message: string } }
  | { status: 409; body: { message: string; unavailableIds: string[] } }
  | { status: 422; body: { message: string; errors: string[] } }
  | {
      status: 429;
      body: { message: string; retryAfter: number };
      retryAfter: number;
    }
  | { status: 500; body: { message: string } };

export function normalisePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+?\d+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/^\+/, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

function mountedTime(value: string | number): Date | null {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function mergeItems(items: z.infer<typeof requestSchema>['items']) {
  const merged = new Map<string, { qty: number; note?: string }>();
  for (const item of items) {
    const current = merged.get(item.id) ?? { qty: 0 };
    current.qty += item.qty;
    if (!current.note && item.note?.trim())
      current.note = item.note.trim().slice(0, 80);
    merged.set(item.id, current);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, ...value }));
}

export async function saltedRateLimitKey(
  deps: Pick<PlaceOrderDependencies, 'hash' | 'salt'>,
  kind: string,
  value: string,
): Promise<string> {
  return deps.hash(`${deps.salt}:${kind}:${value}`);
}

export async function placeOrder(
  raw: unknown,
  ip: string,
  deps: PlaceOrderDependencies,
): Promise<PlaceOrderResult> {
  if (!raw || typeof raw !== 'object')
    return { status: 400, body: { message: 'Send a valid order request.' } };
  const basic = raw as Record<string, unknown>;
  if (basic.honeypot !== '')
    return {
      status: 400,
      body: { message: 'This order could not be accepted.' },
    };
  if (
    typeof basic.mountedAt !== 'string' &&
    typeof basic.mountedAt !== 'number'
  )
    return {
      status: 400,
      body: { message: 'This order could not be accepted.' },
    };
  const now = deps.now();
  const mounted = mountedTime(basic.mountedAt);
  if (
    !mounted ||
    mounted.getTime() > now.getTime() ||
    now.getTime() - mounted.getTime() > 86_400_000 ||
    now.getTime() - mounted.getTime() < 3_000
  ) {
    return {
      status: 400,
      body: { message: 'Please wait a moment, then try again.' },
    };
  }
  try {
    const ipKey = await saltedRateLimitKey(deps, 'order-ip', ip);
    if (!(await deps.hitRateLimit(ipKey, 3600, 10)))
      return {
        status: 429,
        body: {
          message: 'Too many order attempts. Please try again later.',
          retryAfter: 3600,
        },
        retryAfter: 3600,
      };
  } catch {
    return {
      status: 500,
      body: { message: 'We could not place the order. Please try again.' },
    };
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      status: 400,
      body: {
        message: parsed.error.issues[0]?.message ?? 'Check the order details.',
      },
    };
  const phone = normalisePhone(parsed.data.phone);
  if (!phone)
    return { status: 400, body: { message: 'Enter a valid phone number.' } };
  const items = mergeItems(parsed.data.items);
  const total = items.reduce((sum, item) => sum + item.qty, 0);
  if (
    total > MAX_ITEMS_PER_ORDER ||
    items.some((item) => item.qty > MAX_QUANTITY_PER_ITEM)
  )
    return {
      status: 422,
      body: {
        message: 'Check item quantities.',
        errors: [
          `Order at most ${MAX_QUANTITY_PER_ITEM} of any one item.`,
          `Order at most ${MAX_ITEMS_PER_ORDER} items in total.`,
        ],
      },
    };
  try {
    const databaseItems = await deps.loadMenuItems(
      items.map((item) => item.id),
    );
    const available = new Map(
      databaseItems
        .filter((item) => item.available)
        .map((item) => [item.id, item]),
    );
    const unavailableIds = items
      .filter((item) => !available.has(item.id))
      .map((item) => item.id);
    if (unavailableIds.length)
      return {
        status: 409,
        body: { message: 'One or more items are unavailable.', unavailableIds },
      };
    const prep = estimatedPrepMinutes(
      items.map((item) => available.get(item.id)?.prep_minutes ?? 0),
    );
    const pickupAt = parsed.data.asap
      ? getAsapPickup(now, prep)
      : new Date(parsed.data.pickupAt!);
    const rule = validateOrder(
      {
        items: items.map((item) => ({
          id: item.id,
          quantity: item.qty,
          prepMinutes: available.get(item.id)?.prep_minutes ?? 0,
        })),
        pickupAt,
      },
      now,
    );
    if (!rule.valid)
      return {
        status: 422,
        body: { message: 'Choose another pickup time.', errors: rule.errors },
      };
    const phoneKey = await saltedRateLimitKey(deps, 'order-phone', phone);
    if (!(await deps.hitRateLimit(phoneKey, 86_400, 5)))
      return {
        status: 429,
        body: {
          message: 'Too many orders for this phone. Please try again tomorrow.',
          retryAfter: 86_400,
        },
        retryAfter: 86_400,
      };
    const code = await deps.createOrder({
      name: parsed.data.name.trim(),
      phone,
      pickupAt: pickupAt.toISOString(),
      notes: parsed.data.notes?.trim() || null,
      source: 'site',
      items,
    });
    const order = await deps.readOrder(code);
    if (!order) throw new Error('Missing order read-back.');
    return {
      status: 201,
      body: {
        code: order.code,
        pickupAt: order.pickup_at,
        subtotal: order.subtotal,
      },
    };
  } catch {
    return {
      status: 500,
      body: { message: 'We could not place the order. Please try again.' },
    };
  }
}
