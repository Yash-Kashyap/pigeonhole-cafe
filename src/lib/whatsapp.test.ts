import { describe, expect, it } from 'vitest';
import {
  buildWhatsAppUrl,
  buildOrderCalendarIcs,
  buildOrderWhatsAppText,
  cleanWhatsAppMessage,
  normaliseWhatsAppNumber,
  whatsAppRedirectPath,
} from './whatsapp';

describe('whatsapp helpers', () => {
  it('keeps digits only and rejects numbers that cannot be real', () => {
    expect(normaliseWhatsAppNumber('+91 99999 12345')).toBe('919999912345');
    expect(normaliseWhatsAppNumber('919999912345')).toBe('919999912345');
    expect(normaliseWhatsAppNumber('12345')).toBeNull();
    expect(normaliseWhatsAppNumber('')).toBeNull();
    expect(normaliseWhatsAppNumber(undefined)).toBeNull();
  });
  it('builds a wa.me address with an encoded message', () => {
    expect(buildWhatsAppUrl('911234567890')).toBe('https://wa.me/911234567890');
    expect(
      buildWhatsAppUrl('911234567890', 'Order PH-ORD-0001: 2 x Post Chai'),
    ).toBe(
      'https://wa.me/911234567890?text=Order%20PH-ORD-0001%3A%202%20x%20Post%20Chai',
    );
  });
  it('strips control characters and caps long messages', () => {
    expect(cleanWhatsAppMessage('  hi\u0000 there\u0007 ')).toBe('hi there');
    expect(cleanWhatsAppMessage('x'.repeat(5000))).toHaveLength(1000);
    expect(cleanWhatsAppMessage(null)).toBe('');
  });
  it('links to our own redirect, never to the number', () => {
    expect(whatsAppRedirectPath()).toBe('/whatsapp');
    expect(whatsAppRedirectPath('Hello there')).toBe(
      '/whatsapp?text=Hello%20there',
    );
    expect(whatsAppRedirectPath('Hello')).not.toMatch(/\d{10}/);
  });
});

describe('order confirmation helpers', () => {
  it('builds an encoded order summary without a phone number', () => {
    const text = buildOrderWhatsAppText({
      code: 'PH-ORD-1000',
      firstName: 'Ira',
      pickupAt: '17 Nov, 10:45 AM',
      items: [{ name: 'Post Chai', qty: 2 }],
    });
    expect(text).toContain('PH-ORD-1000');
    expect(text).toContain('2 × Post Chai');
    expect(text).not.toMatch(/\+?91\d{10}/);
    expect(whatsAppRedirectPath(text)).not.toContain('wa.me');
  });
  it('writes a thirty-minute UTC calendar event from an IST pickup instant', () => {
    const ics = buildOrderCalendarIcs({
      code: 'PH-ORD-1000',
      pickupAt: '2026-11-17T13:30:00.000Z',
    });
    expect(ics).toContain('DTSTART:20261117T133000Z');
    expect(ics).toContain('DTEND:20261117T140000Z');
  });
});
