import { describe, expect, it } from 'vitest';
import {
  classifyParty,
  getBookableDates,
  getBookableTimes,
  getOpenState,
  getPickupWindow,
  isStudentHourNow,
  isTrekSunday,
  nextFirstSaturday,
  validateBooking,
  validateOrder,
} from './rules';

const atIst = (value: string) => new Date(`${value}+05:30`);

describe('opening rules', () => {
  it('closes every Monday', () =>
    expect(getOpenState(atIst('2026-11-16T12:00:00')).state).toBe('closed'));
  it('reports weekday opening and last orders', () => {
    expect(getOpenState(atIst('2026-11-17T09:00:00')).label).toBe(
      'Open now, until 9:30 PM',
    );
    expect(getOpenState(atIst('2026-11-17T21:05:00')).state).toBe(
      'last-orders-passed',
    );
  });
  it('opens at 7 on trek-season Sundays', () =>
    expect(getOpenState(atIst('2026-11-22T07:15:00')).state).toBe('open'));
});

describe('booking rules', () => {
  const now = atIst('2026-11-17T10:00:00');
  it('returns non-Monday dates through the 30-day horizon', () => {
    const dates = getBookableDates(now);
    expect(dates).toContain('2026-11-17');
    expect(dates).not.toContain('2026-11-23');
    expect(dates).toContain('2026-12-17');
  });
  it('uses half-hour times, the two-hour cutoff, and the closing cutoff', () => {
    const times = getBookableTimes('2026-11-17', now);
    expect(times[0]).toBe('12:00');
    expect(times.at(-1)).toBe('20:30');
  });
  it('classifies parties', () => {
    expect(classifyParty(6)).toBe('confirmed');
    expect(classifyParty(7)).toBe('requested');
    expect(classifyParty(12)).toBe('requested');
    expect(classifyParty(13)).toBe('handoff');
  });
  it('enforces 24 hours notice for groups of eight', () => {
    expect(
      validateBooking({ date: '2026-11-18', time: '09:30', partySize: 8 }, now)
        .valid,
    ).toBe(false);
    expect(
      validateBooking({ date: '2026-11-19', time: '09:30', partySize: 8 }, now)
        .valid,
    ).toBe(true);
  });
});

describe('order and offer rules', () => {
  const now = atIst('2026-11-17T10:02:00');
  it('rounds the earliest pickup after twenty minutes', () =>
    expect(getPickupWindow(now).earliest).toEqual(
      atIst('2026-11-17T10:25:00'),
    ));
  it('validates item IDs, quantities, and pickup window', () => {
    expect(
      validateOrder(
        {
          items: [{ id: 'PH0003', quantity: 2 }],
          pickupAt: atIst('2026-11-17T10:30:00'),
        },
        now,
      ).valid,
    ).toBe(true);
    expect(
      validateOrder({ items: [], pickupAt: atIst('2026-11-17T10:10:00') }, now)
        .valid,
    ).toBe(false);
  });
  it('finds the next first Saturday', () =>
    expect(nextFirstSaturday(atIst('2026-11-08T12:00:00'))).toEqual(
      atIst('2026-12-05T00:00:00'),
    ));
  it('recognises trek Sundays and student hours', () => {
    expect(isTrekSunday(atIst('2026-10-04T08:00:00'))).toBe(true);
    expect(isTrekSunday(atIst('2026-12-06T08:00:00'))).toBe(false);
    expect(isStudentHourNow(atIst('2026-11-17T15:00:00'))).toBe(true);
    expect(isStudentHourNow(atIst('2026-11-20T15:00:00'))).toBe(false);
  });
});
