import { describe, expect, it } from 'vitest';
import {
  buildAssistantRequest,
  generateSessionId,
  mapPathToPage,
  parseAssistantResponse,
  parseAssistantTextBlocks,
  STARTER_CHIPS,
} from './assistant-ui';
import type { CartItem } from './cart';

describe('assistant-ui helpers', () => {
  describe('mapPathToPage', () => {
    it('maps standard public routes to AssistantPage', () => {
      expect(mapPathToPage('/')).toBe('home');
      expect(mapPathToPage('')).toBe('home');
      expect(mapPathToPage('/menu')).toBe('menu');
      expect(mapPathToPage('/menu/')).toBe('menu');
      expect(mapPathToPage('/order')).toBe('order');
      expect(mapPathToPage('/order/')).toBe('order');
      expect(mapPathToPage('/reserve')).toBe('reserve');
      expect(mapPathToPage('/reserve/')).toBe('reserve');
      expect(mapPathToPage('/story')).toBe('story');
      expect(mapPathToPage('/visit')).toBe('visit');
      expect(mapPathToPage('/gatherings')).toBe('gatherings');
      expect(mapPathToPage('/trek-stop')).toBe('trek-stop');
    });

    it('maps unknown and subroutes to other', () => {
      expect(mapPathToPage('/order/confirmed')).toBe('other');
      expect(mapPathToPage('/reserve/confirmed')).toBe('other');
      expect(mapPathToPage('/random-unknown')).toBe('other');
      expect(mapPathToPage('/_kit')).toBe('other');
    });

    it('has exact required starter chips', () => {
      expect(STARTER_CHIPS.home).toBe('Is it open now?');
      expect(STARTER_CHIPS.menu).toBe('What is vegan under $3?');
      expect(STARTER_CHIPS.order).toBe('Add a Post Chai and two Maska Pav');
      expect(STARTER_CHIPS.reserve).toBe('Book a slot for 4 tomorrow evening');
      expect(STARTER_CHIPS.visit).toBe('Any parking?');
      expect(STARTER_CHIPS['trek-stop']).toBe(
        'What should I eat before a trek?',
      );
      expect(STARTER_CHIPS.other).toBe('Is it open now?');
    });
  });

  describe('generateSessionId', () => {
    it('generates session ids conforming to regex ^[A-Za-z0-9_-]{8,64}$ and length >= 20', () => {
      const id = generateSessionId();
      expect(id.length).toBeGreaterThanOrEqual(20);
      expect(id.length).toBeLessThanOrEqual(64);
      expect(/^[A-Za-z0-9_-]{8,64}$/.test(id)).toBe(true);
    });

    it('generates distinct IDs', () => {
      const ids = new Set(
        Array.from({ length: 10 }, () => generateSessionId()),
      );
      expect(ids.size).toBe(10);
    });
  });

  describe('buildAssistantRequest', () => {
    it('builds a valid request payload with capped messages and characters', () => {
      const messages = [
        { role: 'user' as const, text: 'Hello' },
        { role: 'assistant' as const, text: 'Hi! How can I help?' },
        { role: 'user' as const, text: 'a'.repeat(600) },
      ];
      const result = buildAssistantRequest('sess_12345678', messages, 'home');
      expect(result.sessionId).toBe('sess_12345678');
      expect(result.page).toBe('home');
      expect(result.messages.length).toBe(3);
      expect(result.messages[2]?.text.length).toBe(500);
    });

    it('caps conversation to the last 12 messages', () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        text: `Message ${i}`,
      }));
      // Ensure last is user
      messages.push({ role: 'user', text: 'Last question' });

      const result = buildAssistantRequest('sess_12345678', messages, 'menu');
      expect(result.messages.length).toBe(12);
      expect(result.messages[11]?.text).toBe('Last question');
      expect(result.messages[11]?.role).toBe('user');
    });

    it('maps cart items to id + qty only, clamped', () => {
      const cartItems: CartItem[] = [
        { id: 'PH0001', quantity: 3, note: 'extra hot' },
        { id: 'PH0002', quantity: 50 }, // exceeds 20
        { id: 'INVALID', quantity: 1 },
      ];
      const result = buildAssistantRequest(
        'sess_12345678',
        [{ role: 'user', text: 'Menu question' }],
        'order',
        cartItems,
      );
      expect(result.cart).toEqual([
        { id: 'PH0001', qty: 3 },
        { id: 'PH0002', qty: 20 },
      ]);
      // Note was not included, invalid ID filtered
    });

    it('throws if the last message is not user', () => {
      expect(() =>
        buildAssistantRequest(
          'sess_12345678',
          [
            { role: 'user', text: 'Hi' },
            { role: 'assistant', text: 'Hello' },
          ],
          'home',
        ),
      ).toThrow('The last message must be from the user.');
    });
  });

  describe('parseAssistantResponse', () => {
    it('parses valid assistant response with actions and resting state', () => {
      const raw = {
        text: 'Here is what I found.',
        actions: [
          {
            type: 'cart_add',
            items: [{ id: 'PH0001', name: 'Post Chai', qty: 2, price: 2.5 }],
          },
          {
            type: 'booking_proposal',
            date: '2026-11-22',
            time: '18:30',
            partySize: 4,
            name: 'Alex',
          },
          {
            type: 'handoff',
          },
        ],
        ids: ['PH0001'],
        logged: true,
        resting: false,
      };
      const parsed = parseAssistantResponse(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.text).toBe('Here is what I found.');
      expect(parsed?.actions.length).toBe(3);
    });

    it('returns null on invalid response payload', () => {
      expect(parseAssistantResponse(null)).toBeNull();
      expect(parseAssistantResponse({ text: 123 })).toBeNull();
      expect(
        parseAssistantResponse({
          text: 'test',
          actions: [{ type: 'unknown_action' }],
        }),
      ).toBeNull();
      expect(
        parseAssistantResponse({
          text: 'test',
          actions: [],
          ids: ['PH0001'],
          // missing logged boolean
        }),
      ).toBeNull();
    });
  });

  describe('parseAssistantTextBlocks', () => {
    it('separates plain text paragraphs and bullet points', () => {
      const input =
        'Hello there!\nWe offer great drinks:\n- Post Chai\n- Mountain Mint\nEnjoy your stay.';
      const blocks = parseAssistantTextBlocks(input);
      expect(blocks).toEqual([
        { type: 'paragraph', text: 'Hello there!' },
        { type: 'paragraph', text: 'We offer great drinks:' },
        { type: 'list', items: ['Post Chai', 'Mountain Mint'] },
        { type: 'paragraph', text: 'Enjoy your stay.' },
      ]);
    });
  });
});
