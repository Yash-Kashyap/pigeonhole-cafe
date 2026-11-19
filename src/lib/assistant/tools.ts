import { z } from 'zod';
import { ALLERGENS, MENU_CATEGORIES, type MenuItem } from '../menu';
import { normalisePhone } from '../orders/place-order';
import {
  BOOKING_HORIZON_DAYS,
  BOOKING_LARGE_PARTY_NOTICE_MINUTES,
  BOOKING_SAME_DAY_CUTOFF_MINUTES,
  getBookableDates,
  getBookableTimes,
  getCafeHours,
  getOpenState,
  validateBooking,
} from '../rules';
import {
  checkBookingAvailability,
  type AvailabilityResult,
} from '../bookings/availability';
import type { AvailabilityRow } from '../bookings/bookings';
import type { AssistantAction } from './types';

const hasControlCharacter = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
const toolText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !hasControlCharacter(value));

export const searchMenuSchema = z
  .object({
    query: toolText(80).optional(),
    vegan: z.boolean().optional(),
    jain: z.boolean().optional(),
    gluten_free: z.boolean().optional(),
    avoid_allergens: z
      .array(z.enum(ALLERGENS))
      .max(ALLERGENS.length)
      .optional(),
    max_price: z.number().min(0.5).max(50).optional(),
    category: z.enum(MENU_CATEGORIES).optional(),
    max_spice: z.number().int().min(0).max(3).optional(),
    limit: z.number().int().min(1).max(8).default(5),
  })
  .strict();

export const getHoursSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export const checkAvailabilitySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    party_size: z.number().int().min(1).max(12),
  })
  .strict();

const proposedItemSchema = z
  .object({
    id: z.string().regex(/^PH\d{4}$/),
    qty: z.number().int().min(1).max(20),
    note: toolText(120).optional(),
  })
  .strict();

export const proposeCartAddSchema = z
  .object({ items: z.array(proposedItemSchema).min(1).max(20) })
  .strict();

export const proposeBookingSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    party_size: z.number().int().min(1).max(100),
    name: toolText(60).optional(),
    phone: toolText(32).optional(),
    occasion: toolText(80).optional(),
    notes: toolText(200).optional(),
  })
  .strict();

export const logUnansweredSchema = z.object({ topic: toolText(200) }).strict();

export const handoffSchema = z.object({ reason: toolText(200) }).strict();

export const ASSISTANT_TOOL_NAMES = [
  'search_menu',
  'get_hours',
  'check_availability',
  'propose_cart_add',
  'propose_booking',
  'log_unanswered',
  'handoff',
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOL_NAMES)[number];

export type ToolDeclaration = {
  name: AssistantToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export const ASSISTANT_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'search_menu',
    description:
      'Search and filter the current available café menu. Put every dietary, allergen, category, spice and budget filter into one call. One result is sufficient: answer the guest from it and do not repeat the same search.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        vegan: { type: 'boolean' },
        jain: { type: 'boolean' },
        gluten_free: { type: 'boolean' },
        avoid_allergens: { type: 'array', items: { type: 'string' } },
        max_price: { type: 'number' },
        category: { type: 'string' },
        max_spice: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'get_hours',
    description: 'Get opening and last-order hours for a local café date.',
    parameters: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
    },
  },
  {
    name: 'check_availability',
    description: 'Check booking availability using the current booking rules.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        time: { type: 'string' },
        party_size: { type: 'integer' },
      },
      required: ['date', 'party_size'],
    },
  },
  {
    name: 'propose_cart_add',
    description: 'Propose available menu items for the guest to add.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              qty: { type: 'integer' },
              note: { type: 'string' },
            },
            required: ['id', 'qty'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'propose_booking',
    description: 'Validate and propose a booking without creating it.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        time: { type: 'string' },
        party_size: { type: 'integer' },
        name: { type: 'string' },
        phone: { type: 'string' },
        occasion: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['date', 'time', 'party_size'],
    },
  },
  {
    name: 'log_unanswered',
    description:
      'Record a café question that the supplied facts do not answer.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string' } },
      required: ['topic'],
    },
  },
  {
    name: 'handoff',
    description: 'Offer the guest a contact-team action.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

export type AssistantToolContext = {
  menu: readonly MenuItem[];
  now: Date;
  loadAvailability(date: string, partySize: number): Promise<AvailabilityRow[]>;
  logUnanswered(topic: string): Promise<void>;
};

export type ToolExecution = {
  output: Record<string, unknown>;
  actions: AssistantAction[];
  logged: boolean;
  unansweredTopic?: string;
};

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
});

function safeError(message: string): ToolExecution {
  return { output: { error: message }, actions: [], logged: false };
}

function bookingRuleReason(
  input: { date: string; time?: string; partySize: number },
  now: Date,
): string | null {
  const hours = getCafeHours(input.date);
  if (!hours) return 'Choose a valid booking date.';
  if (hours.closed) return 'The café is closed on Mondays.';
  if (!getBookableDates(now).includes(input.date))
    return `That date is outside the booking window. Bookings open up to ${BOOKING_HORIZON_DAYS} days ahead.`;
  const time = input.time;
  if (!time) return null;

  const rule = validateBooking({ ...input, time }, now);
  if (rule.valid) return null;
  if (rule.errors.some((error) => error.includes('24 hours notice')))
    return `Groups of 8 or more need ${BOOKING_LARGE_PARTY_NOTICE_MINUTES / 60} hours notice.`;
  if (!getBookableTimes(input.date, now).includes(time))
    return `That time is outside the available booking times. Same-day bookings close ${BOOKING_SAME_DAY_CUTOFF_MINUTES / 60} hours ahead.`;
  return 'That booking does not meet the booking rules.';
}

function searchMenu(raw: unknown, menu: readonly MenuItem[]): ToolExecution {
  const input = searchMenuSchema.parse(raw);
  const query = input.query?.toLowerCase();
  const items = menu
    .filter((item) => item.available)
    .filter((item) => {
      const text = [item.name, item.description, item.category, ...item.tags]
        .join(' ')
        .toLowerCase();
      if (query && !text.includes(query)) return false;
      if (input.vegan && !item.vegan) return false;
      if (input.jain && !item.jain_option) return false;
      if (input.gluten_free && !item.gluten_free) return false;
      if (
        input.avoid_allergens?.some((allergen) =>
          item.allergens.includes(allergen),
        )
      )
        return false;
      if (input.max_price !== undefined && item.price_usd > input.max_price)
        return false;
      if (input.category && item.category !== input.category) return false;
      if (input.max_spice !== undefined && item.spice_level > input.max_spice)
        return false;
      return true;
    })
    .slice(0, input.limit)
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: item.price_usd,
      vegan: item.vegan,
      jain: item.jain_option,
      glutenFree: item.gluten_free,
      allergens: item.allergens,
      spice: item.spice_level,
    }));
  return { output: { items }, actions: [], logged: false };
}

async function availability(
  raw: unknown,
  context: AssistantToolContext,
): Promise<ToolExecution> {
  const input = checkAvailabilitySchema.parse(raw);
  const result: AvailabilityResult = await checkBookingAvailability(
    {
      date: input.date,
      time: input.time,
      partySize: input.party_size,
    },
    context.now,
    context.loadAvailability,
  );
  const seatSize =
    input.party_size > 6
      ? null
      : input.party_size <= 2
        ? 2
        : input.party_size <= 4
          ? 4
          : 6;
  return { output: { ...result, seatSize }, actions: [], logged: false };
}

export async function executeAssistantTool(
  name: string,
  raw: unknown,
  context: AssistantToolContext,
): Promise<ToolExecution> {
  try {
    if (name === 'search_menu') return searchMenu(raw, context.menu);
    if (name === 'get_hours') {
      const input = getHoursSchema.parse(raw);
      const date = input.date ?? localDateFormatter.format(context.now);
      const hours = getCafeHours(date);
      return hours
        ? {
            output: {
              ...hours,
              ...(date === localDateFormatter.format(context.now)
                ? { currentState: getOpenState(context.now) }
                : {}),
            },
            actions: [],
            logged: false,
          }
        : safeError('Choose a valid date.');
    }
    if (name === 'check_availability') {
      const input = checkAvailabilitySchema.parse(raw);
      const reason = bookingRuleReason(
        {
          date: input.date,
          time: input.time,
          partySize: input.party_size,
        },
        context.now,
      );
      return reason ? safeError(reason) : await availability(input, context);
    }
    if (name === 'propose_cart_add') {
      const input = proposeCartAddSchema.parse(raw);
      const menu = new Map(context.menu.map((item) => [item.id, item]));
      const merged = new Map<string, number>();
      for (const line of input.items) {
        const item = menu.get(line.id);
        if (!item) return safeError('That item is not on the menu.');
        if (!item.available)
          return safeError('That item is currently unavailable.');
        merged.set(line.id, (merged.get(line.id) ?? 0) + line.qty);
      }
      if ([...merged.values()].some((qty) => qty > 20))
        return safeError('A proposed item quantity is too high.');
      const items = [...merged].map(([id, qty]) => {
        const item = menu.get(id)!;
        return { id, name: item.name, qty, price: item.price_usd };
      });
      const action: AssistantAction = { type: 'cart_add', items };
      return { output: { proposed: items }, actions: [action], logged: false };
    }
    if (name === 'propose_booking') {
      const input = proposeBookingSchema.parse(raw);
      if (input.party_size > 12)
        return {
          output: { handoff: true, reason: 'group above 12' },
          actions: [{ type: 'handoff' }],
          logged: false,
        };
      const reason = bookingRuleReason(
        {
          date: input.date,
          time: input.time,
          partySize: input.party_size,
        },
        context.now,
      );
      if (reason) return safeError(reason);
      const phone = input.phone ? normalisePhone(input.phone) : null;
      if (input.phone && !phone)
        return safeError('The phone number is invalid.');
      const action: AssistantAction = {
        type: 'booking_proposal',
        date: input.date,
        time: input.time,
        partySize: input.party_size,
        ...(input.name ? { name: input.name } : {}),
        ...(phone ? { phone } : {}),
        ...(input.occasion ? { occasion: input.occasion } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      };
      return { output: { proposal: action }, actions: [action], logged: false };
    }
    if (name === 'log_unanswered') {
      const input = logUnansweredSchema.parse(raw);
      await context.logUnanswered(input.topic);
      return {
        output: { logged: true },
        actions: [],
        logged: true,
        unansweredTopic: input.topic,
      };
    }
    if (name === 'handoff') {
      handoffSchema.parse(raw);
      return {
        output: { handoff: true },
        actions: [{ type: 'handoff' }],
        logged: false,
      };
    }
    return safeError('That tool is not available.');
  } catch {
    return safeError('That request could not be completed.');
  }
}
