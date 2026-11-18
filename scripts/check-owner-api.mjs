// Live owner security and mutation checks. Requires the dev server and migration 0005.
// It creates only ZZ TEST rows and temporary users, then removes them and its rate-limit rows.
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4321';
const service = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-owner-check/1.0' } },
  },
);
const publicClient = createClient(
  process.env.PUBLIC_SUPABASE_URL,
  process.env.PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const credentials = readFileSync('.demo-credentials', 'utf8');
const ownerEmail = /^Email: (.+)$/m.exec(credentials)?.[1];
const ownerPassword = /^Password: (.+)$/m.exec(credentials)?.[1];
if (!ownerEmail || !ownerPassword)
  throw new Error('Run the demo seed before this suite.');

let failures = 0;
const createdUsers = new Set();
const createdOrders = new Set();
const createdBookings = new Set();
const createdEnquiries = new Set();
const rateKeys = new Set();
const responses = [];
const startedAt = new Date().toISOString();
let restoreMenu = null;

const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const signExpiry = async (expiresAt) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.RATE_LIMIT_SALT),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(String(expiresAt)),
    ),
  );
  return `${expiresAt}.${Buffer.from(signed).toString('base64url')}`;
};
const sessionCookie = async (session, accessToken = session.access_token) => {
  const expiresAt = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  return [
    `ph_owner_at=${accessToken}`,
    `ph_owner_rt=${session.refresh_token}`,
    `ph_owner_exp=${await signExpiry(expiresAt)}`,
  ].join('; ');
};
const tokenPassword = () =>
  `${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')}Aa1!`;

class CookieJar {
  values = new Map();
  update(headers) {
    const setCookies = headers.getSetCookie?.() ?? [];
    for (const line of setCookies) {
      const [pair = '', ...attributes] = line.split(';');
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const deleted = attributes.some(
        (part) =>
          /max-age=0/i.test(part) ||
          (/expires=/i.test(part) &&
            Date.parse(part.slice(part.indexOf('=') + 1)) < Date.now()),
      );
      if (deleted || !value) this.values.delete(name);
      else this.values.set(name, value);
    }
  }
  header() {
    return [...this.values]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

async function capture(response, path, allowAccessBody = false) {
  const text = await response.text();
  responses.push({
    path,
    text,
    headers: [...response.headers]
      .map(([name, value]) => `${name}: ${value}`)
      .join('\n'),
    allowAccessBody,
  });
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Assertions report non-JSON responses where JSON is required.
  }
  return { response, status: response.status, text, json };
}

async function request(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  return capture(response, path, path === '/api/owner/realtime-token');
}

async function write(path, method, body, cookie, options = {}) {
  const headers = {
    Origin: base,
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };
  if (cookie) headers.Cookie = cookie;
  if (options.origin === null) delete headers.Origin;
  return request(path, {
    method,
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

async function rememberLoginKeys(ip, email) {
  rateKeys.add(
    await hash(`${process.env.RATE_LIMIT_SALT}:owner-login-ip:${ip}`),
  );
  rateKeys.add(
    await hash(
      `${process.env.RATE_LIMIT_SALT}:owner-login-email:${email.trim().toLowerCase()}`,
    ),
  );
}

async function login(email, password, ip) {
  await rememberLoginKeys(ip, email);
  const jar = new CookieJar();
  const result = await write(
    '/api/owner/login',
    'POST',
    { email, password },
    null,
    { headers: { 'x-ph-test-ip': ip } },
  );
  jar.update(result.response.headers);
  return { ...result, jar };
}

async function createTestUser(email, metadata = {}) {
  const password = tokenPassword();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error || !data.user) throw error ?? new Error('Temporary user failed.');
  createdUsers.add(data.user.id);
  const signedIn = await publicClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signedIn.error || !signedIn.data.session)
    throw signedIn.error ?? new Error('Temporary sign-in failed.');
  return { user: data.user, password, session: signedIn.data.session };
}

const protectedRoutes = [
  '/api/owner/me',
  '/api/owner/realtime-token',
  '/api/owner/orders',
  '/api/owner/bookings?date=2026-11-18',
  '/api/owner/enquiries',
  '/api/owner/menu',
  '/api/owner/today',
  '/api/owner/orders/00000000-0000-4000-8000-000000000001',
  '/api/owner/bookings/00000000-0000-4000-8000-000000000001',
  '/api/owner/enquiries/00000000-0000-4000-8000-000000000001',
  '/api/owner/menu/PH0003',
  '/api/owner/logout',
];

try {
  for (const path of protectedRoutes) {
    const result = await request(path);
    ok(
      `no cookie gets 401 on ${path}`,
      result.status === 401,
      `${result.status}`,
    );
  }
  const pageRedirect = await request('/owner/app', { redirect: 'manual' });
  ok(
    'no cookie redirects the guarded page to login',
    pageRedirect.status === 302 &&
      pageRedirect.response.headers.get('location') === '/owner',
    `${pageRedirect.status}`,
  );

  const suffix = Date.now();
  const nonOwner = await createTestUser(
    `zz-test-non-owner-${suffix}@example.com`,
  );
  const metadataOwner = await createTestUser(
    `zz-test-metadata-owner-${suffix}@example.com`,
    { role: 'owner' },
  );
  const nonOwnerCookie = await sessionCookie(nonOwner.session);
  const metadataCookie = await sessionCookie(metadataOwner.session);
  for (const [label, cookie] of [
    ['normal signed-in user', nonOwnerCookie],
    ['user_metadata owner impostor', metadataCookie],
  ]) {
    for (const path of protectedRoutes) {
      const result = await request(path, { cookie });
      ok(
        `${label} gets 403 on ${path}`,
        result.status === 403,
        `${result.status}`,
      );
    }
  }

  const validExpiry = await signExpiry(Math.floor(Date.now() / 1000) + 3600);
  const malformedCookies = [
    [
      'forged',
      `ph_owner_at=a.b.c; ph_owner_rt=fake; ph_owner_exp=${validExpiry}`,
    ],
    [
      'tampered',
      await sessionCookie(
        nonOwner.session,
        `${nonOwner.session.access_token.slice(0, -1)}x`,
      ),
    ],
    [
      'expired',
      `ph_owner_at=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.invalid; ph_owner_rt=fake; ph_owner_exp=${validExpiry}`,
    ],
    [
      'truncated',
      `ph_owner_at=eyJ; ph_owner_rt=fake; ph_owner_exp=${validExpiry}`,
    ],
  ];
  for (const [label, cookie] of malformedCookies) {
    const result = await request('/api/owner/me', { cookie });
    ok(`${label} token gets 401`, result.status === 401, `${result.status}`);
  }

  const unknownError = await login(
    `zz-test-unknown-${suffix}@example.com`,
    'WrongPassword1!',
    '198.51.100.10',
  );
  const wrongError = await login(
    ownerEmail,
    `${ownerPassword}wrong`,
    '198.51.100.11',
  );
  const nonOwnerError = await login(
    nonOwner.user.email,
    nonOwner.password,
    '198.51.100.12',
  );
  ok(
    'unknown, wrong-password and non-owner login errors are identical',
    [unknownError, wrongError, nonOwnerError].every(
      (result) =>
        result.status === 401 &&
        result.text === unknownError.text &&
        result.jar.header() === '',
    ),
    `${unknownError.status}/${wrongError.status}/${nonOwnerError.status}`,
  );

  const floodIp = '198.51.100.20';
  const ipFlood = [];
  for (let index = 0; index < 6; index += 1)
    ipFlood.push(
      await login(
        `zz-test-ip-${suffix}-${index}@example.com`,
        'WrongPassword1!',
        floodIp,
      ),
    );
  ok(
    'login IP limit allows five attempts and rejects the sixth',
    ipFlood.slice(0, 5).every((result) => result.status === 401) &&
      ipFlood[5]?.status === 429,
    ipFlood.map((result) => result.status).join(','),
  );

  const oneEmail = `zz-test-email-${suffix}@example.com`;
  const emailFlood = [];
  for (let index = 0; index < 6; index += 1)
    emailFlood.push(
      await login(oneEmail, 'WrongPassword1!', `198.51.101.${index + 1}`),
    );
  ok(
    'login email limit applies across different IPs',
    emailFlood.slice(0, 5).every((result) => result.status === 401) &&
      emailFlood[5]?.status === 429,
    emailFlood.map((result) => result.status).join(','),
  );

  const ownerLogin = await login(ownerEmail, ownerPassword, '198.51.100.30');
  const ownerCookie = ownerLogin.jar.header();
  const setCookies = ownerLogin.response.headers.getSetCookie?.() ?? [];
  ok(
    'valid owner login sets three scoped strict HttpOnly cookies',
    ownerLogin.status === 200 &&
      ['ph_owner_at', 'ph_owner_rt', 'ph_owner_exp'].every((name) =>
        setCookies.some(
          (line) =>
            line.startsWith(`${name}=`) &&
            /HttpOnly/i.test(line) &&
            /SameSite=Strict/i.test(line) &&
            /Path=\//i.test(line),
        ),
      ),
    `${ownerLogin.status}/${setCookies.length}`,
  );
  ok(
    'local HTTP cookies omit Secure only for development',
    setCookies.every((line) => !/;\s*Secure/i.test(line)),
  );
  const me = await request('/api/owner/me', { cookie: ownerCookie });
  ok(
    'owner identity returns only email, role and expiry',
    me.status === 200 &&
      Object.keys(me.json ?? {})
        .sort()
        .join(',') === 'email,expiresAt,role',
    me.text,
  );
  const realtime = await request('/api/owner/realtime-token', {
    cookie: ownerCookie,
  });
  ok(
    'realtime endpoint returns the current access token and expiry only',
    realtime.status === 200 &&
      realtime.json?.accessToken === ownerLogin.jar.values.get('ph_owner_at') &&
      Object.keys(realtime.json ?? {})
        .sort()
        .join(',') === 'accessToken,expiresAt',
  );
  const guardedPage = await request('/owner/app', { cookie: ownerCookie });
  ok(
    'owner reaches the guarded placeholder',
    guardedPage.status === 200 &&
      /guarded owner area works/i.test(guardedPage.text),
    `${guardedPage.status}`,
  );

  const { data: ownerUsers } = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const ownerId = ownerUsers.users.find(
    (user) => user.email === ownerEmail,
  )?.id;
  if (!ownerId) throw new Error('Demo owner was not found.');
  rateKeys.add(
    await hash(`${process.env.RATE_LIMIT_SALT}:owner-write:${ownerId}`),
  );

  const directHeaders = [
    ['anon', { apikey: process.env.PUBLIC_SUPABASE_ANON_KEY }],
    [
      'normal user',
      {
        apikey: process.env.PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${nonOwner.session.access_token}`,
      },
    ],
  ];
  const privateTables = [
    'orders',
    'bookings',
    'booking_slots',
    'order_items',
    'enquiries',
    'assistant_logs',
    'knowledge_overrides',
    'daily_summaries',
    'rate_limits',
  ];
  for (const [label, headers] of directHeaders) {
    for (const table of privateTables) {
      const read = await fetch(
        `${process.env.PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
        { headers },
      );
      const readText = await read.text();
      let rows = null;
      try {
        rows = JSON.parse(readText);
      } catch {
        // A rejected request is also a successful denial.
      }
      ok(
        `${label} cannot read ${table}`,
        !read.ok || (Array.isArray(rows) && rows.length === 0),
        `${read.status}`,
      );
      const writeResult = await fetch(
        `${process.env.PUBLIC_SUPABASE_URL}/rest/v1/${table}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      ok(
        `${label} cannot write ${table}`,
        !writeResult.ok,
        `${writeResult.status}`,
      );
    }
    for (const table of ['menu_items', 'slot_tables']) {
      const read = await fetch(
        `${process.env.PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`,
        { headers },
      );
      const rows = await read.json();
      ok(
        `${label} can read ${table}`,
        read.ok && Array.isArray(rows) && rows.length === 1,
        `${read.status}`,
      );
      const writeResult = await fetch(
        `${process.env.PUBLIC_SUPABASE_URL}/rest/v1/${table}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      ok(
        `${label} cannot write ${table}`,
        !writeResult.ok,
        `${writeResult.status}`,
      );
    }
  }

  const orderId = crypto.randomUUID();
  const collectedOrderId = crypto.randomUUID();
  const orderCode = `PH-ORD-${String(Date.now()).slice(-10)}`;
  const collectedCode = `PH-ORD-${String(Date.now() + 1).slice(-10)}`;
  const { error: orderInsertError } = await service.from('orders').insert([
    {
      id: orderId,
      code: orderCode,
      name: 'ZZ TEST Owner Order',
      phone: '+919000199991',
      pickup_at: new Date(Date.now() + 3_600_000).toISOString(),
      subtotal: 1.4,
      status: 'new',
    },
    {
      id: collectedOrderId,
      code: collectedCode,
      name: 'ZZ TEST Collected Order',
      phone: '+919000199992',
      pickup_at: new Date(Date.now() + 3_600_000).toISOString(),
      subtotal: 1.4,
      status: 'collected',
    },
  ]);
  if (orderInsertError) throw orderInsertError;
  createdOrders.add(orderId);
  createdOrders.add(collectedOrderId);

  const illegalSkip = await write(
    `/api/owner/orders/${orderId}`,
    'PATCH',
    { status: 'ready' },
    ownerCookie,
  );
  ok(
    'new order cannot skip to ready',
    illegalSkip.status === 409,
    `${illegalSkip.status}`,
  );
  const backwards = await write(
    `/api/owner/orders/${collectedOrderId}`,
    'PATCH',
    { status: 'new' },
    ownerCookie,
  );
  ok(
    'collected order cannot return to new',
    backwards.status === 400,
    `${backwards.status}`,
  );
  const noReason = await write(
    `/api/owner/orders/${orderId}`,
    'PATCH',
    { status: 'cancelled' },
    ownerCookie,
  );
  ok(
    'order cancellation requires a reason',
    noReason.status === 400,
    `${noReason.status}`,
  );
  const freeReason = await write(
    `/api/owner/orders/${orderId}`,
    'PATCH',
    { status: 'cancelled', cancel_reason: 'because I said so' },
    ownerCookie,
  );
  ok(
    'order cancellation rejects free text',
    freeReason.status === 400,
    `${freeReason.status}`,
  );
  const massOrder = await write(
    `/api/owner/orders/${orderId}`,
    'PATCH',
    { status: 'preparing', subtotal: 0 },
    ownerCookie,
  );
  ok(
    'order PATCH rejects mass assignment',
    massOrder.status === 400,
    `${massOrder.status}`,
  );
  const preparing = await write(
    `/api/owner/orders/${orderId}`,
    'PATCH',
    { status: 'preparing' },
    ownerCookie,
  );
  ok(
    'legal order transition succeeds',
    preparing.status === 200,
    `${preparing.status}`,
  );
  const orderStatusIp = '198.51.110.1';
  rateKeys.add(
    await hash(`${process.env.RATE_LIMIT_SALT}:order-status:${orderStatusIp}`),
  );
  const customerOrder = await request(`/api/orders/${orderCode}`, {
    headers: { 'x-forwarded-for': orderStatusIp },
  });
  ok(
    'owner order status propagates to the customer endpoint',
    customerOrder.status === 200 && customerOrder.json?.status === 'preparing',
    customerOrder.text,
  );

  const dateValue = (() => {
    for (let offset = 10; offset < 25; offset += 1) {
      const candidate = new Date(Date.now() + offset * 86_400_000);
      const date = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
      }).format(candidate);
      const weekday = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
      }).format(new Date(`${date}T12:00:00+05:30`));
      if (weekday !== 'Mon') return date;
    }
    throw new Error('No booking date found.');
  })();
  const bookingFixtures = [];
  for (let index = 0; index < 6; index += 1) {
    const id = crypto.randomUUID();
    const row = {
      id,
      code: `PH-BK-${String(Date.now() + index).slice(-10)}`,
      name: `ZZ TEST Owner Booking ${index + 1}`,
      phone: `+9190002${String(90000 + index)}`,
      date: dateValue,
      start_time: index < 4 ? '15:00:00' : '18:00:00',
      party_size: index === 3 ? 4 : 2,
      status: 'requested',
    };
    bookingFixtures.push(row);
    createdBookings.add(id);
  }
  const { error: bookingInsertError } = await service
    .from('bookings')
    .insert(bookingFixtures);
  if (bookingInsertError) throw bookingInsertError;

  const tooFew = await write(
    `/api/owner/bookings/${bookingFixtures[3].id}`,
    'PATCH',
    { action: 'confirm', slotIds: ['S1'] },
    ownerCookie,
  );
  ok(
    'booking confirmation rejects too few seats',
    tooFew.status === 422,
    `${tooFew.status}`,
  );
  const race = await Promise.all([
    write(
      `/api/owner/bookings/${bookingFixtures[0].id}`,
      'PATCH',
      { action: 'confirm', slotIds: ['S1'] },
      ownerCookie,
    ),
    write(
      `/api/owner/bookings/${bookingFixtures[1].id}`,
      'PATCH',
      { action: 'confirm', slotIds: ['S1'] },
      ownerCookie,
    ),
  ]);
  ok(
    'simultaneous overlapping confirmations have one winner',
    race.filter((result) => result.status === 200).length === 1 &&
      race.filter((result) => result.status === 409).length === 1,
    race.map((result) => result.status).join(','),
  );
  const { data: raceSlots } = await service
    .from('booking_slots')
    .select('booking_id')
    .in('booking_id', [bookingFixtures[0].id, bookingFixtures[1].id]);
  ok(
    'the confirmation race leaves zero overlaps',
    raceSlots?.length === 1,
    `${raceSlots?.length}`,
  );
  const alreadyTaken = await write(
    `/api/owner/bookings/${bookingFixtures[2].id}`,
    'PATCH',
    { action: 'confirm', slotIds: ['S1'] },
    ownerCookie,
  );
  ok(
    'booking confirmation rejects an occupied slot',
    alreadyTaken.status === 409,
    `${alreadyTaken.status}`,
  );
  const confirmForDecline = await write(
    `/api/owner/bookings/${bookingFixtures[4].id}`,
    'PATCH',
    { action: 'confirm', slotIds: ['S2'] },
    ownerCookie,
  );
  const decline = await write(
    `/api/owner/bookings/${bookingFixtures[4].id}`,
    'PATCH',
    { action: 'decline', reason: 'ZZ TEST no table available' },
    ownerCookie,
  );
  const { count: declinedSlots } = await service
    .from('booking_slots')
    .select('*', { count: 'exact', head: true })
    .eq('booking_id', bookingFixtures[4].id);
  ok(
    'declining a confirmed booking frees its slots',
    confirmForDecline.status === 200 &&
      decline.status === 200 &&
      declinedSlots === 0,
    `${confirmForDecline.status}/${decline.status}/${declinedSlots}`,
  );
  const bookingStatusIp = '198.51.110.2';
  rateKeys.add(
    await hash(
      `${process.env.RATE_LIMIT_SALT}:booking-status-ip:${bookingStatusIp}`,
    ),
  );
  const customerBooking = await request(
    `/api/bookings/${bookingFixtures[4].code}`,
    { headers: { 'x-forwarded-for': bookingStatusIp } },
  );
  ok(
    'owner booking status propagates to the customer endpoint',
    customerBooking.status === 200 &&
      customerBooking.json?.status === 'declined',
    customerBooking.text,
  );
  const massBooking = await write(
    `/api/owner/bookings/${bookingFixtures[5].id}`,
    'PATCH',
    { action: 'cancel', reason: 'ZZ TEST', status: 'seated' },
    ownerCookie,
  );
  ok(
    'booking PATCH rejects mass assignment',
    massBooking.status === 400,
    `${massBooking.status}`,
  );

  const manualMass = await write(
    '/api/owner/bookings',
    'POST',
    {
      name: 'ZZ TEST Phone Guest',
      phone: '9000199999',
      date: dateValue,
      time: '12:00',
      partySize: 7,
      status: 'confirmed',
    },
    ownerCookie,
  );
  ok(
    'manual booking rejects mass assignment',
    manualMass.status === 400,
    `${manualMass.status}`,
  );
  const manualBooking = await write(
    '/api/owner/bookings',
    'POST',
    {
      name: 'ZZ TEST Phone Guest',
      phone: '9000199999',
      date: dateValue,
      time: '12:00',
      partySize: 7,
      occasion: 'none',
      preorder: [],
    },
    ownerCookie,
  );
  if (manualBooking.status === 201 && manualBooking.json?.booking?.code) {
    const { data: manualRow } = await service
      .from('bookings')
      .select('id')
      .eq('code', manualBooking.json.booking.code)
      .maybeSingle();
    if (manualRow?.id) createdBookings.add(manualRow.id);
  }
  ok(
    'manual booking uses the existing rules and creates a request',
    manualBooking.status === 201 &&
      manualBooking.json?.booking?.status === 'requested',
    `${manualBooking.status}`,
  );

  const enquiryId = crypto.randomUUID();
  const { error: enquiryInsertError } = await service.from('enquiries').insert({
    id: enquiryId,
    kind: 'general',
    name: 'ZZ TEST Enquiry',
    payload: {},
  });
  if (enquiryInsertError) throw enquiryInsertError;
  createdEnquiries.add(enquiryId);
  const massEnquiry = await write(
    `/api/owner/enquiries/${enquiryId}`,
    'PATCH',
    { status: 'done', seeded: true },
    ownerCookie,
  );
  ok(
    'enquiry PATCH rejects mass assignment',
    massEnquiry.status === 400,
    `${massEnquiry.status}`,
  );

  const { data: menuBefore, error: menuBeforeError } = await service
    .from('menu_items')
    .select('available,price_usd,description')
    .eq('id', 'PH0200')
    .single();
  if (menuBeforeError) throw menuBeforeError;
  restoreMenu = async () =>
    service.from('menu_items').update(menuBefore).eq('id', 'PH0200');
  const lowPrice = await write(
    '/api/owner/menu/PH0200',
    'PATCH',
    { price_usd: 0.49 },
    ownerCookie,
  );
  const highPrice = await write(
    '/api/owner/menu/PH0200',
    'PATCH',
    { price_usd: 50.01 },
    ownerCookie,
  );
  const longDescription = await write(
    '/api/owner/menu/PH0200',
    'PATCH',
    { description: 'x'.repeat(301) },
    ownerCookie,
  );
  const massMenu = await write(
    '/api/owner/menu/PH0200',
    'PATCH',
    { available: false, admin: true },
    ownerCookie,
  );
  ok(
    'menu enforces price bounds, description length and strict keys',
    [lowPrice, highPrice, longDescription, massMenu].every(
      (result) => result.status === 400,
    ),
    [lowPrice, highPrice, longDescription, massMenu]
      .map((result) => result.status)
      .join(','),
  );

  const writeTargets = [
    [`/api/owner/orders/${orderId}`, 'PATCH', { status: 'ready' }],
    [
      `/api/owner/bookings/${bookingFixtures[5].id}`,
      'PATCH',
      { action: 'cancel', reason: 'ZZ TEST' },
    ],
    [`/api/owner/enquiries/${enquiryId}`, 'PATCH', { status: 'done' }],
    ['/api/owner/menu/PH0200', 'PATCH', { available: true }],
    [
      '/api/owner/bookings',
      'POST',
      {
        name: 'ZZ TEST Phone Guest',
        phone: '9000199999',
        date: dateValue,
        time: '12:00',
        partySize: 7,
      },
    ],
  ];
  for (const [path, method, body] of writeTargets) {
    const noOrigin = await write(path, method, body, ownerCookie, {
      origin: null,
    });
    const wrongType = await write(path, method, body, ownerCookie, {
      headers: { 'Content-Type': 'text/plain' },
    });
    ok(
      `${path} rejects missing Origin`,
      noOrigin.status === 400,
      `${noOrigin.status}`,
    );
    ok(
      `${path} rejects wrong content type`,
      wrongType.status === 400,
      `${wrongType.status}`,
    );
  }

  const loginMass = await write(
    '/api/owner/login',
    'POST',
    { email: ownerEmail, password: ownerPassword, role: 'owner' },
    null,
    { headers: { 'x-ph-test-ip': '198.51.100.31' } },
  );
  await rememberLoginKeys('198.51.100.31', ownerEmail);
  ok(
    'login rejects unknown keys',
    loginMass.status === 400,
    `${loginMass.status}`,
  );
  const loginNoOrigin = await write(
    '/api/owner/login',
    'POST',
    { email: ownerEmail, password: ownerPassword },
    null,
    { origin: null },
  );
  const loginWrongType = await write(
    '/api/owner/login',
    'POST',
    { email: ownerEmail, password: ownerPassword },
    null,
    { headers: { 'Content-Type': 'text/plain' } },
  );
  ok(
    'login rejects missing Origin',
    loginNoOrigin.status === 400,
    `${loginNoOrigin.status}`,
  );
  ok(
    'login rejects wrong content type',
    loginWrongType.status === 400,
    `${loginWrongType.status}`,
  );
  const logoutMass = await write(
    '/api/owner/logout',
    'POST',
    { allUsers: true },
    ownerCookie,
  );
  ok(
    'logout rejects unknown keys',
    logoutMass.status === 400,
    `${logoutMass.status}`,
  );
  const logoutNoOrigin = await write(
    '/api/owner/logout',
    'POST',
    {},
    ownerCookie,
    { origin: null },
  );
  const logoutWrongType = await write(
    '/api/owner/logout',
    'POST',
    {},
    ownerCookie,
    { headers: { 'Content-Type': 'text/plain' } },
  );
  ok(
    'logout rejects missing Origin',
    logoutNoOrigin.status === 400,
    `${logoutNoOrigin.status}`,
  );
  ok(
    'logout rejects wrong content type',
    logoutWrongType.status === 400,
    `${logoutWrongType.status}`,
  );

  const ownerWriteKey = await hash(
    `${process.env.RATE_LIMIT_SALT}:owner-write:${ownerId}`,
  );
  const { error: forceLimitError } = await service
    .from('rate_limits')
    .update({ hits: 300 })
    .eq('key', ownerWriteKey);
  if (forceLimitError) throw forceLimitError;
  const { data: ownerWriteStillAllowed, error: ownerWriteLimitError } =
    await service.rpc('hit_rate_limit', {
      p_key: ownerWriteKey,
      p_window_seconds: 600,
      p_max: 300,
    });
  if (ownerWriteLimitError) throw ownerWriteLimitError;
  ok(
    'owner write limit is exhausted before logout',
    ownerWriteStillAllowed === false,
  );

  const logout = await write('/api/owner/logout', 'POST', {}, ownerCookie);
  ownerLogin.jar.update(logout.response.headers);
  const afterLogout = await request('/api/owner/me', {
    cookie: ownerLogin.jar.header(),
  });
  ok(
    'logout clears cookies and ends access after the write limit is hit',
    logout.status === 200 &&
      ownerLogin.jar.header() === '' &&
      afterLogout.status === 401,
    `${logout.status}/${afterLogout.status}`,
  );

  const accessToken = ownerCookie
    .split('; ')
    .find((part) => part.startsWith('ph_owner_at='))
    ?.slice('ph_owner_at='.length);
  const refreshToken = ownerCookie
    .split('; ')
    .find((part) => part.startsWith('ph_owner_rt='))
    ?.slice('ph_owner_rt='.length);
  for (const item of responses) {
    const nonCookieHeaders = item.headers
      .split('\n')
      .filter((line) => !line.toLowerCase().startsWith('set-cookie:'))
      .join('\n');
    const combined = `${nonCookieHeaders}\n${item.text}`;
    ok(
      `${item.path} leaks no service key, refresh token or salt`,
      !combined.includes(process.env.SUPABASE_SERVICE_KEY) &&
        !combined.includes(process.env.RATE_LIMIT_SALT) &&
        (!refreshToken || !combined.includes(refreshToken)),
    );
    ok(
      `${item.path} exposes no access token outside the intended realtime body`,
      !accessToken ||
        !combined.includes(accessToken) ||
        (item.allowAccessBody && !item.headers.includes(accessToken)),
    );
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL: suite error: ${error?.message ?? error}`);
} finally {
  if (restoreMenu) await restoreMenu();
  const { data: strayOrders } = await service
    .from('orders')
    .select('id')
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  for (const row of strayOrders ?? []) createdOrders.add(row.id);
  const { data: strayBookings } = await service
    .from('bookings')
    .select('id')
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  for (const row of strayBookings ?? []) createdBookings.add(row.id);
  if (createdOrders.size)
    await service
      .from('orders')
      .delete()
      .in('id', [...createdOrders]);
  if (createdBookings.size)
    await service
      .from('bookings')
      .delete()
      .in('id', [...createdBookings]);
  if (createdEnquiries.size)
    await service
      .from('enquiries')
      .delete()
      .in('id', [...createdEnquiries]);
  for (const userId of createdUsers)
    await service.auth.admin.deleteUser(userId);
  if (rateKeys.size)
    await service
      .from('rate_limits')
      .delete()
      .in('key', [...rateKeys]);
  console.log(
    `CLEANUP: ${createdOrders.size} orders, ${createdBookings.size} bookings, ${createdEnquiries.size} enquiries, ${createdUsers.size} users and ${rateKeys.size} rate keys targeted.`,
  );
  console.log(
    failures
      ? `\n${failures} OWNER CHECK(S) FAILED`
      : '\nALL OWNER API CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
