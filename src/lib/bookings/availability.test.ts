import { describe, expect, it, vi } from 'vitest';
import { checkBookingAvailability } from './availability';

const now = new Date('2026-11-18T04:30:00.000Z');

describe('shared booking availability', () => {
  it('filters database rows through the current rule clock', async () => {
    const load = vi.fn().mockResolvedValue([
      { start_time: '10:00:00', remaining: 2, requestable: false },
      { start_time: '12:00:00', remaining: 1, requestable: false },
    ]);
    const result = await checkBookingAvailability(
      { date: '2026-11-18', partySize: 5 },
      now,
      load,
    );
    expect(result.times).toEqual([
      { time: '12:00', remaining: 1, requestable: false },
    ]);
  });

  it('rejects unknown keys, bad parties and closed dates', async () => {
    const load = vi.fn();
    await expect(
      checkBookingAvailability(
        { date: '2026-11-20', partySize: 5, override: true },
        now,
        load,
      ),
    ).rejects.toThrow();
    await expect(
      checkBookingAvailability(
        { date: '2026-11-20', partySize: 13 },
        now,
        load,
      ),
    ).rejects.toThrow();
    await expect(
      checkBookingAvailability({ date: '2026-11-23', partySize: 4 }, now, load),
    ).rejects.toThrow('invalid_date');
  });
});
