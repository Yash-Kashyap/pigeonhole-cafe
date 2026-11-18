import { describe, expect, it } from 'vitest';
import {
  buildPrivateTableDateOptions,
  describeSundayPlan,
  formatOpenMicBlock,
  getPrivateTableTimeOptions,
  mapEnquiryResponse,
  parseGeneralContactChannel,
} from './gatherings';
import { nextFirstSaturday } from './rules';

// Wednesday 18 Nov 2026, 12:00 IST
const fixedNow = new Date('2026-11-18T06:30:00.000Z');

describe('gatherings and trek-stop helpers', () => {
  it('formats the open-mic date block cleanly in Asia/Kolkata', () => {
    const nextSat = nextFirstSaturday(fixedNow);
    const block = formatOpenMicBlock(nextSat);
    expect(block.iso).toBe('2026-12-05');
    expect(block.dayNumber).toBe('5');
    expect(block.monthYear).toBe('December 2026');
  });

  it('disables Mondays in private-table date options and enforces 24h notice for 8+', () => {
    const options = buildPrivateTableDateOptions(fixedNow);
    const monday = options.find((opt) => opt.date === '2026-11-23');
    expect(monday?.disabled).toBe(true);
    expect(monday?.label).toContain('Monday');

    const thursday = options.find((opt) => opt.date === '2026-11-19');
    expect(thursday?.disabled).toBe(false);

    // On Wednesday noon, 18:00 today is valid for party of 7 (<24h), refused for party of 8
    const timesParty7 = getPrivateTableTimeOptions('2026-11-18', 7, fixedNow);
    const timesParty8 = getPrivateTableTimeOptions('2026-11-18', 8, fixedNow);
    expect(timesParty7.length).toBeGreaterThan(0);
    expect(timesParty8).toEqual([]);

    // Thursday 13:00 is >=24h away so valid for party of 8
    const thursdayParty8 = getPrivateTableTimeOptions(
      '2026-11-19',
      8,
      fixedNow,
    );
    expect(thursdayParty8.some((t) => t.time === '13:00')).toBe(true);
    expect(thursdayParty8.some((t) => t.time === '11:30')).toBe(false);
  });

  it('describes Sunday opening plans accurately for trek season vs off-season', () => {
    expect(describeSundayPlan('2026-11-22')).toEqual({
      opensLabel: 'Opens 7:00 AM',
      closesLabel: 'Closes 11:00 PM',
      lastOrdersLabel: 'Last orders 10:30 PM',
      trekSeason: true,
      summary: 'Opens 7:00 AM. Closes 11:00 PM. Last orders 10:30 PM.',
    });
    expect(describeSundayPlan('2026-12-06')).toEqual({
      opensLabel: 'Opens 8:00 AM',
      closesLabel: 'Closes 11:00 PM',
      lastOrdersLabel: 'Last orders 10:30 PM',
      trekSeason: false,
      summary: 'Opens 8:00 AM. Closes 11:00 PM. Last orders 10:30 PM.',
    });
    expect(describeSundayPlan('2026-11-23')).toBeNull();
  });

  it('classifies general contact input into phone or email and rejects invalid entries', () => {
    expect(parseGeneralContactChannel('9876543210')).toEqual({
      ok: true,
      phone: '9876543210',
    });
    expect(parseGeneralContactChannel('+919876543210')).toEqual({
      ok: true,
      phone: '+919876543210',
    });
    expect(parseGeneralContactChannel('Guest@Example.com')).toEqual({
      ok: true,
      email: 'guest@example.com',
    });
    expect(parseGeneralContactChannel('')).toMatchObject({ ok: false });
    expect(parseGeneralContactChannel('12345')).toMatchObject({ ok: false });
    expect(parseGeneralContactChannel('bad@email')).toMatchObject({
      ok: false,
    });
  });

  it('maps enquiry API statuses without echoing unexpected server text', () => {
    expect(mapEnquiryResponse(201, { reference: 'ENQ-1A2B3C4D' })).toEqual({
      ok: true,
      reference: 'ENQ-1A2B3C4D',
    });
    expect(mapEnquiryResponse(429, { message: 'raw internal text' })).toEqual({
      ok: false,
      message: 'Too many enquiries. Please try again later.',
    });
    expect(mapEnquiryResponse(422, { message: 'raw' })).toEqual({
      ok: false,
      message: 'Choose another date or time that follows the booking rules.',
    });
    expect(mapEnquiryResponse(400, { message: 'raw stack' })).toEqual({
      ok: false,
      message: 'Check the details highlighted below and try again.',
    });
    expect(
      mapEnquiryResponse(400, {
        message: 'Please wait a moment, then try again.',
      }),
    ).toEqual({
      ok: false,
      message: 'Please wait a moment, then try again.',
    });
    expect(
      mapEnquiryResponse(500, { message: 'secret postgres error' }),
    ).toEqual({
      ok: false,
      message:
        'Enquiry service is unavailable right now. Please try again later.',
    });
  });
});
