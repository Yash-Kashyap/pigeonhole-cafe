// Live attack checks for POST /api/enquiries.
// Needs the dev server on 127.0.0.1:4321 and the existing database schema.
// Run with: node node_modules/tsx/dist/cli.mjs scripts/check-enquiries-api.mjs
// It creates only enquiries named "ZZ TEST" and removes those rows and its rate-limit keys.
import { createClient } from '@supabase/supabase-js';
import { getBookableDates, getBookableTimes } from '../src/lib/rules.ts';

process.loadEnvFile('.env');
const base = 'http://127.0.0.1:4321';
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-enquiry-check/1.0' } },
  },
);

let failures = 0;
const keys = new Set();
const created = new Set();
const startedAt = new Date().toISOString();
const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
});
const localWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
});
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
const normalisePhone = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\+?\d+$/.test(text)) return null;
  const digits = text.replace(/^\+/, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  return null;
};

let ipCounter = 1;
const nextIp = () => `198.51.100.${ipCounter++}`;
let phoneCounter = 1;
const nextPhone = () => `90004${String(phoneCounter++).padStart(5, '0')}`;

async function rememberKeys(body, ip) {
  keys.add(await hash(`${process.env.RATE_LIMIT_SALT}:enquiry-ip:${ip}`));
  const phone = normalisePhone(body?.phone);
  if (phone)
    keys.add(
      await hash(`${process.env.RATE_LIMIT_SALT}:enquiry-phone:${phone}`),
    );
}

async function post(
  body,
  { ip = nextIp(), headers = {}, raw, origin = base } = {},
) {
  await rememberKeys(body, ip);
  const requestHeaders = {
    Origin: origin,
    'Content-Type': 'application/json',
    'x-ph-test-ip': ip,
    ...headers,
  };
  if (origin === null) delete requestHeaders.Origin;
  const response = await fetch(`${base}/api/enquiries`, {
    method: 'POST',
    headers: requestHeaders,
    body: raw ?? JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Assertions below report malformed JSON.
  }
  return { status: response.status, json, text, headers: response.headers };
}

const atIst = (date, time) => new Date(`${date}T${time}:00+05:30`);
function findPrivateTableChoice() {
  const now = new Date();
  for (const date of getBookableDates(now)) {
    for (const time of getBookableTimes(date, now)) {
      if (atIst(date, time).getTime() - now.getTime() >= 26 * 3_600_000)
        return { date, time };
    }
  }
  throw new Error('No valid private-table time was found.');
}

const mountedAt = () => Date.now() - 5_000;
const openMic = (over = {}) => ({
  kind: 'open_mic',
  name: 'ZZ TEST Performer',
  phone: nextPhone(),
  performanceType: 'Music',
  notes: 'Two songs',
  consent: true,
  honeypot: '',
  mountedAt: mountedAt(),
  ...over,
});
const privateTable = (choice, over = {}) => ({
  kind: 'private_table',
  name: 'ZZ TEST Private Table',
  phone: nextPhone(),
  date: choice.date,
  time: choice.time,
  partySize: 8,
  occasion: 'Birthday',
  notes: 'Near a plug point',
  honeypot: '',
  mountedAt: mountedAt(),
  ...over,
});
const general = (over = {}) => ({
  kind: 'general',
  name: 'ZZ TEST General',
  email: 'zz-test@example.com',
  message: 'Please confirm the accessibility details.',
  honeypot: '',
  mountedAt: mountedAt(),
  ...over,
});

async function rowForName(name) {
  // The name is compared in code, not in the URL: names such as the injection
  // test string are blocked by the database host's firewall when used as a filter.
  const { data, error } = await db
    .from('enquiries')
    .select('id,kind,name,phone,email,payload,status')
    .gte('created_at', startedAt);
  if (error) throw error;
  const row = (data ?? []).find((candidate) => candidate.name === name) ?? null;
  if (row?.id) created.add(row.id);
  return row;
}

try {
  const choice = findPrivateTableChoice();
  console.log(
    `Private-table check uses ${choice.date} ${choice.time} Asia/Kolkata.`,
  );

  const openBody = openMic({
    name: 'ZZ TEST Valid Performer',
    phone: '9000499901',
    performanceType: 'Poetry',
    notes: 'Two short poems',
  });
  const openResult = await post(openBody);
  ok(
    'valid open-mic enquiry returns a private reference',
    openResult.status === 201 &&
      /^ENQ-[A-F0-9]{8}$/.test(openResult.json?.reference ?? '') &&
      !openResult.text.includes(openBody.phone),
    `${openResult.status} ${openResult.text.slice(0, 100)}`,
  );
  const openRow = await rowForName(openBody.name);
  ok(
    'open-mic row stores normalized contact and exact payload keys',
    openRow?.kind === 'open_mic' &&
      openRow.phone === '+919000499901' &&
      openRow.email === null &&
      JSON.stringify(openRow.payload) ===
        JSON.stringify({
          notes: 'Two short poems',
          performanceType: 'Poetry',
        }) &&
      openRow.status === 'new',
    JSON.stringify(openRow?.payload),
  );

  const privateBody = privateTable(choice, {
    name: 'ZZ TEST Valid Private Table',
    phone: '9000499902',
    occasion: 'Study group',
  });
  const privateResult = await post(privateBody);
  ok(
    'valid private-table enquiry returns 201 without phone data',
    privateResult.status === 201 &&
      !privateResult.text.includes(privateBody.phone),
    `${privateResult.status}`,
  );
  const privateRow = await rowForName(privateBody.name);
  ok(
    'private-table row stores only documented payload fields',
    privateRow?.kind === 'private_table' &&
      privateRow.phone === '+919000499902' &&
      Object.keys(privateRow.payload).sort().join(',') ===
        'date,notes,occasion,partySize,time' &&
      privateRow.payload.date === choice.date &&
      privateRow.payload.time === choice.time &&
      privateRow.payload.partySize === 8,
    JSON.stringify(privateRow?.payload),
  );

  const generalBody = general({
    name: 'ZZ TEST Valid General',
    email: 'ZZ-Test-General@Example.com',
  });
  const generalResult = await post(generalBody);
  ok(
    'valid email-only general enquiry returns 201 without contact data',
    generalResult.status === 201 &&
      !generalResult.text.toLowerCase().includes('zz-test-general'),
    `${generalResult.status}`,
  );
  const generalRow = await rowForName(generalBody.name);
  ok(
    'general row normalizes email and stores only the message payload',
    generalRow?.kind === 'general' &&
      generalRow.phone === null &&
      generalRow.email === 'zz-test-general@example.com' &&
      Object.keys(generalRow.payload).join(',') === 'message',
    JSON.stringify(generalRow),
  );

  const schemaCases = [
    ['missing kind', { ...general(), kind: undefined }],
    ['unknown kind', { ...general(), kind: 'complaint' }],
    ['unknown top-level key', { ...openMic(), status: 'done' }],
    ['cross-kind field', { ...general(), performanceType: 'Music' }],
    ['missing name', openMic({ name: undefined })],
    ['short name', openMic({ name: 'Z' })],
    ['long name', openMic({ name: `ZZ TEST ${'x'.repeat(60)}` })],
    ['name control character', openMic({ name: 'ZZ TEST\nName' })],
    ['bad phone', openMic({ phone: 'not-a-phone' })],
    ['missing open-mic phone', openMic({ phone: undefined })],
    ['phone control character', openMic({ phone: '90004\n00001' })],
    ['missing performance type', openMic({ performanceType: undefined })],
    ['bad performance type', openMic({ performanceType: 'Dance' })],
    ['non-text open-mic notes', openMic({ notes: 123 })],
    ['long open-mic notes', openMic({ notes: 'x'.repeat(201) })],
    ['open-mic notes control character', openMic({ notes: 'Bad\nnotes' })],
    ['false consent', openMic({ consent: false })],
    ['missing consent', openMic({ consent: undefined })],
    ['missing private-table phone', privateTable(choice, { phone: undefined })],
    ['missing private-table date', privateTable(choice, { date: undefined })],
    ['missing private-table time', privateTable(choice, { time: undefined })],
    ['missing party size', privateTable(choice, { partySize: undefined })],
    ['party below seven', privateTable(choice, { partySize: 6 })],
    ['party above twelve', privateTable(choice, { partySize: 13 })],
    ['party string', privateTable(choice, { partySize: '8' })],
    ['party fraction', privateTable(choice, { partySize: 8.5 })],
    ['missing occasion', privateTable(choice, { occasion: undefined })],
    ['bad occasion', privateTable(choice, { occasion: 'Wedding' })],
    ['non-text private notes', privateTable(choice, { notes: 123 })],
    ['long private notes', privateTable(choice, { notes: 'x'.repeat(201) })],
    [
      'private notes control character',
      privateTable(choice, { notes: 'Bad\tnotes' }),
    ],
    [
      'missing general contact',
      general({ email: undefined, phone: undefined }),
    ],
    ['bad general email', general({ email: 'not-an-email' })],
    ['bad optional general phone', general({ phone: '123' })],
    ['missing general message', general({ message: undefined })],
    ['non-text general message', general({ message: 123 })],
    ['short general message', general({ message: 'Four' })],
    ['long general message', general({ message: 'x'.repeat(1_001) })],
    ['general message control character', general({ message: 'Bad\nmessage' })],
  ];
  const schemaMessages = new Set();
  for (const [label, body] of schemaCases) {
    const result = await post(body);
    schemaMessages.add(result.text);
    ok(`${label} is rejected`, result.status === 400, `${result.status}`);
  }
  ok(
    'schema failures use one generic response',
    schemaMessages.size === 1,
    `${schemaMessages.size} responses`,
  );

  const today = new Date();
  const localDate = localDateFormatter.format(today);
  const dates = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(today.getTime() + index * 86_400_000);
    return localDateFormatter.format(date);
  });
  const monday = dates.find(
    (date) =>
      localWeekdayFormatter.format(new Date(`${date}T12:00:00+05:30`)) ===
      'Mon',
  );
  const bookingRuleCases = [
    ['malformed date', privateTable(choice, { date: 'tomorrow' })],
    ['impossible date', privateTable(choice, { date: '2026-02-30' })],
    ['closed Monday', privateTable(choice, { date: monday, time: '12:00' })],
    ['off-step time', privateTable(choice, { time: '12:15' })],
    ['before opening', privateTable(choice, { time: '04:00' })],
    [
      'outside 30 days',
      privateTable(choice, { date: dates[34], time: '12:00' }),
    ],
  ];
  const sameDayTimes = getBookableTimes(localDate, new Date());
  const insideTwoHours = (() => {
    for (let minutes = 7 * 60; minutes <= 22 * 60; minutes += 30) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      const difference = atIst(localDate, time).getTime() - Date.now();
      if (difference > 0 && difference < 2 * 3_600_000) return time;
    }
    return null;
  })();
  if (insideTwoHours)
    bookingRuleCases.push([
      'inside two-hour cutoff',
      privateTable(choice, {
        date: localDate,
        time: insideTwoHours,
        partySize: 7,
      }),
    ]);
  else
    ok(
      'inside two-hour cutoff has a suitable same-day wall-clock fixture',
      sameDayTimes.length === 0,
      'no open start inside two hours at this wall clock',
    );
  for (const [label, body] of bookingRuleCases) {
    const result = await post(body);
    ok(
      `${label} is rejected by booking rules`,
      result.status === (label === 'malformed date' ? 400 : 422),
      `${result.status}`,
    );
  }

  const botCases = [
    ['filled honeypot', openMic({ honeypot: 'spam' })],
    ['missing honeypot', openMic({ honeypot: undefined })],
    ['too fast', openMic({ mountedAt: Date.now() - 500 })],
    ['future mounted time', openMic({ mountedAt: Date.now() + 60_000 })],
    ['stale mounted time', openMic({ mountedAt: Date.now() - 90_000_000 })],
    ['invalid mounted time', openMic({ mountedAt: 'soon' })],
  ];
  for (const [label, body] of botCases) {
    const result = await post(body);
    ok(`${label} is rejected`, result.status === 400, `${result.status}`);
  }

  const missingOrigin = await post(general(), { origin: null });
  const foreignOrigin = await post(general(), {
    origin: 'https://evil.example',
  });
  const wrongType = await post(general(), {
    headers: { 'Content-Type': 'text/plain' },
  });
  const oversized = await post(null, {
    raw: JSON.stringify({ pad: 'x'.repeat(20_000) }),
  });
  const invalidJson = await post(null, { raw: '{not json' });
  ok(
    'missing Origin is rejected',
    missingOrigin.status === 400,
    `${missingOrigin.status}`,
  );
  ok(
    'foreign Origin is rejected',
    foreignOrigin.status === 400,
    `${foreignOrigin.status}`,
  );
  ok(
    'wrong content type is rejected',
    wrongType.status === 400,
    `${wrongType.status}`,
  );
  ok(
    'body over 16 KB is rejected',
    oversized.status === 400,
    `${oversized.status}`,
  );
  ok(
    'invalid JSON is rejected',
    invalidJson.status === 400,
    `${invalidJson.status}`,
  );
  const getMethod = await fetch(`${base}/api/enquiries`);
  ok(
    'GET is not allowed',
    [404, 405].includes(getMethod.status),
    `${getMethod.status}`,
  );

  const injectionBody = general({
    name: "ZZ TEST ' OR 1=1 --",
    phone: nextPhone(),
    email: undefined,
    message: '<script>alert(1)</script> Please keep this as plain text.',
  });
  const injection = await post(injectionBody);
  const injectionRow = await rowForName(injectionBody.name);
  ok(
    'injection strings are stored as plain text without markup execution',
    injection.status === 201 &&
      injectionRow?.name === injectionBody.name &&
      injectionRow?.payload?.message ===
        'alert(1) Please keep this as plain text.' &&
      !JSON.stringify(injectionRow).includes('<script>'),
    `${injection.status}`,
  );

  const ipFloodAddress = nextIp();
  const ipFlood = [];
  for (let index = 0; index < 11; index += 1)
    ipFlood.push(
      await post(openMic({ phone: nextPhone() }), { ip: ipFloodAddress }),
    );
  ok(
    'IP limit allows ten enquiries an hour and rejects the eleventh',
    ipFlood.slice(0, 10).every((result) => result.status === 201) &&
      ipFlood[10]?.status === 429 &&
      ipFlood[10]?.headers.get('retry-after') === '3600',
    ipFlood.map((result) => result.status).join(','),
  );

  const sharedPhone = nextPhone();
  const phoneFlood = [];
  for (let index = 0; index < 4; index += 1)
    phoneFlood.push(
      await post(openMic({ phone: sharedPhone }), { ip: nextIp() }),
    );
  ok(
    'phone limit allows three enquiries across IPs and rejects the fourth',
    phoneFlood.slice(0, 3).every((result) => result.status === 201) &&
      phoneFlood[3]?.status === 429,
    phoneFlood.map((result) => result.status).join(','),
  );

  const raceIp = nextIp();
  const race = await Promise.all(
    Array.from({ length: 15 }, (_, index) =>
      post(
        general({
          name: `ZZ TEST Parallel ${index + 1}`,
          email: undefined,
          phone: nextPhone(),
        }),
        { ip: raceIp },
      ),
    ),
  );
  ok(
    'fifteen parallel submissions from one IP have exactly ten successes',
    race.filter((result) => result.status === 201).length === 10 &&
      race.filter((result) => result.status === 429).length === 5,
    race.map((result) => result.status).join(','),
  );

  const { data: limitRows, error: limitError } = await db
    .from('rate_limits')
    .select('key')
    .in('key', [...keys]);
  if (limitError) throw limitError;
  ok(
    'rate-limit rows contain only salted hashes',
    (limitRows ?? []).length > 0 &&
      limitRows.every((row) => /^[0-9a-f]{64}$/.test(row.key)),
  );

  const ownerResponse = await fetch(`${base}/api/owner/enquiries`);
  ok(
    'owner enquiry API is unavailable without a session',
    ownerResponse.status === 401,
    `${ownerResponse.status}`,
  );

  ok(
    'API responses are no-store JSON without sensitive configuration',
    openResult.headers.get('cache-control') === 'no-store' &&
      openResult.headers.get('content-type')?.startsWith('application/json') &&
      ![openResult.text, privateResult.text, generalResult.text]
        .join('\n')
        .includes(process.env.SUPABASE_SERVICE_KEY) &&
      ![openResult.text, privateResult.text, generalResult.text]
        .join('\n')
        .includes(process.env.RATE_LIMIT_SALT),
  );
} catch (error) {
  failures += 1;
  console.log(`FAIL: suite error: ${error?.message ?? error}`);
} finally {
  const { data: strays } = await db
    .from('enquiries')
    .select('id')
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  for (const row of strays ?? []) created.add(row.id);
  if (created.size)
    await db
      .from('enquiries')
      .delete()
      .in('id', [...created]);
  if (keys.size)
    await db
      .from('rate_limits')
      .delete()
      .in('key', [...keys]);
  const { count } = await db
    .from('enquiries')
    .select('*', { count: 'exact', head: true })
    .like('name', 'ZZ TEST%')
    .gte('created_at', startedAt);
  console.log(
    `CLEANUP: deleted ${created.size} enquiries and ${keys.size} rate-limit keys; test rows left: ${count}.`,
  );
  console.log(
    failures
      ? `\n${failures} ENQUIRY CHECK(S) FAILED`
      : '\nALL ENQUIRY API CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
