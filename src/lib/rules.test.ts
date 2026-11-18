import { describe, expect, it } from 'vitest';
import {
  bookingRangesOverlap,
  canCancelBooking,
  classifyParty,
  getBookableDates,
  getBookableTimes,
  getBookingHoldUntil,
  getOpenState,
  estimatedPrepMinutes,
  getAsapPickup,
  getPickupDates,
  getPickupWindow,
  hasLargePartyNotice,
  isStudentHourNow,
  isTrekSunday,
  nearestValidPickup,
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
  it('returns today through day 30 while excluding Mondays', () => {
    const dates = getBookableDates(now);
    expect(dates).toContain('2026-11-17');
    expect(dates).not.toContain('2026-11-23');
    expect(dates).toContain('2026-12-17');
    expect(dates).not.toContain('2026-11-16');
    expect(dates).not.toContain('2026-12-18');
  });
  it('allows the exact two-hour boundary and rejects one minute inside it', () => {
    const times = getBookableTimes('2026-11-17', now);
    expect(times[0]).toBe('12:00');
    expect(times).not.toContain('11:59');
    expect(
      getBookableTimes('2026-11-17', atIst('2026-11-17T10:01:00')),
    ).not.toContain('12:00');
  });
  it('uses half-hour steps and the exact weekday last start', () => {
    const times = getBookableTimes('2026-11-17', now);
    expect(times.every((time) => /:(00|30)$/.test(time))).toBe(true);
    expect(times.at(-1)).toBe('20:30');
    expect(times).not.toContain('21:00');
  });
  it('uses the weekend last start and the trek Sunday opening', () => {
    const futureNow = atIst('2026-10-01T10:00:00');
    const saturday = getBookableTimes('2026-10-03', futureNow);
    const sunday = getBookableTimes('2026-10-04', futureNow);
    expect(saturday[0]).toBe('08:00');
    expect(saturday.at(-1)).toBe('22:00');
    expect(sunday[0]).toBe('07:00');
    expect(sunday.at(-1)).toBe('22:00');
  });
  it('classifies every party boundary', () => {
    expect(classifyParty(1)).toBe('confirmed');
    expect(classifyParty(6)).toBe('confirmed');
    expect(classifyParty(7)).toBe('requested');
    expect(classifyParty(8)).toBe('requested');
    expect(classifyParty(12)).toBe('requested');
    expect(classifyParty(13)).toBe('handoff');
    expect(classifyParty(0)).toBe('handoff');
    expect(classifyParty(-1)).toBe('handoff');
    expect(classifyParty(4.5)).toBe('handoff');
  });
  it('enforces the exact 24-hour notice boundary for groups of eight', () => {
    expect(
      validateBooking({ date: '2026-11-18', time: '09:59', partySize: 8 }, now)
        .valid,
    ).toBe(false);
    expect(
      validateBooking({ date: '2026-11-18', time: '10:00', partySize: 8 }, now)
        .valid,
    ).toBe(true);
    expect(hasLargePartyNotice('2026-11-18', '10:00', now)).toBe(true);
    expect(hasLargePartyNotice('2026-11-18', '09:59', now)).toBe(false);
  });
  it('detects 90-minute overlaps but permits touching boundaries', () => {
    const first = atIst('2026-11-17T12:00:00');
    expect(bookingRangesOverlap(first, atIst('2026-11-17T13:29:00'))).toBe(
      true,
    );
    expect(bookingRangesOverlap(first, atIst('2026-11-17T13:30:00'))).toBe(
      false,
    );
    expect(bookingRangesOverlap(first, atIst('2026-11-17T11:00:00'))).toBe(
      true,
    );
  });
  it('uses the exact two-hour cancellation boundary', () => {
    expect(
      canCancelBooking('2026-11-17', '12:00', atIst('2026-11-17T10:00:00')),
    ).toBe(true);
    expect(
      canCancelBooking('2026-11-17', '12:00', atIst('2026-11-17T10:01:00')),
    ).toBe(false);
  });
  it('holds a slot until 15 minutes after its start', () => {
    expect(getBookingHoldUntil('2026-11-17', '12:00')).toEqual(
      atIst('2026-11-17T12:15:00'),
    );
  });
});

describe('order rules', () => {
  const now = atIst('2026-11-17T10:02:00'); // Tuesday
  const one = [{ id: 'PH0003', quantity: 2 }];
  const check = (pickup: string, items = one, at = now) =>
    validateOrder({ items, pickupAt: atIst(pickup) }, at);

  it('works out preparation time: longest item plus five, never under ten', () => {
    expect(estimatedPrepMinutes([])).toBe(10);
    expect(estimatedPrepMinutes([5])).toBe(10);
    expect(estimatedPrepMinutes([12, 6])).toBe(17);
    expect(estimatedPrepMinutes([18])).toBe(23);
  });
  it('rounds the as-soon-as-possible time up to five minutes', () => {
    expect(getAsapPickup(now, 17)).toEqual(atIst('2026-11-17T10:20:00'));
    expect(getAsapPickup(atIst('2026-11-17T10:00:00'), 10)).toEqual(
      atIst('2026-11-17T10:10:00'),
    );
  });
  it('accepts a normal pickup', () => {
    expect(check('2026-11-17T10:30:00').valid).toBe(true);
  });
  it('rejects a closed Monday', () => {
    const result = check('2026-11-23T12:00:00');
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).toContain('closed on Mondays');
  });
  it('rejects pickups at or after last orders but allows the time before', () => {
    expect(check('2026-11-17T20:45:00').valid).toBe(true);
    expect(check('2026-11-17T21:00:00').valid).toBe(false);
    expect(check('2026-11-17T21:15:00').valid).toBe(false);
    expect(check('2026-11-21T22:15:00').valid).toBe(true); // Saturday closes at 11 PM
    expect(check('2026-11-21T22:30:00').valid).toBe(false);
  });
  it('rejects pickups before opening and honours the 7 AM trek Sunday', () => {
    expect(check('2026-11-18T07:00:00').valid).toBe(false);
    expect(check('2026-11-22T07:00:00').valid).toBe(true);
    expect(check('2026-11-22T06:45:00').valid).toBe(false);
  });
  it('needs the kitchen prep time and rejects the past', () => {
    expect(check('2026-11-17T10:12:00').valid).toBe(true);
    expect(check('2026-11-17T10:11:00').valid).toBe(false);
    expect(check('2026-11-17T09:00:00').valid).toBe(false);
    const slow = [{ id: 'PH0109', quantity: 1, prepMinutes: 18 }];
    expect(check('2026-11-17T10:25:00', slow).valid).toBe(true);
    expect(check('2026-11-17T10:24:00', slow).valid).toBe(false);
  });
  it('allows pickups up to seven days ahead only', () => {
    expect(check('2026-11-24T12:00:00').valid).toBe(true);
    expect(check('2026-11-25T12:00:00').valid).toBe(false);
  });
  it('enforces item and quantity limits', () => {
    const ok = '2026-11-17T12:00:00';
    expect(check(ok, []).valid).toBe(false);
    expect(check(ok, [{ id: 'PH0003', quantity: 20 }]).valid).toBe(true);
    expect(check(ok, [{ id: 'PH0003', quantity: 21 }]).valid).toBe(false);
    expect(
      check(ok, [
        { id: 'PH0003', quantity: 12 },
        { id: 'PH0003', quantity: 12 },
      ]).valid,
    ).toBe(false);
    expect(check(ok, [{ id: 'PH0003', quantity: 0 }]).valid).toBe(false);
    expect(check(ok, [{ id: 'PH0003', quantity: 1.5 }]).valid).toBe(false);
    expect(check(ok, [{ id: 'ABC', quantity: 1 }]).valid).toBe(false);
    const lines = (n: number, each: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `PH${String(i + 1).padStart(4, '0')}`,
        quantity: each,
      }));
    expect(check(ok, lines(8, 5)).valid).toBe(true); // 40 items
    expect(check(ok, lines(9, 5)).valid).toBe(false); // 45 items
  });
  it('rejects an invalid date object', () => {
    expect(
      validateOrder({ items: one, pickupAt: new Date('nope') }, now).valid,
    ).toBe(false);
  });
});

describe('pickup choices', () => {
  const now = atIst('2026-11-17T10:02:00'); // Tuesday
  it('lists 15-minute times and marks impossible ones with a reason', () => {
    const times = getPickupWindow('2026-11-17', now, 10);
    expect(times[0]).toMatchObject({ time: '08:00', available: false });
    expect(times[0]?.reason).toContain('Too soon');
    expect(times.find((t) => t.available)?.time).toBe('10:15');
    expect(times.at(-1)?.time).toBe('20:45');
    expect(times.every((t) => t.available || t.reason)).toBe(true);
  });
  it('lists nothing for Mondays and dates outside the week', () => {
    expect(getPickupWindow('2026-11-23', now, 10)).toEqual([]);
    expect(getPickupWindow('2026-11-30', now, 10)).toEqual([]);
    expect(getPickupWindow('not-a-date', now, 10)).toEqual([]);
  });
  it('lists today plus seven days and flags Monday', () => {
    const dates = getPickupDates(now);
    expect(dates).toHaveLength(8);
    expect(dates[0]).toEqual({ date: '2026-11-17', available: true });
    const monday = dates.find((d) => d.date === '2026-11-23');
    expect(monday?.available).toBe(false);
    expect(monday?.reason).toContain('Tuesday');
  });
  it('closes today once last orders have passed', () => {
    const late = atIst('2026-11-17T20:50:00');
    expect(getPickupDates(late)[0]?.available).toBe(false);
    expect(getPickupDates(late)[1]?.available).toBe(true);
  });
  it('finds the nearest valid pickup', () => {
    expect(nearestValidPickup(atIst('2026-11-16T12:00:00'), 10)).toEqual(
      atIst('2026-11-17T08:00:00'),
    );
    expect(nearestValidPickup(atIst('2026-11-17T21:10:00'), 10)).toEqual(
      atIst('2026-11-18T08:00:00'),
    );
    expect(nearestValidPickup(now, 17)).toEqual(atIst('2026-11-17T10:20:00'));
  });
});

describe('offer and event rules', () => {
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
