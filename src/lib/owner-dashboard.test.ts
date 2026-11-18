import { describe, expect, it } from 'vitest';
import {
  buildEnquiryReplyWhatsAppUrl,
  buildMenuPatch,
  buildOrderReadyWhatsAppUrl,
  canCancelOrder,
  formatEnquiryPayloadEntries,
  formatRelativePickup,
  formatTimeSince,
  formatTimeValue,
  formatUsd,
  getAllowedBookingActions,
  getNextOrderAction,
  groupBookingsByTime,
  isSlotOccupiedForBooking,
  mapOwnerApiError,
  normaliseCustomerWhatsAppPhone,
  parseBookingPreorder,
  todayInKolkata,
  validateMenuEdit,
} from './owner-dashboard';

const fixedNow = new Date('2026-11-18T08:00:00.000Z'); // 13:30 IST

describe('owner dashboard time formatting', () => {
  it('formats Kolkata dates and clock times reliably', () => {
    expect(todayInKolkata(fixedNow)).toBe('2026-11-18');
    expect(formatTimeValue('08:30:00')).toBe('8:30 AM');
    expect(formatTimeValue('13:00:00')).toBe('1:00 PM');
    expect(formatTimeValue('2026-11-18T08:15:00.000Z')).toBe('1:45 PM');
    expect(formatTimeValue(null)).toBe('ASAP');
    expect(formatUsd('6.5')).toBe('$6.50');
  });

  it('builds relative pickup text for upcoming, current, and past pickups', () => {
    expect(formatRelativePickup(null, fixedNow)).toBe('ASAP');
    expect(formatRelativePickup('2026-11-18T08:12:00.000Z', fixedNow)).toBe(
      'in 12 min',
    );
    expect(formatRelativePickup('2026-11-18T09:20:00.000Z', fixedNow)).toBe(
      'in 1 h 20 min',
    );
    expect(formatRelativePickup('2026-11-18T08:00:00.000Z', fixedNow)).toBe(
      'now',
    );
    expect(formatRelativePickup('2026-11-18T07:45:00.000Z', fixedNow)).toBe(
      '15 min ago',
    );
  });

  it('builds elapsed time since an order was placed', () => {
    expect(formatTimeSince('2026-11-18T07:59:45.000Z', fixedNow)).toBe(
      'just now',
    );
    expect(formatTimeSince('2026-11-18T07:48:00.000Z', fixedNow)).toBe(
      '12 min ago',
    );
    expect(formatTimeSince('2026-11-18T06:30:00.000Z', fixedNow)).toBe(
      '1 h 30 min ago',
    );
    expect(formatTimeSince('2026-11-16T08:00:00.000Z', fixedNow)).toBe(
      '2 days ago',
    );
  });
});

describe('owner order and booking status button rules', () => {
  it('maps each order status to its single allowed next step and cancel rule', () => {
    expect(getNextOrderAction('new')).toEqual({
      nextStatus: 'preparing',
      label: 'Start preparing',
    });
    expect(getNextOrderAction('preparing')).toEqual({
      nextStatus: 'ready',
      label: 'Mark ready',
    });
    expect(getNextOrderAction('ready')).toEqual({
      nextStatus: 'collected',
      label: 'Mark collected',
    });
    expect(getNextOrderAction('collected')).toBeNull();
    expect(getNextOrderAction('cancelled')).toBeNull();

    expect(canCancelOrder('new')).toBe(true);
    expect(canCancelOrder('preparing')).toBe(true);
    expect(canCancelOrder('ready')).toBe(true);
    expect(canCancelOrder('collected')).toBe(false);
    expect(canCancelOrder('cancelled')).toBe(false);
  });

  it('exposes the exact allowed booking actions per status', () => {
    expect(getAllowedBookingActions('requested')).toEqual({
      confirm: true,
      decline: true,
      seated: false,
      noShow: false,
      cancel: true,
    });
    expect(getAllowedBookingActions('confirmed')).toEqual({
      confirm: false,
      decline: true,
      seated: true,
      noShow: true,
      cancel: true,
    });
    expect(getAllowedBookingActions('seated')).toEqual({
      confirm: false,
      decline: false,
      seated: false,
      noShow: false,
      cancel: false,
    });
    expect(getAllowedBookingActions('declined').cancel).toBe(false);
  });
});

describe('owner WhatsApp links', () => {
  it('normalises customer phone numbers and builds prefilled wa.me URLs', () => {
    expect(normaliseCustomerWhatsAppPhone('9876543210')).toBe('919876543210');
    expect(normaliseCustomerWhatsAppPhone('+91 98765-43210')).toBe(
      '919876543210',
    );
    expect(normaliseCustomerWhatsAppPhone('123')).toBeNull();

    expect(buildOrderReadyWhatsAppUrl('+919876543210', 'PH-ORD-1234')).toBe(
      'https://wa.me/919876543210?text=Your%20order%20PH-ORD-1234%20is%20ready',
    );
    expect(buildOrderReadyWhatsAppUrl('', 'PH-ORD-1234')).toBeNull();

    const enquiryUrl = buildEnquiryReplyWhatsAppUrl(
      '9876543210',
      'Demo Guest 1',
      'open_mic',
    );
    expect(enquiryUrl).toContain('https://wa.me/919876543210?text=');
    expect(decodeURIComponent(enquiryUrl ?? '')).toContain('open-mic');
  });
});

describe('owner error mapping', () => {
  it('maps HTTP statuses and stable booking error codes to plain copy', () => {
    expect(mapOwnerApiError(401)).toContain('session');
    expect(mapOwnerApiError(403)).toContain('Owner access');
    expect(mapOwnerApiError(429)).toContain('Too many');
    expect(mapOwnerApiError(409, 'slot_taken')).toContain('just taken');
    expect(mapOwnerApiError(422, 'too_few_seats')).toContain('enough seats');
    expect(mapOwnerApiError(400, 'bad_slots')).toContain('S1 to S16');
    expect(mapOwnerApiError(400, 'reason_required')).toContain('reason');
    expect(mapOwnerApiError(404, 'not_found')).toContain('not be found');
    expect(mapOwnerApiError(409, 'bad_transition')).toContain(
      'no longer allowed',
    );
    expect(mapOwnerApiError(409, 'One or more slots were just taken.')).toBe(
      'One or more slots were just taken.',
    );
  });
});

describe('booking helpers', () => {
  it('detects 90-minute slot overlaps and ignores cancelled or declined bookings', () => {
    const bookings = [
      {
        id: 'b1',
        start_time: '18:00:00',
        status: 'confirmed' as const,
        slotIds: ['S1', 'S2'],
      },
      {
        id: 'b2',
        start_time: '18:30:00',
        status: 'cancelled' as const,
        slotIds: ['S3'],
      },
    ];
    expect(isSlotOccupiedForBooking('S1', '18:30:00', bookings)).toBe(true);
    expect(isSlotOccupiedForBooking('S1', '19:30:00', bookings)).toBe(false);
    expect(isSlotOccupiedForBooking('S3', '18:30:00', bookings)).toBe(false);
    expect(isSlotOccupiedForBooking('S1', '18:30:00', bookings, 'b1')).toBe(
      false,
    );
  });

  it('parses pre-order snapshots and groups bookings by start time', () => {
    expect(parseBookingPreorder(null)).toBeNull();
    expect(
      parseBookingPreorder({
        lines: [
          {
            id: 'PH0001',
            name: 'Post Chai',
            price: 2.5,
            qty: 2,
            lineTotal: 5,
          },
        ],
        total: 5,
      }),
    ).toEqual({
      lines: [
        {
          id: 'PH0001',
          name: 'Post Chai',
          price: 2.5,
          qty: 2,
          lineTotal: 5,
        },
      ],
      total: 5,
    });

    const grouped = groupBookingsByTime([
      { id: '2', start_time: '19:00:00' },
      { id: '1', start_time: '18:00:00' },
      { id: '3', start_time: '18:00:00' },
    ]);
    expect(grouped.map((entry) => entry.time)).toEqual(['18:00', '19:00']);
    expect(grouped[0]?.bookings).toHaveLength(2);
  });
});

describe('menu validation and diffing', () => {
  it('enforces server price and description limits', () => {
    expect(
      validateMenuEdit({ priceText: '0.49', description: 'Too cheap' }).ok,
    ).toBe(false);
    expect(
      validateMenuEdit({ priceText: '50.01', description: 'Too high' }).ok,
    ).toBe(false);
    expect(
      validateMenuEdit({ priceText: '4.5', description: 'x'.repeat(301) }).ok,
    ).toBe(false);
    expect(
      validateMenuEdit({ priceText: '4.50', description: '  House brew  ' }),
    ).toEqual({
      ok: true,
      price_usd: 4.5,
      description: 'House brew',
    });
  });

  it('returns null when nothing changed and only changed fields otherwise', () => {
    const original = {
      available: true,
      price_usd: '4.50',
      description: 'House brew',
    };
    expect(
      buildMenuPatch(original, {
        available: true,
        price_usd: 4.5,
        description: 'House brew ',
      }),
    ).toBeNull();
    expect(
      buildMenuPatch(original, {
        available: true,
        price_usd: 5,
        description: 'House brew',
      }),
    ).toEqual({ price_usd: 5 });
    expect(
      buildMenuPatch(original, {
        available: false,
      }),
    ).toEqual({ available: false });
  });

  it('extracts readable enquiry payload entries', () => {
    expect(
      formatEnquiryPayloadEntries({
        message: 'Looking for Friday evening.',
        party_size: 14,
        empty: '',
      }),
    ).toEqual([
      { label: 'Message', value: 'Looking for Friday evening.' },
      { label: 'Party size', value: '14' },
    ]);
  });
});
