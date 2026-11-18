import { describe, expect, it } from 'vitest';
import type { MenuItem } from './menu';
import {
  addPreorderItem,
  buildBookingCalendarIcs,
  buildBookingWhatsAppPath,
  buildBookingWhatsAppText,
  buildReserveCalendar,
  computePreorderSummary,
  escapeIcsText,
  formatClockTime24,
  formatIsoClockTimeIst,
  formatLiveSummary,
  formatReserveDate,
  formatReserveDateLong,
  formatSlotLabel,
  getPartyHelperLines,
  isValidIndianPhoneInput,
  parseReserveHash,
  sanitizeReserveDraft,
  serializeReserveHash,
  toApiPreorder,
  updatePreorderQty,
  type PreorderLineInput,
} from './reserve';

const sampleMenu: MenuItem[] = [
  {
    id: 'PH0003',
    category: 'Chai & Tea',
    subcategory: 'Chai',
    name: 'Post Chai',
    description: 'Smoked cardamom and jaggery chai',
    price_usd: 1.4,
    diet: 'vegetarian',
    vegan: false,
    jain_option: true,
    gluten_free: true,
    allergens: ['dairy'],
    spice_level: 1,
    prep_minutes: 5,
    tags: ['signature'],
    available: true,
    sourceIndex: 1,
  },
  {
    id: 'PH0060',
    category: 'Breakfast',
    subcategory: 'Buns',
    name: 'Maska Pav',
    description: 'Soft toasted bun with salted butter',
    price_usd: 1.4,
    diet: 'vegetarian',
    vegan: false,
    jain_option: true,
    gluten_free: false,
    allergens: ['dairy', 'gluten'],
    spice_level: 0,
    prep_minutes: 4,
    tags: ['signature'],
    available: true,
    sourceIndex: 2,
  },
  {
    id: 'PH0200',
    category: 'Desserts',
    subcategory: 'Sweets',
    name: 'Sold Out Cake',
    description: 'Not available today',
    price_usd: 3.25,
    diet: 'vegetarian',
    vegan: false,
    jain_option: false,
    gluten_free: false,
    allergens: ['dairy', 'gluten'],
    spice_level: 0,
    prep_minutes: 10,
    tags: [],
    available: false,
    sourceIndex: 3,
  },
];

describe('hash state parse and serialise', () => {
  it('round-trips valid step, date, time and party', () => {
    const hash = serializeReserveHash({
      step: 2,
      date: '2026-11-21',
      time: '19:30',
      partySize: 4,
    });
    expect(hash).toBe('#step=2&date=2026-11-21&time=19%3A30&party=4');
    expect(parseReserveHash(hash)).toEqual({
      step: 2,
      date: '2026-11-21',
      time: '19:30',
      partySize: 4,
    });
  });

  it('ignores malformed or out-of-range hash parameters', () => {
    expect(
      parseReserveHash('#step=9&date=2026-02-31&time=25:99&party=15'),
    ).toEqual({});
    expect(parseReserveHash('')).toEqual({});
    expect(parseReserveHash('#step=3&party=7')).toEqual({
      step: 3,
      partySize: 7,
    });
  });

  it('sanitises stored draft values and enforces bounds', () => {
    const draft = sanitizeReserveDraft({
      step: 2,
      date: '2026-11-21',
      time: '18:00',
      partySize: 6,
      name: 'Ira',
      phone: '+919876543210',
      email: 'ira@example.com',
      occasion: 'birthday',
      notes: 'a'.repeat(250),
      preorder: [
        { id: 'PH0003', qty: 2 },
        { id: 'PH0003', qty: 25 },
        { id: 'BAD', qty: 1 },
      ],
    });
    expect(draft.notes).toHaveLength(200);
    expect(draft.preorder).toEqual([{ id: 'PH0003', qty: 20 }]);
  });
});

describe('date, time and summary labels', () => {
  it('formats 24-hour times in 12-hour IST labels without conversion', () => {
    expect(formatClockTime24('07:00')).toBe('7:00 AM');
    expect(formatClockTime24('12:00')).toBe('12:00 PM');
    expect(formatClockTime24('19:30')).toBe('7:30 PM');
    expect(formatClockTime24('00:00')).toBe('12:00 AM');
  });

  it('formats holdUntil ISO timestamps in Asia/Kolkata', () => {
    // 19:45 IST is 14:15 UTC
    expect(formatIsoClockTimeIst('2026-11-14T14:15:00.000Z')).toBe('7:45 PM');
    expect(formatIsoClockTimeIst('not-a-date')).toBe('');
  });

  it('formats dates and live summary lines cleanly', () => {
    expect(formatReserveDate('2026-11-14')).toBe('Saturday 14 Nov');
    expect(formatReserveDateLong('2026-11-14')).toBe('Saturday, 14 Nov 2026');
    expect(formatLiveSummary('2026-11-14', '19:30', 4)).toBe(
      'Saturday 14 Nov, 7:30 PM, 4 people',
    );
    expect(formatLiveSummary('2026-11-14', '19:30', 1)).toBe(
      'Saturday 14 Nov, 7:30 PM, 1 person',
    );
    expect(formatLiveSummary('2026-11-14', '', 4)).toBe(
      'Saturday 14 Nov, choose a time, 4 people',
    );
  });

  it('formats single and joined slot labels', () => {
    expect(formatSlotLabel(['SLOT 09'], 'confirmed')).toBe('SLOT 09');
    expect(formatSlotLabel(['SLOT 09', 'SLOT 10'], 'confirmed')).toBe(
      'SLOT 09 + SLOT 10',
    );
    expect(formatSlotLabel([], 'requested')).toBe('PENDING');
  });

  it('returns the right party helper text for 1-6, 7 and 8-12', () => {
    expect(getPartyHelperLines(4)).toEqual(['Slots seat 2, 4 or 6.']);
    expect(getPartyHelperLines(7)).toEqual([
      'Groups of 7 or more are confirmed by the team.',
    ]);
    expect(getPartyHelperLines(8)).toEqual([
      'Groups of 7 or more are confirmed by the team.',
      "Groups of 8 or more need 24 hours' notice.",
    ]);
  });

  it('builds a calendar grid that disables past dates and Mondays with reasons', () => {
    // Wednesday 18 Nov 2026 09:30 IST = 04:00 UTC
    const now = new Date('2026-11-18T04:00:00.000Z');
    const cal = buildReserveCalendar(now);
    const flat = cal.weeks.flat();

    const pastMonday = flat.find((d) => d.date === '2026-11-16');
    expect(pastMonday?.bookable).toBe(false);
    expect(pastMonday?.disabledReason).toBe('Past date.');

    const nextMonday = flat.find((d) => d.date === '2026-11-23');
    expect(nextMonday?.bookable).toBe(false);
    expect(nextMonday?.isMonday).toBe(true);
    expect(nextMonday?.disabledReason).toBe('Closed on Mondays.');

    const today = flat.find((d) => d.date === '2026-11-18');
    expect(today?.bookable).toBe(true);
    expect(cal.firstSelectableDate).toBe('2026-11-18');
  });

  it('disables today on the calendar after the 2-hour same-day cut-off', () => {
    // Wednesday 18 Nov 2026 20:00 IST = 14:30 UTC (last slot 20:30 is < 2h away)
    const lateNow = new Date('2026-11-18T14:30:00.000Z');
    const cal = buildReserveCalendar(lateNow);
    const today = cal.weeks.flat().find((d) => d.date === '2026-11-18');
    expect(today?.bookable).toBe(false);
    expect(today?.disabledReason).toContain('2 hours');
    expect(cal.firstSelectableDate).toBe('2026-11-19');
  });
});

describe('pre-order helpers', () => {
  it('blocks unavailable items, caps lines at 12 and qty at 20', () => {
    let lines: PreorderLineInput[] = [];
    lines = addPreorderItem(lines, sampleMenu[2]!);
    expect(lines).toEqual([]);

    lines = addPreorderItem(lines, sampleMenu[0]!);
    lines = addPreorderItem(lines, sampleMenu[0]!);
    expect(lines).toEqual([{ id: 'PH0003', qty: 2 }]);

    lines = updatePreorderQty(lines, 'PH0003', 25);
    expect(lines).toEqual([{ id: 'PH0003', qty: 20 }]);

    lines = updatePreorderQty(lines, 'PH0003', 0);
    expect(lines).toEqual([]);

    // Fill 12 distinct lines
    for (let i = 1; i <= 13; i += 1) {
      const id = `PH${String(i).padStart(4, '0')}`;
      lines = addPreorderItem(lines, { id, available: true });
    }
    expect(lines).toHaveLength(12);
    expect(lines.some((l) => l.id === 'PH0013')).toBe(false);
  });

  it('computes display totals and strips API payload to { id, qty } only', () => {
    const lines: PreorderLineInput[] = [
      { id: 'PH0003', qty: 2 },
      { id: 'PH0060', qty: 1 },
    ];
    const summary = computePreorderSummary(lines, sampleMenu);
    expect(summary.itemCount).toBe(3);
    expect(summary.total).toBe(4.2);
    expect(summary.lines[0]?.lineTotal).toBe(2.8);

    const payload = toApiPreorder(lines);
    expect(payload).toEqual([
      { id: 'PH0003', qty: 2 },
      { id: 'PH0060', qty: 1 },
    ]);
    expect(Object.keys(payload[0]!).sort()).toEqual(['id', 'qty']);
  });
});

describe('phone validation, .ics builder and WhatsApp helpers', () => {
  it('accepts Indian 10-digit or +91 numbers without spaces', () => {
    expect(isValidIndianPhoneInput('9876543210')).toBe(true);
    expect(isValidIndianPhoneInput('+919876543210')).toBe(true);
    expect(isValidIndianPhoneInput('919876543210')).toBe(true);
    expect(isValidIndianPhoneInput('98765 43210')).toBe(false);
    expect(isValidIndianPhoneInput('12345')).toBe(false);
  });

  it('escapes RFC 5545 special characters properly', () => {
    expect(escapeIcsText('Slot 09, tea; steam\\heat\nLine 2')).toBe(
      'Slot 09\\, tea\\; steam\\\\heat\\nLine 2',
    );
  });

  it('builds a 90-minute Asia/Kolkata .ics event', () => {
    const fixedNow = new Date('2026-11-18T05:00:00.000Z');
    const ics = buildBookingCalendarIcs(
      {
        code: 'PH-BK-0042',
        date: '2026-11-21',
        time: '19:30',
        party: 4,
        slotLabels: ['SLOT 09', 'SLOT 10'],
        status: 'confirmed',
      },
      fixedNow,
    );
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('TZID:Asia/Kolkata\r\n');
    expect(ics).toContain('DTSTART;TZID=Asia/Kolkata:20261121T193000\r\n');
    expect(ics).toContain('DTEND;TZID=Asia/Kolkata:20261121T210000\r\n');
    expect(ics).toContain('UID:PH-BK-0042@pigeonhole-cafe.demo\r\n');
    expect(ics).toContain('SLOT 09 + SLOT 10');
    expect(ics).toContain(
      'LOCATION:Old Sorting Room\\, Post Office Lane\\, Kothi Bagh\\, Himachal Pradesh\r\n',
    );
    expect(ics).toContain('Booking code: PH-BK-0042\\nParty size: 4');
    expect(ics).toContain('END:VCALENDAR\r\n');
  });

  it('builds a WhatsApp redirect path without printing any phone number', () => {
    const booking = {
      code: 'PH-BK-0042',
      date: '2026-11-21',
      time: '19:30',
      party: 4,
      slotLabels: ['SLOT 09'],
      status: 'confirmed',
    };
    const text = buildBookingWhatsAppText(booking);
    expect(text).toContain('PH-BK-0042');
    expect(text).toContain('SLOT 09');
    expect(text).not.toMatch(/\+?91\d{10}/);

    const path = buildBookingWhatsAppPath(booking);
    expect(path.startsWith('/whatsapp?text=')).toBe(true);
    expect(path).not.toContain('wa.me');
  });
});
