import { describe, expect, it } from 'vitest';
import { buildPickupSlotIso, resolveOrderPickupParam } from './order-pickup';

// Wednesday 18 Nov 2026, 12:00 IST (06:30 UTC)
const wednesdayNoon = new Date('2026-11-18T06:30:00.000Z');

describe('order ?pickup= query parameter resolution', () => {
  it('accepts a valid available pickup slot in ISO UTC or +05:30 form', () => {
    const iso = buildPickupSlotIso('2026-11-18', '13:15');
    expect(iso).toBe('2026-11-18T07:45:00.000Z');

    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(iso!)}`,
        wednesdayNoon,
        15,
      ),
    ).toEqual({
      date: '2026-11-18',
      time: '13:15',
      iso: '2026-11-18T07:45:00.000Z',
    });

    expect(
      resolveOrderPickupParam(
        '?pickup=2026-11-18T13%3A15%3A00%2B05%3A30',
        wednesdayNoon,
        15,
      ),
    ).toEqual({
      date: '2026-11-18',
      time: '13:15',
      iso: '2026-11-18T07:45:00.000Z',
    });
  });

  it('rejects Mondays, past times, non-15-minute steps, last-orders times, and garbage', () => {
    // Monday 23 Nov 2026
    const mondayIso = buildPickupSlotIso('2026-11-23', '12:00')!;
    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(mondayIso)}`,
        wednesdayNoon,
        15,
      ),
    ).toBeNull();

    // Too soon (12:05 IST when now is 12:00 IST and prep is 15 min)
    const tooSoon = buildPickupSlotIso('2026-11-18', '12:05')!;
    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(tooSoon)}`,
        wednesdayNoon,
        15,
      ),
    ).toBeNull();

    // Non-15-minute step (13:10 IST)
    const offStep = buildPickupSlotIso('2026-11-18', '13:10')!;
    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(offStep)}`,
        wednesdayNoon,
        15,
      ),
    ).toBeNull();

    // Weekday last orders (21:00 IST is refused; last pickup is 20:45)
    const lastOrders = buildPickupSlotIso('2026-11-18', '21:00')!;
    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(lastOrders)}`,
        wednesdayNoon,
        15,
      ),
    ).toBeNull();

    // Beyond 7-day horizon
    const tooFar = buildPickupSlotIso('2026-11-28', '12:00')!;
    expect(
      resolveOrderPickupParam(
        `?pickup=${encodeURIComponent(tooFar)}`,
        wednesdayNoon,
        15,
      ),
    ).toBeNull();

    // Garbage or non-zero seconds
    expect(
      resolveOrderPickupParam('?pickup=not-a-date', wednesdayNoon, 15),
    ).toBeNull();
    expect(
      resolveOrderPickupParam(
        '?pickup=2026-11-18T13:15:30+05:30',
        wednesdayNoon,
        15,
      ),
    ).toBeNull();
    expect(resolveOrderPickupParam('', wednesdayNoon, 15)).toBeNull();
  });
});
