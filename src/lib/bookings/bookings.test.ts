import { describe, expect, it, vi } from 'vitest';
import {
  cancelBookingRequest,
  placeBooking,
  validateAvailabilityQuery,
  type PlaceBookingDependencies,
} from './bookings';

const now = new Date('2026-11-17T04:30:00.000Z'); // 10:00 in Kolkata
const booking = {
  code: 'PH-BK-1000',
  status: 'confirmed',
  date: '2026-11-18',
  start_time: '12:00:00',
  party_size: 4,
  preorder: null,
  slot_labels: ['SLOT 07'],
};
const deps = (
  overrides: Partial<PlaceBookingDependencies> = {},
): PlaceBookingDependencies => ({
  salt: 'a-safe-test-salt-with-more-than-24-chars',
  now: () => now,
  hash: async (value) => `hash:${value.length}`,
  hitRateLimit: async () => true,
  createBooking: async () => 'PH-BK-1000',
  readBooking: async () => booking,
  getAvailability: async () => [
    { start_time: '11:30:00', remaining: 1, requestable: false },
    { start_time: '12:00:00', remaining: 0, requestable: false },
    { start_time: '12:30:00', remaining: 2, requestable: false },
    { start_time: '13:00:00', remaining: 1, requestable: false },
    { start_time: '13:30:00', remaining: 1, requestable: false },
  ],
  ...overrides,
});
const valid = {
  name: 'ZZ TEST Guest',
  phone: '9876543210',
  email: 'Guest@Example.com',
  date: '2026-11-18',
  time: '12:00',
  partySize: 4,
  occasion: 'none' as const,
  notes: 'Near a plug point',
  preorder: [{ id: 'PH0003', qty: 2 }],
  honeypot: '',
  mountedAt: now.getTime() - 4_000,
};

describe('placeBooking', () => {
  it('normalises and sanitises fields, then returns the database read-back', async () => {
    const createBooking = vi.fn(async () => 'PH-BK-1000');
    const result = await placeBooking(
      {
        ...valid,
        name: '  <b>ZZ TEST Guest</b>  ',
        notes: '  <i>Near a plug point</i>  ',
      },
      '203.0.113.4',
      deps({ createBooking }),
    );
    expect(result).toMatchObject({
      status: 201,
      body: {
        code: 'PH-BK-1000',
        slotLabels: ['SLOT 07'],
        time: '12:00',
        holdUntil: '2026-11-18T06:45:00.000Z',
      },
    });
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ZZ TEST Guest',
        phone: '+919876543210',
        email: 'guest@example.com',
        notes: 'Near a plug point',
      }),
    );
  });

  it('rejects unknown top-level and preorder keys', async () => {
    expect(
      (await placeBooking({ ...valid, status: 'confirmed' }, 'ip', deps()))
        .status,
    ).toBe(400);
    expect(
      (
        await placeBooking(
          {
            ...valid,
            preorder: [{ id: 'PH0003', qty: 1, price: 0 }],
          },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
  });

  it('merges duplicate preorder lines and refuses a merged quantity over 20', async () => {
    const createBooking = vi.fn(async () => 'PH-BK-1000');
    await placeBooking(
      {
        ...valid,
        preorder: [
          { id: 'PH0003', qty: 8 },
          { id: 'PH0003', qty: 12 },
        ],
      },
      'ip',
      deps({ createBooking }),
    );
    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ preorder: [{ id: 'PH0003', qty: 20 }] }),
    );
    expect(
      (
        await placeBooking(
          {
            ...valid,
            preorder: [
              { id: 'PH0003', qty: 10 },
              { id: 'PH0003', qty: 11 },
            ],
          },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
  });

  it('enforces preorder line, id and quantity shapes', async () => {
    const thirteen = Array.from({ length: 13 }, (_, index) => ({
      id: `PH${String(index + 1).padStart(4, '0')}`,
      qty: 1,
    }));
    expect(
      (await placeBooking({ ...valid, preorder: thirteen }, 'ip', deps()))
        .status,
    ).toBe(400);
    expect(
      (
        await placeBooking(
          { ...valid, preorder: [{ id: 'bad', qty: 1 }] },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await placeBooking(
          { ...valid, preorder: [{ id: 'PH0003', qty: 21 }] },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
  });

  it('rejects bot timing, bad phones, and booking rule violations', async () => {
    expect(
      (
        await placeBooking(
          { ...valid, mountedAt: now.getTime() - 500 },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (await placeBooking({ ...valid, honeypot: 'bot' }, 'ip', deps())).status,
    ).toBe(400);
    expect(
      (await placeBooking({ ...valid, phone: 'bad' }, 'ip', deps())).status,
    ).toBe(400);
    expect(
      (await placeBooking({ ...valid, date: '2026-11-23' }, 'ip', deps()))
        .status,
    ).toBe(422);
    expect(
      (
        await placeBooking(
          {
            ...valid,
            date: '2026-11-18',
            time: '09:30',
            partySize: 8,
          },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
  });

  it('applies IP before phone rate limits', async () => {
    const lookup = vi.fn(async () => 'PH-BK-1000');
    expect(
      (
        await placeBooking(
          valid,
          'ip',
          deps({ hitRateLimit: async () => false, createBooking: lookup }),
        )
      ).status,
    ).toBe(429);
    expect(lookup).not.toHaveBeenCalled();

    let calls = 0;
    expect(
      (
        await placeBooking(
          valid,
          'ip',
          deps({ hitRateLimit: async () => ++calls === 1 }),
        )
      ).status,
    ).toBe(429);
  });

  it('maps slot races to 409 with the nearest three alternatives', async () => {
    const result = await placeBooking(
      valid,
      'ip',
      deps({
        createBooking: async () => {
          throw new Error('slot_taken');
        },
      }),
    );
    expect(result).toEqual({
      status: 409,
      body: {
        message: 'That time was just taken.',
        alternatives: ['11:30', '12:30', '13:00'],
      },
    });
  });

  it('maps stable database rule errors without leaking details', async () => {
    const result = await placeBooking(
      valid,
      'ip',
      deps({
        createBooking: async () => {
          throw new Error('notice_required');
        },
      }),
    );
    expect(result).toEqual({
      status: 422,
      body: { message: 'This booking breaks the booking rules.' },
    });

    const preorder = await placeBooking(
      valid,
      'ip',
      deps({
        createBooking: async () => {
          throw new Error('bad_preorder');
        },
      }),
    );
    expect(preorder).toEqual({
      status: 400,
      body: { message: 'Check the booking details.' },
    });
  });
});

describe('availability validation', () => {
  it('accepts strict valid query strings inside the booking window', () => {
    expect(
      validateAvailabilityQuery({ date: '2026-11-18', party: '4' }, now),
    ).toEqual({ date: '2026-11-18', party: 4 });
  });
  it('rejects extra fields, Mondays, malformed and fractional parties', () => {
    expect(
      validateAvailabilityQuery(
        { date: '2026-11-18', party: '4', extra: 'x' },
        now,
      ),
    ).toBeNull();
    expect(
      validateAvailabilityQuery({ date: '2026-11-23', party: '4' }, now),
    ).toBeNull();
    expect(
      validateAvailabilityQuery({ date: '2026-11-18', party: '4.5' }, now),
    ).toBeNull();
  });
});

describe('cancelBookingRequest', () => {
  const cancelDeps = (
    cancelBooking: (code: string, last4: string) => Promise<boolean>,
    hitRateLimit: PlaceBookingDependencies['hitRateLimit'] = async () => true,
  ) => ({
    salt: 'a-safe-test-salt-with-more-than-24-chars',
    hash: async (value: string) => `hash:${value.length}`,
    hitRateLimit,
    cancelBooking,
  });

  it('returns the identical not-found result for a wrong code or digits', async () => {
    const wrongCode = await cancelBookingRequest(
      { code: 'PH-BK-9999', last4: '1234' },
      'ip',
      cancelDeps(async () => false),
    );
    const wrongDigits = await cancelBookingRequest(
      { code: 'PH-BK-1000', last4: '9999' },
      'ip',
      cancelDeps(async () => false),
    );
    expect(wrongCode).toEqual(wrongDigits);
  });

  it('returns success, locks a code after five attempts, and maps cutoffs', async () => {
    expect(
      await cancelBookingRequest(
        { code: 'PH-BK-1000', last4: '1234' },
        'ip',
        cancelDeps(async () => true),
      ),
    ).toEqual({ status: 200, body: { cancelled: true } });

    let calls = 0;
    const limited = await cancelBookingRequest(
      { code: 'PH-BK-1000', last4: '1234' },
      'ip',
      cancelDeps(
        async () => true,
        async () => ++calls < 2,
      ),
    );
    expect(limited.status).toBe(429);

    const late = await cancelBookingRequest(
      { code: 'PH-BK-1000', last4: '1234' },
      'ip',
      cancelDeps(async () => {
        throw new Error('too_late');
      }),
    );
    expect(late.status).toBe(409);
  });

  it('rejects unknown cancellation fields', async () => {
    const result = await cancelBookingRequest(
      { code: 'PH-BK-1000', last4: '1234', phone: 'hidden' },
      'ip',
      cancelDeps(async () => true),
    );
    expect(result.status).toBe(400);
  });
});
