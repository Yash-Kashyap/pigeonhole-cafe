// Live attack check for POST /api/orders, the create_order function and the confirmation pages.
// Needs: dev server on 127.0.0.1:4321 and migration 0003 applied. Run with tsx so it can import the rules:
//   node node_modules/tsx/dist/cli.mjs scripts/check-orders-api.mjs
// It creates test orders named "ZZ TEST", changes one menu item's availability for a moment, and cleans up
// exactly what it created (orders by code, rate-limit rows by key, availability restored).
import { createClient } from '@supabase/supabase-js';
import { getPickupDates, nearestValidPickup } from '../src/lib/rules.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4321';
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-check/1.0' } },
  },
);

let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const created = []; // order codes made by this run
const keys = new Set(); // rate-limit keys touched by this run
const startedAt = new Date().toISOString();
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const normPhone = (p) => {
  const d = String(p).replace(/^\+/, '');
  return /^\d{10}$/.test(d) ? `+91${d}` : `+${d}`;
};

let ipCounter = 10;
const nextIp = () => `198.51.100.${ipCounter++}`;
let phoneCounter = 1;
const nextPhone = () => `90000${String(phoneCounter++).padStart(5, '0')}`;

async function post(body, { ip = nextIp(), headers = {}, raw } = {}) {
  keys.add(await hash(`${process.env.RATE_LIMIT_SALT}:order-ip:${ip}`));
  if (body && typeof body === 'object' && body.phone)
    keys.add(
      await hash(
        `${process.env.RATE_LIMIT_SALT}:order-phone:${normPhone(body.phone)}`,
      ),
    );
  const res = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'x-ph-test-ip': ip,
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  if (res.status === 201 && json?.code) created.push(json.code);
  return { status: res.status, json, text, headers: res.headers };
}

// ---- valid pickup times from the real rules (works at any hour) ----
const now = new Date();
const dates = getPickupDates(now, 10);
const firstOpen = dates.find((d) => d.available);
const validPickup = nearestValidPickup(new Date(), 30); // comfortably after the prep time
const monday = dates.find((d) => /Mondays/.test(d.reason ?? ''));
const weekdayAvail = dates.find(
  (d) =>
    d.available &&
    !['Sat', 'Sun'].includes(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
      }).format(new Date(`${d.date}T12:00:00+05:30`)),
    ),
);
const ist = (date, hhmm) => `${date}T${hhmm}:00+05:30`;

const good = (over = {}) => ({
  items: [{ id: 'PH0003', qty: 1 }],
  name: 'ZZ TEST Guest',
  phone: nextPhone(),
  pickupAt: validPickup.toISOString(),
  notes: '',
  honeypot: '',
  mountedAt: Date.now() - 5000,
  ...over,
});

const priceOf = async (ids) => {
  const { data } = await db
    .from('menu_items')
    .select('id,name,price_usd,available,prep_minutes')
    .in('id', ids);
  return Object.fromEntries(data.map((r) => [r.id, r]));
};

let restoreAvailability = null;
try {
  console.log(
    `Valid pickup used: ${validPickup.toISOString()}; Monday date: ${monday?.date}; weekday: ${weekdayAvail?.date}`,
  );

  // 1. Happy path and the stored rows
  const prices = await priceOf(['PH0003', 'PH0060']);
  const happyBody = good({
    items: [
      { id: 'PH0003', qty: 2, note: '  less sugar  ' },
      { id: 'PH0060', qty: 1 },
    ],
    name: '  ZZ TEST Happy  ',
    notes: 'ring the bell',
    phone: '+91 9000000999'.replace(/\s/g, ''),
  });
  const happy = await post(happyBody);
  ok(
    'happy order returns 201 with code, pickupAt and subtotal',
    happy.status === 201 && /^PH-ORD-\d{4,}$/.test(happy.json?.code ?? ''),
    `${happy.status} ${happy.text.slice(0, 120)}`,
  );
  if (happy.status === 201) {
    const { data: row, error } = await db
      .from('orders')
      .select('*, order_items(*)')
      .eq('code', happy.json.code)
      .single();
    ok(
      'order row readable from the database',
      !error && !!row,
      error?.message ?? '',
    );
    const expected = Number(
      (prices.PH0003.price_usd * 2 + prices.PH0060.price_usd).toFixed(2),
    );
    ok(
      'subtotal in the database equals prices from menu_items',
      Number(row?.subtotal) === expected,
      `${row?.subtotal} vs ${expected}`,
    );
    ok(
      'response subtotal equals database subtotal',
      Number(happy.json.subtotal) === Number(row?.subtotal),
    );
    ok(
      'status new, source site',
      row?.status === 'new' && row?.source === 'site',
      `${row?.status}/${row?.source}`,
    );
    ok(
      'phone stored normalised with +91',
      row?.phone === '+919000000999',
      row?.phone,
    );
    ok(
      'name trimmed',
      row?.name === 'ZZ TEST Happy',
      JSON.stringify(row?.name),
    );
    ok(
      'pickup stored as requested',
      new Date(row?.pickup_at).getTime() === validPickup.getTime(),
    );
    const lines = Object.fromEntries(
      (row?.order_items ?? []).map((l) => [l.menu_item_id, l]),
    );
    ok(
      'item snapshots carry the database name and price',
      lines.PH0003?.name_snapshot === prices.PH0003.name &&
        Number(lines.PH0003?.price_snapshot) ===
          Number(prices.PH0003.price_usd) &&
        lines.PH0003?.qty === 2,
    );
    ok(
      'line note saved and trimmed',
      lines.PH0003?.note === 'less sugar',
      JSON.stringify(lines.PH0003?.note),
    );
    ok('line without a note has null note', lines.PH0060?.note == null);
  }

  // 2. Tampering with the body
  for (const extra of [
    { price: 0 },
    { subtotal: 0.01 },
    { total: 1 },
    { source: 'assistant' },
    { status: 'collected' },
  ]) {
    const r = await post(good(extra));
    ok(
      `unknown key ${Object.keys(extra)[0]} is rejected with 400`,
      r.status === 400,
      `${r.status}`,
    );
  }
  const lineTamper = await post(
    good({ items: [{ id: 'PH0003', qty: 1, price: 0 }] }),
  );
  ok(
    'price inside an item line is rejected',
    lineTamper.status === 400,
    `${lineTamper.status}`,
  );

  // 3. Quantities and duplicates
  const dup = await post(
    good({
      items: [
        { id: 'PH0003', qty: 12 },
        { id: 'PH0003', qty: 12 },
      ],
    }),
  );
  ok(
    'duplicate lines summing over 20 are refused (422)',
    dup.status === 422,
    `${dup.status}`,
  );
  const merge = await post(
    good({
      items: [
        { id: 'PH0003', qty: 10 },
        { id: 'PH0003', qty: 5 },
      ],
    }),
  );
  ok(
    'duplicate lines under the cap are merged into one row',
    merge.status === 201,
    `${merge.status}`,
  );
  if (merge.status === 201) {
    const { data: rows } = await db
      .from('order_items')
      .select('qty,menu_item_id,orders!inner(code)')
      .eq('orders.code', merge.json.code);
    ok(
      'merged order has one row with qty 15',
      rows?.length === 1 && rows[0].qty === 15,
      JSON.stringify(rows?.map((r) => r.qty)),
    );
  }
  for (const [label, qty] of [
    ['21 of one item', 21],
    ['zero quantity', 0],
    ['negative quantity', -1],
    ['fractional quantity', 1.5],
  ]) {
    const r = await post(good({ items: [{ id: 'PH0003', qty }] }));
    ok(`${label} is rejected`, r.status === 400, `${r.status}`);
  }
  const forty1 = Array.from({ length: 9 }, (_, i) => ({
    id: `PH00${String(i + 1).padStart(2, '0')}`,
    qty: 5,
  }));
  const tooMany = await post(good({ items: forty1 }));
  ok(
    '45 items in total are refused (422)',
    tooMany.status === 422,
    `${tooMany.status}`,
  );
  const forty = await post(good({ items: forty1.slice(0, 8) }));
  ok(
    'exactly 40 items are accepted',
    forty.status === 201,
    `${forty.status} ${forty.text.slice(0, 80)}`,
  );
  const empty = await post(good({ items: [] }));
  ok('empty cart is rejected', empty.status === 400, `${empty.status}`);

  // 4. Unknown and malformed ids
  const unknown = await post(good({ items: [{ id: 'PH9999', qty: 1 }] }));
  ok(
    'unknown item id gives 409 with the id',
    unknown.status === 409 && unknown.json?.unavailableIds?.includes('PH9999'),
    `${unknown.status}`,
  );
  for (const id of [
    "PH0003'; drop table orders;--",
    '../etc/passwd',
    'ph0003',
    'PH003',
    '<script>',
  ]) {
    const r = await post(good({ items: [{ id, qty: 1 }] }));
    ok(
      `malformed id ${JSON.stringify(id).slice(0, 28)} rejected`,
      r.status === 400,
      `${r.status}`,
    );
  }

  // 5. Unavailable item (menu item switched off for a moment, restored in finally)
  const target = 'PH0200';
  const { data: before } = await db
    .from('menu_items')
    .select('available')
    .eq('id', target)
    .single();
  restoreAvailability = async () =>
    db
      .from('menu_items')
      .update({ available: before.available })
      .eq('id', target);
  await db.from('menu_items').update({ available: false }).eq('id', target);
  const un = await post(
    good({
      items: [
        { id: target, qty: 1 },
        { id: 'PH0003', qty: 1 },
      ],
    }),
  );
  ok(
    'an unavailable item gives 409 listing it, and nothing is created',
    un.status === 409 && un.json?.unavailableIds?.[0] === target,
    `${un.status} ${JSON.stringify(un.json?.unavailableIds)}`,
  );
  // the database function refuses too, instead of silently dropping the item
  const rpcUn = await db.rpc('create_order', {
    p_name: 'ZZ TEST rpc',
    p_phone: '+919000000000',
    p_pickup: validPickup.toISOString(),
    p_notes: null,
    p_source: 'site',
    p_items: [{ id: target, qty: 1 }],
  });
  ok(
    'create_order itself refuses an unavailable item',
    !!rpcUn.error && /unavailable_item/.test(rpcUn.error.message),
    rpcUn.error?.message ?? 'no error',
  );
  await restoreAvailability();
  restoreAvailability = null;

  // 6. The database function against hostile payloads (called directly with the secret key)
  const rpcCases = [
    ['quantity above 20 on one id', [{ id: 'PH0003', qty: 21 }]],
    [
      'duplicates summing above 20',
      [
        { id: 'PH0003', qty: 11 },
        { id: 'PH0003', qty: 11 },
      ],
    ],
    [
      'quantity that overflows an integer',
      [{ id: 'PH0003', qty: 99999999999 }],
    ],
    ['non numeric quantity', [{ id: 'PH0003', qty: 'abc' }]],
    ['malformed id', [{ id: 'bad', qty: 1 }]],
    ['empty array', []],
    ['not an array', { id: 'PH0003', qty: 1 }],
    ['41 items', Array.from({ length: 41 }, () => ({ id: 'PH0003', qty: 1 }))],
  ];
  for (const [label, items] of rpcCases) {
    const r = await db.rpc('create_order', {
      p_name: 'ZZ TEST rpc',
      p_phone: '+919000000000',
      p_pickup: validPickup.toISOString(),
      p_notes: null,
      p_source: 'site',
      p_items: items,
    });
    if (!r.error && typeof r.data === 'string') created.push(r.data);
    ok(
      `create_order refuses: ${label}`,
      !!r.error,
      r.error?.message?.slice(0, 60) ?? `created ${r.data}`,
    );
  }
  const longNote = await db.rpc('create_order', {
    p_name: 'ZZ TEST rpc',
    p_phone: '+919000000000',
    p_pickup: validPickup.toISOString(),
    p_notes: null,
    p_source: 'site',
    p_items: [{ id: 'PH0003', qty: 1, note: 'x'.repeat(200) }],
  });
  if (typeof longNote.data === 'string') {
    created.push(longNote.data);
    const { data } = await db
      .from('order_items')
      .select('note, orders!inner(code)')
      .eq('orders.code', longNote.data);
    ok(
      'create_order cuts a 200 character line note to 80',
      data?.[0]?.note?.length === 80,
      `${data?.[0]?.note?.length}`,
    );
  } else ok('create_order cuts a long note', false, longNote.error?.message);
  const badNotes = await db.rpc('create_order', {
    p_name: 'ZZ TEST rpc',
    p_phone: '+919000000000',
    p_pickup: validPickup.toISOString(),
    p_notes: 'y'.repeat(201),
    p_source: 'site',
    p_items: [{ id: 'PH0003', qty: 1 }],
  });
  ok(
    'orders.notes over 200 characters is refused by the table',
    !!badNotes.error,
    badNotes.error?.message?.slice(0, 60) ?? 'accepted',
  );
  if (typeof badNotes.data === 'string') created.push(badNotes.data);
  const badSource = await db.rpc('create_order', {
    p_name: 'ZZ TEST rpc',
    p_phone: '+919000000000',
    p_pickup: validPickup.toISOString(),
    p_notes: null,
    p_source: 'hacker',
    p_items: [{ id: 'PH0003', qty: 1 }],
  });
  ok(
    'orders.source outside site/assistant is refused',
    !!badSource.error,
    badSource.error?.message?.slice(0, 60) ?? 'accepted',
  );
  if (typeof badSource.data === 'string') created.push(badSource.data);

  // 7. Pickup rules through the API
  const pickupCases = [
    ['a Monday', monday ? ist(monday.date, '12:00') : null],
    ['before opening', firstOpen ? ist(firstOpen.date, '06:00') : null],
    [
      'at last orders (weekday 21:00)',
      weekdayAvail ? ist(weekdayAvail.date, '21:00') : null,
    ],
    ['after closing', weekdayAvail ? ist(weekdayAvail.date, '22:30') : null],
    ['in the past', new Date(Date.now() - 3_600_000).toISOString()],
    ['too soon (5 minutes away)', new Date(Date.now() + 300_000).toISOString()],
    [
      'more than 7 days ahead',
      // noon IST on a day 9 to 12 days out that is not a Monday, so the refusal is about the 7 day window
      (() => {
        for (let n = 9; n < 13; n += 1) {
          const day = new Date(Date.now() + n * 86_400_000);
          const date = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
          }).format(day);
          const weekday = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            weekday: 'short',
          }).format(day);
          if (weekday !== 'Mon') return ist(date, '12:00');
        }
        return null;
      })(),
      /7 days/,
    ],
  ];
  for (const [label, pickupAt, expectMessage] of pickupCases) {
    if (!pickupAt) {
      ok(`pickup ${label}: skipped (no date available)`, true);
      continue;
    }
    const r = await post(good({ pickupAt }));
    ok(
      `pickup ${label} is refused (422)`,
      r.status === 422 &&
        (!expectMessage ||
          expectMessage.test((r.json?.errors ?? []).join(' '))),
      `${r.status} ${r.json?.errors?.[0] ?? r.text.slice(0, 60)}`,
    );
  }
  for (const [label, pickupAt] of [
    ['garbage', 'tomorrow lunch'],
    ['no offset', '2026-11-20T12:00:00'],
    ['epoch number', 1700000000],
  ]) {
    const r = await post(good({ pickupAt }));
    ok(`pickup ${label} is rejected (400)`, r.status === 400, `${r.status}`);
  }
  const both = await post(good({ asap: true }));
  ok(
    'asap together with pickupAt is rejected',
    both.status === 400,
    `${both.status}`,
  );
  const neither = await post(good({ pickupAt: undefined }));
  ok(
    'neither asap nor pickupAt is rejected',
    neither.status === 400,
    `${neither.status}`,
  );

  // 8. Bot guards
  const hp = await post(good({ honeypot: 'http://spam' }));
  ok('filled honeypot is rejected', hp.status === 400, `${hp.status}`);
  const hpMissing = await post(good({ honeypot: undefined }));
  ok(
    'missing honeypot is rejected',
    hpMissing.status === 400,
    `${hpMissing.status}`,
  );
  for (const [label, mountedAt] of [
    ['too fast (0.5 s)', Date.now() - 500],
    ['in the future', Date.now() + 60_000],
    ['older than 24 hours', Date.now() - 90_000_000],
    ['not a time', 'soon'],
  ]) {
    const r = await post(good({ mountedAt }));
    ok(`time-to-submit ${label} is rejected`, r.status === 400, `${r.status}`);
  }

  // 9. Phone and name
  for (const phone of [
    '123',
    '',
    'abcdefghij',
    '98765 43210',
    '+1 202 555 0100',
    '09876543210',
    "9876543210'; --",
  ]) {
    const r = await post(good({ phone }));
    ok(
      `phone ${JSON.stringify(phone)} is rejected`,
      r.status === 400,
      `${r.status}`,
    );
  }
  for (const name of ['A', '', 'x'.repeat(61), 'Bad\u0000Name', 'Bad\nName']) {
    const r = await post(good({ name }));
    ok(
      `name ${JSON.stringify(name).slice(0, 20)} is rejected`,
      r.status === 400,
      `${r.status}`,
    );
  }
  const longNotes = await post(good({ notes: 'n'.repeat(201) }));
  ok(
    'kitchen notes over 200 characters are rejected',
    longNotes.status === 400,
    `${longNotes.status}`,
  );
  const xss = await post(
    good({
      name: 'ZZ TEST <img src=x onerror=alert(1)>',
      notes: '<script>alert(1)</script>',
    }),
  );
  ok(
    'markup in name and notes is accepted as plain text',
    xss.status === 201,
    `${xss.status}`,
  );

  // 10. Request shape
  const noOrigin = await fetch(`${base}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ph-test-ip': nextIp() },
    body: JSON.stringify(good()),
  });
  ok(
    'request without Origin is rejected',
    noOrigin.status === 400,
    `${noOrigin.status}`,
  );
  const evil = await post(good(), {
    headers: { Origin: 'https://evil.example' },
  });
  ok(
    'request from another origin is rejected',
    evil.status === 400,
    `${evil.status}`,
  );
  const textPlain = await post(good(), {
    headers: { 'Content-Type': 'text/plain' },
  });
  ok(
    'non JSON content type is rejected',
    textPlain.status === 400,
    `${textPlain.status}`,
  );
  const big = await post(null, {
    raw: JSON.stringify({ pad: 'x'.repeat(20_000) }),
  });
  ok('body over 16 KB is rejected', big.status === 400, `${big.status}`);
  const badJson = await post(null, { raw: '{not json' });
  ok('invalid JSON is rejected', badJson.status === 400, `${badJson.status}`);
  const getMethod = await fetch(`${base}/api/orders`, {
    headers: { 'x-ph-test-ip': nextIp() },
  });
  ok(
    'GET on the orders endpoint is not allowed',
    [404, 405].includes(getMethod.status),
    `${getMethod.status}`,
  );
  ok(
    'responses are no-store JSON and leak no stack trace',
    happy.headers.get('cache-control') === 'no-store' &&
      !/at .*\.(ts|js)|node_modules|supabase\.co|sb_secret/i.test(
        JSON.stringify([unknown.text, hp.text, tooMany.text]),
      ),
  );

  // 11. Rate limits
  const floodIp = nextIp();
  const statuses = [];
  let retryAfter = null;
  for (let i = 0; i < 11; i += 1) {
    const r = await post(good({ phone: nextPhone() }), { ip: floodIp });
    statuses.push(r.status);
    if (r.status === 429) retryAfter = r.headers.get('retry-after');
  }
  ok(
    'IP flood: first 10 allowed, the 11th gets 429 with Retry-After',
    statuses.slice(0, 10).every((s) => s === 201) &&
      statuses[10] === 429 &&
      retryAfter === '3600',
    statuses.join(','),
  );
  const samePhone = nextPhone();
  const phoneStatuses = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await post(good({ phone: samePhone }), { ip: nextIp() });
    phoneStatuses.push(r.status);
  }
  ok(
    'phone flood from different IPs: 5 allowed, the 6th gets 429',
    phoneStatuses.slice(0, 5).every((s) => s === 201) &&
      phoneStatuses[5] === 429,
    phoneStatuses.join(','),
  );
  const { data: limitRows } = await db
    .from('rate_limits')
    .select('key')
    .in('key', [...keys]);
  ok(
    'rate_limits holds only 64 character hashes, no raw IP or phone',
    (limitRows ?? []).length > 0 &&
      limitRows.every((r) => /^[0-9a-f]{64}$/.test(r.key)),
  );

  // 12. Confirmation page and status endpoint
  if (happy.status === 201) {
    const code = happy.json.code;
    const page = await fetch(`${base}/order/confirmed?code=${code}`);
    const html = await page.text();
    ok(
      'confirmation page loads for a real code',
      page.status === 200 && html.includes(code),
      `${page.status}`,
    );
    ok(
      'confirmation shows items and the database subtotal',
      html.includes(prices.PH0003.name) &&
        html.includes(
          String(
            happy.json.subtotal.toFixed
              ? happy.json.subtotal.toFixed(2)
              : happy.json.subtotal,
          ),
        ),
    );
    ok(
      'confirmation never shows the phone number',
      !/9000000999|\+91\s?9000/.test(html),
    );
    ok('confirmation is noindex', /name="robots"[^>]*noindex/.test(html));
    ok(
      'confirmation HTML has no WhatsApp number and no wa.me',
      !html.includes(process.env.PUBLIC_WHATSAPP_NUMBER) &&
        !/wa\.me/.test(html),
    );
    const nf = await fetch(`${base}/order/confirmed?code=PH-ORD-999999`);
    ok(
      'unknown code gives 404 with a friendly page',
      nf.status === 404 && /missing|not found/i.test(await nf.text()),
      `${nf.status}`,
    );
    for (const bad of [
      '',
      'PH-ORD-1; drop table orders',
      "PH-ORD-1' or '1'='1",
      '../../etc/passwd',
      'ph-ord-0001',
      'PH-ORD-',
    ]) {
      const r = await fetch(
        `${base}/order/confirmed?code=${encodeURIComponent(bad)}`,
      );
      ok(
        `malformed code ${JSON.stringify(bad).slice(0, 30)} gives 404`,
        r.status === 404,
        `${r.status}`,
      );
    }
    const st = await fetch(`${base}/api/orders/${code}`);
    const stj = await st.json();
    ok(
      'status endpoint returns only the status',
      st.status === 200 &&
        Object.keys(stj).join() === 'status' &&
        stj.status === 'new',
      JSON.stringify(stj),
    );
    ok(
      'status endpoint is no-store',
      st.headers.get('cache-control') === 'no-store',
    );
    const st404 = await fetch(`${base}/api/orders/PH-ORD-999999`);
    ok(
      'status endpoint 404 for unknown code',
      st404.status === 404,
      `${st404.status}`,
    );
    const stBad = await fetch(
      `${base}/api/orders/${encodeURIComponent("1' or '1'='1")}`,
    );
    ok(
      'status endpoint 404 for malformed code',
      stBad.status === 404,
      `${stBad.status}`,
    );
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL: script error: ${error?.message ?? error}`);
} finally {
  if (restoreAvailability) await restoreAvailability();
  // Everything this run created: by the codes it recorded, plus any test row it did not expect.
  const { data: strays } = await db
    .from('orders')
    .select('code')
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  const unexpected = (strays ?? [])
    .map((r) => r.code)
    .filter((c) => !created.includes(c));
  ok(
    'no unexpected test orders were created by rejected requests',
    unexpected.length === 0,
    unexpected.join(','),
  );
  const toDelete = [...new Set([...created, ...unexpected])];
  if (toDelete.length) await db.from('orders').delete().in('code', toDelete);
  if (keys.size)
    await db
      .from('rate_limits')
      .delete()
      .in('key', [...keys]);
  const { count } = await db
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .like('name', 'ZZ TEST%');
  const { data: avail } = await db
    .from('menu_items')
    .select('available')
    .eq('id', 'PH0200')
    .single();
  console.log(
    `CLEANUP: deleted ${toDelete.length} test orders, ${keys.size} rate-limit keys; ZZ TEST orders left: ${count}; PH0200 available: ${avail?.available}`,
  );
  console.log(
    failures
      ? `\n${failures} CHECK(S) FAILED`
      : '\nALL ORDER API CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
