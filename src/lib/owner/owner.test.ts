import { describe, expect, it } from 'vitest';
import { ownerDatabaseErrorCode, ownerErrorResponse } from './errors';
import {
  ownerBookingCreateSchema,
  ownerBookingPatchSchema,
  ownerBookingsQuerySchema,
  ownerEnquiriesQuerySchema,
  ownerEnquiryPatchSchema,
  ownerLoginSchema,
  ownerLogoutSchema,
  ownerMenuPatchSchema,
  ownerMenuQuerySchema,
  ownerOrderPatchSchema,
  ownerOrdersQuerySchema,
} from './schemas';
import {
  accessTokenExpiresAt,
  buildOwnerCookieOptions,
  isOwnerSessionActive,
  ownerSessionExpiry,
  parseCookieHeader,
  shouldRefreshAccessToken,
  signOwnerExpiry,
  verifyOwnerExpiry,
} from './session';
import { isLegalBookingAction, isLegalOrderTransition } from './rules';
import { buildBookingTimeline } from './timeline';

const now = new Date('2026-11-18T12:00:00.000Z');
const secret = 'test-session-signing-key-longer-than-24-characters';
const jwt = (exp: number) => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ exp })}.signature`;
};

describe('owner request schemas', () => {
  it('accepts only the login keys', () => {
    expect(
      ownerLoginSchema.safeParse({
        email: 'owner@example.com',
        password: 'secret',
      }).success,
    ).toBe(true);
    expect(
      ownerLoginSchema.safeParse({
        email: 'owner@example.com',
        password: 'secret',
        role: 'owner',
      }).success,
    ).toBe(false);
    expect(ownerLogoutSchema.safeParse({}).success).toBe(true);
    expect(ownerLogoutSchema.safeParse({ allUsers: true }).success).toBe(false);
  });

  it('validates order queries and cancellation reasons strictly', () => {
    expect(
      ownerOrdersQuerySchema.parse({ date: '2026-11-18', page: '2' }),
    ).toEqual({ date: '2026-11-18', page: 2 });
    expect(
      ownerOrdersQuerySchema.safeParse({ date: '2026-02-30' }).success,
    ).toBe(false);
    expect(
      ownerOrderPatchSchema.safeParse({ status: 'cancelled' }).success,
    ).toBe(false);
    expect(
      ownerOrderPatchSchema.safeParse({
        status: 'cancelled',
        cancel_reason: 'free text',
      }).success,
    ).toBe(false);
  });

  it('validates every booking request shape', () => {
    expect(
      ownerBookingsQuerySchema.safeParse({ date: '2026-11-18' }).success,
    ).toBe(true);
    expect(
      ownerBookingPatchSchema.safeParse({
        action: 'confirm',
        slotIds: ['S1', 'S16'],
      }).success,
    ).toBe(true);
    expect(
      ownerBookingPatchSchema.safeParse({
        action: 'confirm',
        slotIds: ['S17'],
      }).success,
    ).toBe(false);
    expect(
      ownerBookingCreateSchema.safeParse({
        name: 'Phone Guest',
        phone: '9876543210',
        date: '2026-11-20',
        time: '12:00',
        partySize: 4,
        preorder: [{ id: 'PH0003', qty: 1 }],
      }).success,
    ).toBe(true);
    expect(
      ownerBookingCreateSchema.safeParse({
        name: 'Phone Guest',
        phone: '9876543210',
        date: '2026-11-20',
        time: '12:00',
        partySize: 4,
        status: 'confirmed',
      }).success,
    ).toBe(false);
  });

  it('validates enquiry and menu requests', () => {
    expect(ownerEnquiriesQuerySchema.parse({})).toEqual({ page: 1 });
    expect(ownerEnquiryPatchSchema.safeParse({ status: 'done' }).success).toBe(
      true,
    );
    expect(ownerMenuQuerySchema.safeParse({ search: 'chai' }).success).toBe(
      true,
    );
    expect(ownerMenuPatchSchema.safeParse({}).success).toBe(false);
    expect(ownerMenuPatchSchema.safeParse({ price_usd: 0.49 }).success).toBe(
      false,
    );
    expect(
      ownerMenuPatchSchema.safeParse({ description: 'x'.repeat(301) }).success,
    ).toBe(false);
  });
});

describe('owner transition mirrors', () => {
  it('allows only adjacent order progress and cancellation before completion', () => {
    expect(isLegalOrderTransition('new', 'preparing')).toBe(true);
    expect(isLegalOrderTransition('preparing', 'ready')).toBe(true);
    expect(isLegalOrderTransition('ready', 'collected')).toBe(true);
    expect(isLegalOrderTransition('new', 'ready')).toBe(false);
    expect(isLegalOrderTransition('collected', 'new')).toBe(false);
    expect(isLegalOrderTransition('cancelled', 'preparing')).toBe(false);
  });

  it('mirrors booking action status rules', () => {
    expect(isLegalBookingAction('requested', 'confirm')).toBe(true);
    expect(isLegalBookingAction('requested', 'seated')).toBe(false);
    expect(isLegalBookingAction('confirmed', 'no_show')).toBe(true);
    expect(isLegalBookingAction('declined', 'cancel')).toBe(false);
  });
});

describe('owner timeline builder', () => {
  it('builds half-hour columns and three-column booking blocks', () => {
    const result = buildBookingTimeline(
      [
        { id: 'S1', label: 'SLOT 01', seats: 2 },
        { id: 'S2', label: 'SLOT 02', seats: 2 },
      ],
      [
        {
          id: 'booking-1',
          code: 'PH-BK-1001',
          start_time: '08:30:00',
          party_size: 2,
          status: 'confirmed',
          slot_ids: ['S1'],
        },
      ],
      8 * 60,
      10 * 60,
    );
    expect(result.columns).toEqual([
      '08:00',
      '08:30',
      '09:00',
      '09:30',
      '10:00',
    ]);
    expect(result.rows[0]?.blocks[0]).toMatchObject({
      startColumn: 1,
      columnSpan: 3,
      code: 'PH-BK-1001',
    });
    expect(result.rows[1]?.blocks).toEqual([]);
  });
});

describe('owner cookie and expiry helpers', () => {
  it('builds strict secure cookies except on local HTTP development', () => {
    const expiry = ownerSessionExpiry(now);
    const production = buildOwnerCookieOptions(
      new URL('https://example.com'),
      expiry,
    );
    const local = buildOwnerCookieOptions(
      new URL('http://127.0.0.1:4321'),
      expiry,
    );
    expect(production).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    expect(local.secure).toBe(false);
    expect(isOwnerSessionActive(expiry, now)).toBe(true);
  });

  it('parses cookies without accepting duplicate overrides', () => {
    expect(parseCookieHeader('a=one; ph_owner_at=token; a=two')).toEqual(
      new Map([
        ['a', 'one'],
        ['ph_owner_at', 'token'],
      ]),
    );
  });

  it('signs, verifies, rejects tampering, and expires at eight hours', async () => {
    const expiry = ownerSessionExpiry(now);
    const signed = await signOwnerExpiry(expiry, secret);
    expect(await verifyOwnerExpiry(signed, secret, now)).toBe(expiry);
    expect(
      await verifyOwnerExpiry(
        `${expiry + 1}.${signed.split('.')[1]}`,
        secret,
        now,
      ),
    ).toBeNull();
    expect(
      await verifyOwnerExpiry(
        signed,
        secret,
        new Date(now.getTime() + 8 * 60 * 60 * 1000),
      ),
    ).toBeNull();
  });

  it('reads access expiry and refreshes only near expiry', () => {
    const current = Math.floor(now.getTime() / 1000);
    expect(accessTokenExpiresAt(jwt(current + 600))).toBe(current + 600);
    expect(shouldRefreshAccessToken(jwt(current + 600), now)).toBe(false);
    expect(shouldRefreshAccessToken(jwt(current + 120), now)).toBe(true);
    expect(shouldRefreshAccessToken('broken', now)).toBe(true);
  });
});

describe('owner database error mapping', () => {
  it('maps stable codes without exposing database text', () => {
    expect(ownerDatabaseErrorCode(new Error('bad_transition'))).toBe(
      'bad_transition',
    );
    expect(ownerErrorResponse(new Error('slot_taken detail'))).toEqual({
      status: 409,
      message: 'One or more slots were just taken.',
    });
    expect(ownerErrorResponse(new Error('internal database address'))).toEqual({
      status: 500,
      message: 'The owner service is unavailable.',
    });
  });
});
