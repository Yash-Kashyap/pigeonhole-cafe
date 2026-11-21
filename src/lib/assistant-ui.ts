import { z } from 'zod';
import type { AssistantAction, AssistantResponse } from './assistant/types';
import type { CartItem } from './cart';

export type AssistantPage =
  | 'home'
  | 'menu'
  | 'order'
  | 'reserve'
  | 'story'
  | 'visit'
  | 'gatherings'
  | 'trek-stop'
  | 'other';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: AssistantAction[];
  resting?: boolean;
  isError?: boolean;
};

export const assistantResponseSchema = z.object({
  text: z.string(),
  actions: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('cart_add'),
        items: z.array(
          z.object({
            id: z.string().regex(/^PH\d{4}$/),
            name: z.string(),
            qty: z.number().int().min(1),
            price: z.number(),
          }),
        ),
      }),
      z.object({
        type: z.literal('booking_proposal'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string(),
        partySize: z.number().int().min(1).max(12),
        name: z.string().optional(),
        phone: z.string().optional(),
        occasion: z.string().optional(),
        notes: z.string().optional(),
      }),
      z.object({
        type: z.literal('handoff'),
      }),
    ]),
  ),
  ids: z.array(z.string()),
  logged: z.boolean(),
  resting: z.boolean().optional(),
  fallback: z
    .enum(['timeout', 'quota', 'unavailable', 'tool_limit', 'model'])
    .optional(),
});

export const STARTER_CHIPS: Record<AssistantPage, string> = {
  home: 'Is it open now?',
  menu: 'What is vegan under $3?',
  order: 'Add a Post Chai and two Maska Pav',
  reserve: 'Book a slot for 4 tomorrow evening',
  visit: 'Any parking?',
  'trek-stop': 'What should I eat before a trek?',
  story: 'Is it open now?',
  gatherings: 'Is it open now?',
  other: 'Is it open now?',
};

export function mapPathToPage(pathname: string): AssistantPage {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return 'home';
  if (clean === '/menu' || clean.startsWith('/menu/')) return 'menu';
  if (clean === '/order') return 'order';
  if (clean === '/reserve') return 'reserve';
  if (clean === '/story' || clean.startsWith('/story/')) return 'story';
  if (clean === '/visit' || clean.startsWith('/visit/')) return 'visit';
  if (clean === '/gatherings' || clean.startsWith('/gatherings/'))
    return 'gatherings';
  if (clean === '/trek-stop' || clean.startsWith('/trek-stop/'))
    return 'trek-stop';
  return 'other';
}

export function generateSessionId(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(24);
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

export type OutgoingMessage = {
  role: 'user' | 'assistant';
  text: string;
};

export type AssistantRequestBody = {
  sessionId: string;
  messages: OutgoingMessage[];
  page: AssistantPage;
  cart?: { id: string; qty: number }[];
};

export function sanitizeMessageText(value: string): string {
  const printable = Array.from(value)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('');
  return printable.trim().slice(0, 500);
}

export function buildAssistantRequest(
  sessionId: string,
  messages: { role: 'user' | 'assistant'; text: string }[],
  page: AssistantPage,
  cartItems?: CartItem[],
): AssistantRequestBody {
  const cleanMessages: OutgoingMessage[] = messages.map((m) => {
    const text = sanitizeMessageText(m.text);
    return {
      role: m.role,
      text: text.length > 0 ? text : '...',
    };
  });

  const sliced = cleanMessages.slice(-12);
  if (sliced.length === 0 || sliced[sliced.length - 1]?.role !== 'user') {
    throw new Error('The last message must be from the user.');
  }

  const body: AssistantRequestBody = {
    sessionId,
    messages: sliced,
    page,
  };

  if (cartItems && cartItems.length > 0) {
    const validLines = cartItems
      .filter((item) => /^PH\d{4}$/.test(item.id) && item.quantity >= 1)
      .slice(0, 40)
      .map((item) => ({
        id: item.id,
        qty: Math.min(20, Math.max(1, Math.floor(item.quantity))),
      }));
    if (validLines.length > 0) {
      body.cart = validLines;
    }
  }

  return body;
}

export function parseAssistantResponse(raw: unknown): AssistantResponse | null {
  const result = assistantResponseSchema.safeParse(raw);
  if (!result.success) return null;
  return result.data as AssistantResponse;
}

export type TextBlock =
  { type: 'paragraph'; text: string } | { type: 'list'; items: string[] };

export function parseAssistantTextBlocks(content: string): TextBlock[] {
  const lines = content.split('\n');
  const blocks: TextBlock[] = [];
  let currentList: string[] = [];

  const flushList = () => {
    if (currentList.length > 0) {
      blocks.push({ type: 'list', items: [...currentList] });
      currentList = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      currentList.push(trimmed.slice(2).trim());
    } else if (trimmed.length > 0) {
      flushList();
      blocks.push({ type: 'paragraph', text: trimmed });
    } else {
      flushList();
    }
  }
  flushList();
  return blocks;
}
