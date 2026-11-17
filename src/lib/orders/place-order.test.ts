import { describe, expect, it, vi } from 'vitest';
import {
  placeOrder,
  saltedRateLimitKey,
  type PlaceOrderDependencies,
} from './place-order';

const now = new Date('2026-11-17T05:00:00.000Z');
const menu = [
  {
    id: 'PH0003',
    name: 'Post Chai',
    price_usd: 1.4,
    prep_minutes: 5,
    available: true,
  },
];
const deps = (
  overrides: Partial<PlaceOrderDependencies> = {},
): PlaceOrderDependencies => ({
  salt: 'a-safe-test-salt-with-more-than-24-chars',
  now: () => now,
  hash: async (value) => `hash:${value.length}`,
  loadMenuItems: async () => menu,
  hitRateLimit: async () => true,
  createOrder: async () => 'PH-ORD-1000',
  readOrder: async () => ({
    code: 'PH-ORD-1000',
    pickup_at: '2026-11-17T05:15:00.000Z',
    subtotal: 2.8,
  }),
  ...overrides,
});
const valid = {
  items: [{ id: 'PH0003', qty: 2 }],
  name: 'Ira Thakur',
  phone: '9876543210',
  asap: true,
  notes: '',
  honeypot: '',
  mountedAt: now.getTime() - 4_000,
};

describe('placeOrder', () => {
  it('creates an order from database values and normalises the phone', async () => {
    const createOrder = vi.fn(async () => 'PH-ORD-1000');
    const result = await placeOrder(
      valid,
      '203.0.113.4',
      deps({ createOrder }),
    );
    expect(result.status).toBe(201);
    expect(
      (createOrder.mock.calls as unknown as Array<[unknown]>)[0]?.[0],
    ).toMatchObject({
      phone: '+919876543210',
      source: 'site',
      items: [{ id: 'PH0003', qty: 2 }],
    });
    if (result.status === 201) expect(result.body.subtotal).toBe(2.8);
  });
  it('rejects client totals and unknown fields', async () =>
    expect(
      (await placeOrder({ ...valid, price: 0 }, 'ip', deps())).status,
    ).toBe(400));
  it('merges duplicate lines and enforces caps', async () => {
    const createOrder = vi.fn(async () => 'PH-ORD-1000');
    await placeOrder(
      {
        ...valid,
        items: [
          { id: 'PH0003', qty: 10 },
          { id: 'PH0003', qty: 10 },
        ],
      },
      'ip',
      deps({ createOrder }),
    );
    const firstCreate = (
      createOrder.mock.calls as unknown as Array<[{ items: unknown }]>
    )[0];
    expect(firstCreate?.[0]?.items).toEqual([{ id: 'PH0003', qty: 20 }]);
    expect(
      (
        await placeOrder(
          {
            ...valid,
            items: [
              { id: 'PH0003', qty: 20 },
              { id: 'PH0003', qty: 1 },
            ],
          },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
  });
  it('returns unavailable ids and rate-limits before database lookup', async () => {
    const result = await placeOrder(
      valid,
      'ip',
      deps({ loadMenuItems: async () => [] }),
    );
    expect(result).toMatchObject({
      status: 409,
      body: { unavailableIds: ['PH0003'] },
    });
    const lookup = vi.fn(async () => menu);
    expect(
      (
        await placeOrder(
          valid,
          'ip',
          deps({ hitRateLimit: async () => false, loadMenuItems: lookup }),
        )
      ).status,
    ).toBe(429);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('rejects bad phones, bots, stale timestamps, and future timestamps', async () => {
    expect(
      (await placeOrder({ ...valid, phone: 'abc' }, 'ip', deps())).status,
    ).toBe(400);
    expect(
      (await placeOrder({ ...valid, honeypot: 'bot' }, 'ip', deps())).status,
    ).toBe(400);
    expect(
      (
        await placeOrder(
          { ...valid, mountedAt: now.getTime() - 86_400_001 },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await placeOrder(
          { ...valid, mountedAt: now.getTime() + 1 },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
  });
  it('does not embed raw identifiers in hashed keys', async () => {
    const key = await saltedRateLimitKey(
      deps(),
      'order-phone',
      '+919876543210',
    );
    expect(key).not.toContain('9876543210');
    expect(key).not.toContain('203.0.113.4');
  });
});
