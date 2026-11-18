// Live attack check for booking endpoints and migration 0004.
// Needs a dev server on 127.0.0.1:4321 and migration 0004 applied.
// Run with: node node_modules/tsx/dist/cli.mjs scripts/check-bookings-api.mjs
// It creates only bookings whose names start with "ZZ TEST" and removes all rows it creates.
import { createClient } from '@supabase/supabase-js';
import { getBookableDates, getBookableTimes } from '../src/lib/rules.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4321';
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-booking-check/1.0' } },
  },
);

let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};
const created = new Set();
const keys = new Set();
const startedAt = new Date().toISOString();
const hash = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const normalisePhone = (value) => {
  const digits = String(value).replace(/^\+/, '');
  return /^\d{10}$/.test(digits) ? `+91${digits}` : `+${digits}`;
};

let ipCounter = 10;
const nextIp = () => `198.51.100.${ipCounter++}`;
let phoneCounter = 1;
const nextPhone = () => `90001${String(phoneCounter++).padStart(5, '0')}`;

async function rememberRateKeys(body, ip) {
  keys.add(await hash(`${process.env.RATE_LIMIT_SALT}:booking-ip:${ip}`));
  if (body?.phone)
    keys.add(
      await hash(
        `${process.env.RATE_LIMIT_SALT}:booking-phone:${normalisePhone(body.phone)}`,
      ),
    );
}

async function postBooking(
  body,
  { ip = nextIp(), headers = {}, raw, origin = base } = {},
) {
  await rememberRateKeys(body, ip);
  const requestHeaders = {
    Origin: origin,
    'Content-Type': 'application/json',
    'x-ph-test-ip': ip,
    ...headers,
  };
  if (origin === null) delete requestHeaders.Origin;
  const response = await fetch(`${base}/api/bookings`, {
    method: 'POST',
    headers: requestHeaders,
    body: raw ?? JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The assertion below reports malformed responses.
  }
  if (response.status === 201 && json?.code) created.add(json.code);
  return { status: response.status, json, text, headers: response.headers };
}

async function cancel(body, { ip = nextIp() } = {}) {
  const ipKey = await hash(
    `${process.env.RATE_LIMIT_SALT}:booking-cancel-ip:${ip}`,
  );
  const codeKey = await hash(
    `${process.env.RATE_LIMIT_SALT}:booking-cancel-code:${body.code}`,
  );
  keys.add(ipKey);
  keys.add(codeKey);
  const response = await fetch(`${base}/api/bookings/cancel`, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'x-ph-test-ip': ip,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The assertion below reports malformed responses.
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function availability(date, party, extra = '') {
  const ip = nextIp();
  keys.add(
    await hash(`${process.env.RATE_LIMIT_SALT}:booking-availability-ip:${ip}`),
  );
  const response = await fetch(
    `${base}/api/availability?date=${encodeURIComponent(date)}&party=${encodeURIComponent(party)}${extra}`,
    { headers: { 'x-ph-test-ip': ip } },
  );
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The assertion below reports malformed responses.
  }
  return { status: response.status, json, text };
}

const localDate = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const localTime = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
const atIst = (date, time) => new Date(`${date}T${time}:00+05:30`);
const addLocalDays = (date, days) => {
  const noon = atIst(date, '12:00');
  return localDate(new Date(noon.getTime() + days * 86_400_000));
};

async function findOpenChoice(minimumHours = 26, minimumRemaining = 1) {
  const now = new Date();
  for (const date of getBookableDates(now)) {
    for (const time of getBookableTimes(date, now)) {
      if (
        atIst(date, time).getTime() - now.getTime() <
        minimumHours * 3_600_000
      )
        continue;
      const { data, error } = await db.rpc('get_availability', {
        p_date: date,
        p_party: 4,
      });
      if (error) throw error;
      const row = data.find(
        (entry) =>
          entry.start_time.slice(0, 5) === time &&
          Number(entry.remaining) >= minimumRemaining,
      );
      if (row) return { date, time };
    }
  }
  throw new Error('No suitable live booking time found.');
}

function good(choice, over = {}) {
  return {
    name: 'ZZ TEST Guest',
    phone: nextPhone(),
    email: 'zz-test@example.com',
    date: choice.date,
    time: choice.time,
    partySize: 4,
    occasion: 'none',
    notes: 'ZZ TEST note',
    preorder: [],
    honeypot: '',
    mountedAt: Date.now() - 5_000,
    ...over,
  };
}

async function rpcBooking(choice, over = {}) {
  const phone = over.p_phone ?? `+91${nextPhone()}`;
  const response = await db.rpc('create_booking', {
    p_name: 'ZZ TEST RPC',
    p_phone: phone,
    p_email: null,
    p_date: choice.date,
    p_start: choice.time,
    p_party: 4,
    p_occasion: null,
    p_notes: null,
    p_preorder: null,
    ...over,
  });
  const code = Array.isArray(response.data) ? response.data[0]?.code : null;
  if (code) created.add(code);
  return response;
}

let restorePh0200 = null;
try {
  const choice = await findOpenChoice(26, 2);
  const now = new Date();
  const today = localDate(now);
  const dates = Array.from({ length: 32 }, (_, index) =>
    addLocalDays(today, index),
  );
  const monday = dates.find(
    (date) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
      }).format(atIst(date, '12:00')) === 'Mon',
  );
  const day31 = addLocalDays(today, 31);
  const past = addLocalDays(today, -1);
  console.log(`Using ${choice.date} ${choice.time} Asia/Kolkata`);

  const available = await availability(choice.date, 4);
  ok(
    'availability returns database counts for valid half-hour starts',
    available.status === 200 &&
      available.json?.times?.some(
        (row) =>
          row.time === choice.time &&
          Number.isInteger(row.remaining) &&
          row.requestable === false,
      ),
    `${available.status}`,
  );
  const requestable = await availability(choice.date, 7);
  ok(
    'party seven availability is marked requestable',
    requestable.status === 200 &&
      requestable.json?.times?.length > 0 &&
      requestable.json?.times?.every(
        (row) => row.requestable === true && row.remaining === null,
      ),
    `${requestable.status}`,
  );
  const badAvailability = await availability(choice.date, '4.5', '&extra=1');
  ok(
    'availability rejects malformed or extra query values',
    badAvailability.status === 400,
    `${badAvailability.status}`,
  );

  // Happy path, database snapshot, smallest slot and personal-data privacy.
  const happyBody = good(choice, {
    name: 'ZZ TEST Private Name',
    phone: '9000199999',
    email: 'private@example.com',
    notes: 'private booking note',
    preorder: [
      { id: 'PH0003', qty: 1 },
      { id: 'PH0003', qty: 2 },
      { id: 'PH0060', qty: 1 },
    ],
  });
  const happy = await postBooking(happyBody);
  ok(
    'valid booking returns 201 with the required response fields',
    happy.status === 201 &&
      /^PH-BK-\d{4,}$/.test(happy.json?.code ?? '') &&
      Array.isArray(happy.json?.slotLabels) &&
      happy.json?.date === choice.date &&
      happy.json?.time === choice.time &&
      typeof happy.json?.holdUntil === 'string',
    `${happy.status} ${happy.text.slice(0, 100)}`,
  );
  let happyRow = null;
  if (happy.status === 201) {
    const { data, error } = await db
      .from('bookings')
      .select('*,booking_slots(slot_table_id,slot_tables(label,seats))')
      .eq('code', happy.json.code)
      .single();
    happyRow = data;
    ok('created booking is readable', !error && !!data, error?.message ?? '');
    ok(
      'party four received one four-seat slot',
      data?.status === 'confirmed' &&
        data?.booking_slots?.length === 1 &&
        data.booking_slots[0]?.slot_tables?.seats === 4,
    );
    const { data: menu } = await db
      .from('menu_items')
      .select('id,name,price_usd')
      .in('id', ['PH0003', 'PH0060']);
    const prices = Object.fromEntries(menu.map((item) => [item.id, item]));
    const preorder = data?.preorder;
    const chai = preorder?.lines?.find((line) => line.id === 'PH0003');
    const expectedTotal = Number(
      (prices.PH0003.price_usd * 3 + prices.PH0060.price_usd).toFixed(2),
    );
    ok(
      'preorder duplicates merge and snapshot database names and prices',
      preorder?.lines?.length === 2 &&
        chai?.qty === 3 &&
        chai?.name === prices.PH0003.name &&
        Number(chai?.price) === Number(prices.PH0003.price_usd) &&
        Number(preorder?.total) === expectedTotal,
    );
    const confirmation = await fetch(`${base}/api/bookings/${happy.json.code}`);
    keys.add(
      await hash(`${process.env.RATE_LIMIT_SALT}:booking-status-ip:unknown`),
    );
    const confirmationText = await confirmation.text();
    const confirmationJson = JSON.parse(confirmationText);
    ok(
      'confirmation returns booking, slots, party and preorder',
      confirmation.status === 200 &&
        confirmationJson.party === 4 &&
        Array.isArray(confirmationJson.slotLabels) &&
        Array.isArray(confirmationJson.preorder?.lines),
    );
    ok(
      'confirmation leaks no name, phone, email or notes',
      !/Private Name|9000199999|private@example\.com|private booking note/.test(
        confirmationText,
      ) &&
        !['name', 'phone', 'email', 'notes'].some((key) =>
          Object.hasOwn(confirmationJson, key),
        ),
    );
  }

  // Every booking rule through the HTTP API.
  const invalidRules = [
    ['Monday', good(choice, { date: monday, time: '12:00' }), 422],
    ['past date', good(choice, { date: past, time: '12:00' }), 422],
    ['day 31', good(choice, { date: day31, time: '12:00' }), 422],
    ['off-step time', good(choice, { time: '12:15' }), 422],
    ['after closing', good(choice, { time: '23:30' }), 422],
    ['party zero', good(choice, { partySize: 0 }), 400],
    ['party 13', good(choice, { partySize: 13 }), 400],
    ['party negative', good(choice, { partySize: -1 }), 400],
    ['party string', good(choice, { partySize: '4' }), 400],
    ['party fractional', good(choice, { partySize: 4.5 }), 400],
  ];
  for (const [label, body, expected] of invalidRules) {
    const response = await postBooking(body);
    ok(
      `${label} is rejected through the API`,
      response.status === expected,
      `${response.status}`,
    );
  }

  const sameDayCandidate = (() => {
    const times = [];
    for (let minutes = 7 * 60; minutes <= 22 * 60; minutes += 30) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const delta = atIst(today, time).getTime() - now.getTime();
      if (delta > 0 && delta < 2 * 3_600_000) times.push(time);
    }
    return times[0] ?? null;
  })();
  if (sameDayCandidate) {
    const sameDay = await postBooking(
      good(choice, { date: today, time: sameDayCandidate }),
    );
    ok(
      'same-day booking inside two hours is rejected',
      sameDay.status === 422,
      `${sameDay.status} at ${today} ${sameDayCandidate}`,
    );
  } else {
    ok(
      'same-day booking inside two hours (run while an open start is within two hours)',
      false,
      'current wall clock has no suitable same-day start',
    );
  }

  let inside24 = null;
  for (const date of getBookableDates(now)) {
    for (const time of getBookableTimes(date, now)) {
      const delta = atIst(date, time).getTime() - now.getTime();
      if (delta >= 2 * 3_600_000 && delta < 24 * 3_600_000) {
        inside24 = { date, time };
        break;
      }
    }
    if (inside24) break;
  }
  if (inside24) {
    const notice = await postBooking(
      good(choice, { ...inside24, partySize: 8 }),
    );
    ok(
      'party eight inside 24 hours is rejected',
      notice.status === 422,
      `${notice.status}`,
    );
  } else {
    ok(
      'party eight inside 24 hours (run while an open start exists)',
      false,
      'current wall clock has no suitable start inside 24 hours',
    );
  }

  // Strict shape, transport and bot controls.
  for (const extra of [
    { status: 'confirmed' },
    { slotLabels: ['SLOT 01'] },
    { holdUntil: 'never' },
    { seeded: true },
  ]) {
    const response = await postBooking(good(choice, extra));
    ok(
      `mass-assignment key ${Object.keys(extra)[0]} is rejected`,
      response.status === 400,
      `${response.status}`,
    );
  }
  const linePrice = await postBooking(
    good(choice, { preorder: [{ id: 'PH0003', qty: 1, price: -999 }] }),
  );
  ok(
    'client preorder prices are rejected rather than trusted',
    linePrice.status === 400,
    `${linePrice.status}`,
  );
  const noOrigin = await postBooking(good(choice), { origin: null });
  ok(
    'missing Origin is rejected',
    noOrigin.status === 400,
    `${noOrigin.status}`,
  );
  const wrongType = await postBooking(good(choice), {
    headers: { 'Content-Type': 'text/plain' },
  });
  ok(
    'wrong content type is rejected',
    wrongType.status === 400,
    `${wrongType.status}`,
  );
  const oversized = await postBooking(null, {
    raw: JSON.stringify({ pad: 'x'.repeat(20_000) }),
  });
  ok(
    'body over 16 KB is rejected',
    oversized.status === 400,
    `${oversized.status}`,
  );
  const honeypot = await postBooking(good(choice, { honeypot: 'spam' }));
  ok('honeypot is rejected', honeypot.status === 400, `${honeypot.status}`);
  const fast = await postBooking(good(choice, { mountedAt: Date.now() - 500 }));
  ok('fast submit is rejected', fast.status === 400, `${fast.status}`);

  // Preorder abuse and unavailable/unknown items.
  const thirteenLines = Array.from({ length: 13 }, (_, index) => ({
    id: `PH${String(index + 1).padStart(4, '0')}`,
    qty: 1,
  }));
  for (const [label, preorder, expected] of [
    ['13 lines', thirteenLines, 400],
    ['zero quantity', [{ id: 'PH0003', qty: 0 }], 400],
    ['quantity 21', [{ id: 'PH0003', qty: 21 }], 400],
    ['negative quantity', [{ id: 'PH0003', qty: -1 }], 400],
    ['unknown id', [{ id: 'PH9999', qty: 1 }], 400],
  ]) {
    const response = await postBooking(good(choice, { preorder }));
    ok(
      `preorder ${label} is rejected`,
      response.status === expected,
      `${response.status}`,
    );
  }
  const { data: beforePh0200 } = await db
    .from('menu_items')
    .select('available')
    .eq('id', 'PH0200')
    .single();
  restorePh0200 = async () =>
    db
      .from('menu_items')
      .update({ available: beforePh0200.available })
      .eq('id', 'PH0200');
  await db.from('menu_items').update({ available: false }).eq('id', 'PH0200');
  const unavailable = await postBooking(
    good(choice, { preorder: [{ id: 'PH0200', qty: 1 }] }),
  );
  ok(
    'unavailable PH0200 is rejected',
    unavailable.status === 400,
    `${unavailable.status}`,
  );
  await restorePh0200();
  restorePh0200 = null;

  const directUnknown = await rpcBooking(choice, {
    p_preorder: [{ id: 'PH9999', qty: 1 }],
  });
  ok(
    'create_booking directly rejects an unknown preorder item',
    !!directUnknown.error && /bad_preorder/.test(directUnknown.error.message),
    directUnknown.error?.message ?? 'accepted',
  );
  const directPrice = await rpcBooking(choice, {
    p_preorder: [{ id: 'PH0003', qty: 1, price: -100 }],
  });
  ok(
    'create_booking directly accepts only id and qty',
    !!directPrice.error && /bad_preorder/.test(directPrice.error.message),
    directPrice.error?.message ?? 'accepted',
  );

  // Requested groups never reserve slot rows.
  const requestedPhone = nextPhone();
  const requested = await postBooking(
    good(choice, { partySize: 7, phone: requestedPhone }),
  );
  ok(
    'party seven creates a requested booking',
    requested.status === 201 && requested.json?.status === 'requested',
    `${requested.status}`,
  );
  if (requested.status === 201) {
    const { data } = await db
      .from('bookings')
      .select('booking_slots(*)')
      .eq('code', requested.json.code)
      .single();
    ok(
      'requested booking has no booking_slots rows',
      data?.booking_slots?.length === 0,
    );
    const requestedCancel = await cancel({
      code: requested.json.code,
      last4: requestedPhone.slice(-4),
    });
    ok(
      'requested booking can be cancelled',
      requestedCancel.status === 200,
      `${requestedCancel.status}`,
    );
  }

  // IP and phone limits.
  const floodIp = nextIp();
  const ipStatuses = [];
  for (let index = 0; index < 11; index += 1) {
    const response = await postBooking(
      good(choice, { partySize: 7, phone: nextPhone() }),
      { ip: floodIp },
    );
    ipStatuses.push(response.status);
  }
  ok(
    'IP limit allows ten and rejects the eleventh',
    ipStatuses.slice(0, 10).every((status) => status === 201) &&
      ipStatuses[10] === 429,
    ipStatuses.join(','),
  );
  const onePhone = nextPhone();
  const phoneStatuses = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await postBooking(
      good(choice, { partySize: 7, phone: onePhone }),
      { ip: nextIp() },
    );
    phoneStatuses.push(response.status);
  }
  ok(
    'phone limit allows five and rejects the sixth',
    phoneStatuses.slice(0, 5).every((status) => status === 201) &&
      phoneStatuses[5] === 429,
    phoneStatuses.join(','),
  );

  // Cancellation privacy, brute-force cap, cutoff, repeated cancellation and slot release.
  const wrongCode = await cancel({ code: 'PH-BK-99999999', last4: '1111' });
  const wrongDigits = await cancel({
    code: happy.json?.code ?? 'PH-BK-1000',
    last4: '1111',
  });
  ok(
    'wrong code and wrong last four have the same response',
    wrongCode.status === wrongDigits.status &&
      JSON.stringify(wrongCode.json) === JSON.stringify(wrongDigits.json),
    `${wrongCode.status}/${wrongDigits.status}`,
  );
  const bruteCode = 'PH-BK-99999998';
  const bruteStatuses = [];
  for (let index = 0; index < 6; index += 1) {
    const response = await cancel(
      { code: bruteCode, last4: String(index).padStart(4, '0') },
      { ip: nextIp() },
    );
    bruteStatuses.push(response.status);
  }
  ok(
    'a code is locked after five last-four attempts',
    bruteStatuses.slice(0, 5).every((status) => status === 404) &&
      bruteStatuses[5] === 429,
    bruteStatuses.join(','),
  );

  const tooLateCode = `PH-BK-${Date.now()}`;
  const { data: lateRow, error: lateInsertError } = await db
    .from('bookings')
    .insert({
      code: tooLateCode,
      name: 'ZZ TEST Too Late',
      phone: '+919000188888',
      date: today,
      start_time: localTime(new Date(Date.now() + 60 * 60_000)),
      party_size: 4,
      status: 'confirmed',
    })
    .select('code')
    .single();
  if (lateRow?.code) created.add(lateRow.code);
  ok(
    'too-late fixture inserted',
    !lateInsertError,
    lateInsertError?.message ?? '',
  );
  const tooLateCancel = await cancel({ code: tooLateCode, last4: '8888' });
  ok(
    'cancellation inside two hours is refused',
    tooLateCancel.status === 409,
    `${tooLateCancel.status}`,
  );

  if (happy.status === 201) {
    const beforeSlots = happyRow?.booking_slots?.length ?? 0;
    const cancelled = await cancel({ code: happy.json.code, last4: '9999' });
    const { count: slotsAfter } = await db
      .from('booking_slots')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', happyRow.id);
    ok(
      'valid cancellation succeeds and frees the slot row',
      cancelled.status === 200 && beforeSlots === 1 && slotsAfter === 0,
      `${cancelled.status}/${slotsAfter}`,
    );
    const again = await cancel({ code: happy.json.code, last4: '9999' });
    ok(
      'already-cancelled booking is refused',
      again.status === 409,
      `${again.status}`,
    );
  }

  // Race ten requests after filling all but one suitable slot.
  const race = await findOpenChoice(30, 2);
  let { data: raceAvailability } = await db.rpc('get_availability', {
    p_date: race.date,
    p_party: 4,
  });
  let raceRemaining = Number(
    raceAvailability.find((row) => row.start_time.slice(0, 5) === race.time)
      ?.remaining ?? 0,
  );
  while (raceRemaining > 1) {
    const blocker = await rpcBooking(race, {
      p_name: 'ZZ TEST Race Blocker',
      p_phone: `+91${nextPhone()}`,
    });
    if (blocker.error) throw blocker.error;
    raceRemaining -= 1;
  }
  const raceIp = nextIp();
  const racers = Array.from({ length: 10 }, () =>
    postBooking(good(race, { phone: nextPhone() }), { ip: raceIp }),
  );
  const raceResults = await Promise.all(racers);
  const raceStatuses = raceResults.map((result) => result.status);
  ok(
    'ten-way race has exactly one success and nine clean conflicts',
    raceStatuses.filter((status) => status === 201).length === 1 &&
      raceStatuses.filter((status) => status === 409).length === 9,
    raceStatuses.join(','),
  );
  const raceCodes = raceResults
    .filter((result) => result.status === 201)
    .map((result) => result.json.code);
  const { data: raceSlots } = await db
    .from('booking_slots')
    .select('slot_table_id,during,bookings!inner(code)')
    .in('bookings.code', [...created]);
  let overlaps = 0;
  const checkedRaceSlots = raceSlots ?? [];
  for (let left = 0; left < checkedRaceSlots.length; left += 1) {
    for (let right = left + 1; right < checkedRaceSlots.length; right += 1) {
      const a = checkedRaceSlots[left];
      const b = checkedRaceSlots[right];
      if (a.slot_table_id !== b.slot_table_id) continue;
      const [aStart, aEnd] = a.during.slice(1, -1).split(',');
      const [bStart, bEnd] = b.during.slice(1, -1).split(',');
      const clean = (value) => value.replaceAll('"', '').trim();
      if (
        new Date(clean(aStart)) < new Date(clean(bEnd)) &&
        new Date(clean(bStart)) < new Date(clean(aEnd))
      )
        overlaps += 1;
    }
  }
  ok(
    'booking_slots contains no overlap after the race',
    raceCodes.length === 1 && overlaps === 0,
    `${overlaps} overlaps`,
  );

  // Two simultaneous bookings with capacity for both receive different slots.
  const parallel = await findOpenChoice(30, 2);
  const parallelResults = await Promise.all([
    postBooking(good(parallel, { phone: nextPhone() }), { ip: nextIp() }),
    postBooking(good(parallel, { phone: nextPhone() }), { ip: nextIp() }),
  ]);
  ok(
    'two simultaneous bookings with two free slots both succeed',
    parallelResults.every((result) => result.status === 201),
    parallelResults.map((result) => result.status).join(','),
  );
  ok(
    'the simultaneous bookings receive different slot labels',
    parallelResults[0]?.json?.slotLabels?.[0] &&
      parallelResults[0].json.slotLabels[0] !==
        parallelResults[1]?.json?.slotLabels?.[0],
    parallelResults.map((result) => result.json?.slotLabels?.[0]).join(','),
  );
} catch (error) {
  failures += 1;
  console.log(`FAIL: script error: ${error?.message ?? error}`);
} finally {
  if (restorePh0200) await restorePh0200();
  const { data: strays } = await db
    .from('bookings')
    .select('code')
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  for (const row of strays ?? []) created.add(row.code);
  const codes = [...created];
  if (codes.length) await db.from('bookings').delete().in('code', codes);
  if (keys.size)
    await db
      .from('rate_limits')
      .delete()
      .in('key', [...keys]);
  const { count: bookingsLeft } = await db
    .from('bookings')
    .select('*', { count: 'exact', head: true })
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  const { count: slotsLeft } = await db
    .from('booking_slots')
    .select('*,bookings!inner(name,created_at)', { count: 'exact', head: true })
    .like('bookings.name', 'ZZ TEST%')
    .gte('bookings.created_at', startedAt);
  console.log(
    `CLEANUP: deleted ${codes.length} bookings and ${keys.size} rate-limit keys; test bookings left: ${bookingsLeft}; test slots left: ${slotsLeft}`,
  );
  console.log(
    failures
      ? `\n${failures} BOOKING CHECK(S) FAILED`
      : '\nALL BOOKING API CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
