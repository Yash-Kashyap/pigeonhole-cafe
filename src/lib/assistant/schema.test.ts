import { describe, expect, it } from 'vitest';
import { assistantRequestSchema } from './schema';

const valid = () => ({
  sessionId: 'session-1234',
  messages: [{ role: 'user' as const, text: 'Are you open?' }],
  page: 'home' as const,
});

describe('assistant request schema', () => {
  it('accepts the strict contract and keeps the last twelve turns', () => {
    const messages = Array.from({ length: 13 }, (_, index) => ({
      role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `Message ${index}`,
    }));
    expect(
      assistantRequestSchema.parse({ ...valid(), messages }).messages,
    ).toHaveLength(12);
  });

  it.each([
    ['unknown key', { ...valid(), admin: true }],
    ['short session', { ...valid(), sessionId: 'short' }],
    ['long session', { ...valid(), sessionId: 'x'.repeat(65) }],
    ['bad session character', { ...valid(), sessionId: 'bad session' }],
    ['no messages', { ...valid(), messages: [] }],
    [
      'assistant last',
      { ...valid(), messages: [{ role: 'assistant', text: 'Hello' }] },
    ],
    [
      'unknown message key',
      { ...valid(), messages: [{ role: 'user', text: 'Hello', id: 1 }] },
    ],
    [
      'unknown role',
      { ...valid(), messages: [{ role: 'system', text: 'Hello' }] },
    ],
    ['empty text', { ...valid(), messages: [{ role: 'user', text: '' }] }],
    [
      'long text',
      { ...valid(), messages: [{ role: 'user', text: 'x'.repeat(501) }] },
    ],
    [
      'control character',
      { ...valid(), messages: [{ role: 'user', text: 'Hello\nthere' }] },
    ],
    ['bad page', { ...valid(), page: 'admin' }],
    ['bad cart id', { ...valid(), cart: [{ id: 'not-an-id', qty: 1 }] }],
    ['bad cart quantity', { ...valid(), cart: [{ id: 'PH0001', qty: 21 }] }],
    [
      'unknown cart key',
      { ...valid(), cart: [{ id: 'PH0001', qty: 1, price: 0.01 }] },
    ],
    [
      'too many cart lines',
      {
        ...valid(),
        cart: Array.from({ length: 41 }, () => ({ id: 'PH0001', qty: 1 })),
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(assistantRequestSchema.safeParse(value).success).toBe(false);
  });
});
