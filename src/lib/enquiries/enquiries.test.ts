import { describe, expect, it, vi } from 'vitest';
import {
  enquiryReference,
  enquiryRequestSchema,
  placeEnquiry,
  type EnquiryDependencies,
} from './enquiries';

const now = new Date('2026-11-17T04:30:00.000Z');
const id = '12345678-1234-4000-8000-123456789abc';
const deps = (
  overrides: Partial<EnquiryDependencies> = {},
): EnquiryDependencies => ({
  salt: 'a-safe-test-salt-with-more-than-24-characters',
  hash: async (value) => `hash:${value.length}`,
  now: () => now,
  hitRateLimit: async () => true,
  createEnquiry: async () => id,
  readEnquiry: async () => ({ id }),
  ...overrides,
});
const botFields = { honeypot: '', mountedAt: now.getTime() - 4_000 };
const openMic = {
  kind: 'open_mic' as const,
  name: 'ZZ TEST Performer',
  phone: '9876543210',
  performanceType: 'Poetry' as const,
  notes: 'Two short poems',
  consent: true as const,
  ...botFields,
};
const privateTable = {
  kind: 'private_table' as const,
  name: 'ZZ TEST Group',
  phone: '9876543211',
  date: '2026-11-18',
  time: '12:00',
  partySize: 8,
  occasion: 'Birthday' as const,
  notes: 'Near a plug point',
  ...botFields,
};
const general = {
  kind: 'general' as const,
  name: 'ZZ TEST Visitor',
  email: 'Guest@Example.com',
  message: 'Please confirm the accessibility details.',
  ...botFields,
};

describe('enquiry schemas', () => {
  it('accepts all three exact request shapes', () => {
    expect(enquiryRequestSchema.safeParse(openMic).success).toBe(true);
    expect(enquiryRequestSchema.safeParse(privateTable).success).toBe(true);
    expect(enquiryRequestSchema.safeParse(general).success).toBe(true);
  });

  it('rejects unknown keys and cross-kind fields', () => {
    expect(
      enquiryRequestSchema.safeParse({ ...openMic, status: 'done' }).success,
    ).toBe(false);
    expect(
      enquiryRequestSchema.safeParse({ ...general, performanceType: 'Music' })
        .success,
    ).toBe(false);
  });

  it('requires open-mic consent and one general contact method', () => {
    expect(
      enquiryRequestSchema.safeParse({ ...openMic, consent: false }).success,
    ).toBe(false);
    expect(
      enquiryRequestSchema.safeParse({
        ...general,
        email: undefined,
        phone: undefined,
      }).success,
    ).toBe(false);
  });

  it('rejects invalid enums, lengths and control characters', () => {
    expect(
      enquiryRequestSchema.safeParse({
        ...openMic,
        performanceType: 'Dance',
      }).success,
    ).toBe(false);
    expect(
      enquiryRequestSchema.safeParse({ ...privateTable, partySize: 6 }).success,
    ).toBe(false);
    expect(
      enquiryRequestSchema.safeParse({ ...openMic, notes: 'x'.repeat(201) })
        .success,
    ).toBe(false);
    expect(
      enquiryRequestSchema.safeParse({ ...general, message: 'Bad\nmessage' })
        .success,
    ).toBe(false);
  });
});

describe('placeEnquiry', () => {
  it('stores only normalized common columns and kind payload', async () => {
    const createEnquiry = vi.fn(async () => id);
    const result = await placeEnquiry(
      { ...openMic, name: '  <b>ZZ TEST Performer</b>  ' },
      '203.0.113.4',
      deps({ createEnquiry }),
    );
    expect(result).toEqual({
      status: 201,
      body: { reference: 'ENQ-12345678' },
    });
    expect(createEnquiry).toHaveBeenCalledWith({
      kind: 'open_mic',
      name: 'ZZ TEST Performer',
      phone: '+919876543210',
      email: null,
      payload: { performanceType: 'Poetry', notes: 'Two short poems' },
    });
  });

  it('normalizes a general email without echoing contact details', async () => {
    const createEnquiry = vi.fn(async () => id);
    const result = await placeEnquiry(general, 'ip', deps({ createEnquiry }));
    expect(createEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: null,
        email: 'guest@example.com',
        payload: { message: 'Please confirm the accessibility details.' },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('guest@example.com');
  });

  it('reuses booking rules for private-table enquiries', async () => {
    expect(
      (
        await placeEnquiry(
          { ...privateTable, date: '2026-11-23' },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await placeEnquiry(
          { ...privateTable, date: '2026-11-17', time: '11:30' },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await placeEnquiry(
          { ...privateTable, date: '2026-11-18', time: '04:00' },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(422);
  });

  it('rejects bad phones, bots and invalid timing', async () => {
    expect(
      (await placeEnquiry({ ...openMic, phone: 'bad' }, 'ip', deps())).status,
    ).toBe(400);
    expect(
      (await placeEnquiry({ ...openMic, honeypot: 'bot' }, 'ip', deps()))
        .status,
    ).toBe(400);
    expect(
      (
        await placeEnquiry(
          { ...openMic, mountedAt: now.getTime() - 500 },
          'ip',
          deps(),
        )
      ).status,
    ).toBe(400);
  });

  it('enforces IP and phone limits before creating a row', async () => {
    const createEnquiry = vi.fn(async () => id);
    expect(
      (
        await placeEnquiry(
          openMic,
          'ip',
          deps({ hitRateLimit: async () => false, createEnquiry }),
        )
      ).status,
    ).toBe(429);
    expect(createEnquiry).not.toHaveBeenCalled();

    let calls = 0;
    expect(
      (
        await placeEnquiry(
          openMic,
          'ip',
          deps({
            hitRateLimit: async () => {
              calls += 1;
              return calls === 1;
            },
            createEnquiry,
          }),
        )
      ).status,
    ).toBe(429);
    expect(createEnquiry).not.toHaveBeenCalled();
  });

  it('returns 500 when the saved row cannot be read back', async () => {
    expect(
      (
        await placeEnquiry(
          openMic,
          'ip',
          deps({ readEnquiry: async () => null }),
        )
      ).status,
    ).toBe(500);
  });
});

describe('enquiryReference', () => {
  it('returns a short non-UUID reference', () => {
    expect(enquiryReference(id)).toBe('ENQ-12345678');
    expect(enquiryReference(id)).not.toContain('-1234-');
  });
});
