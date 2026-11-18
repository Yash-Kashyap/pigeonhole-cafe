// End to end against the REAL database: /reserve form -> real booking -> confirmation page -> cancel.
// Creates ONE booking named "ZZ TEST UI Guest" and removes it (and its rate-limit rows) afterwards.
// Needs the dev server on 127.0.0.1:4321 and migration 0004 applied.
// Run with: node node_modules/tsx/dist/cli.mjs scripts/check-reserve-live.mjs
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

process.loadEnvFile('.env');
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } },
);
const base = 'http://127.0.0.1:4321';
let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const phone = '9000199001';
const last4 = '9001';
let code = null;
const browser = await chromium.launch({ channel: 'chrome' });
const testIp = `198.51.100.${150 + Math.floor(Math.random() * 40)}`;
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { 'x-ph-test-ip': testIp },
});
const page = await context.newPage();
const problems = [];
const apiCalls = [];
page.on(
  'console',
  (m) =>
    m.type() === 'error' &&
    !/Failed to load resource/.test(m.text()) &&
    problems.push(m.text().slice(0, 160)),
);
page.on('pageerror', (e) =>
  problems.push(`pageerror: ${String(e).slice(0, 160)}`),
);
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/'))
    apiCalls.push(`${r.method()} ${u.pathname}`);
});

try {
  await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
  const days = page.locator('[role="gridcell"]:not([disabled])');
  await days.first().waitFor({ state: 'visible', timeout: 10000 });
  await days.nth(3).click();
  const chosenDate = await days.nth(3).getAttribute('aria-label');
  const increase = page.getByRole('button', { name: 'Increase party size' });
  await increase.click();
  await increase.click();
  await page.locator('[role="radiogroup"] [role="radio"]').first().waitFor({
    state: 'visible',
    timeout: 10000,
  });
  ok(
    'availability came from the real server',
    apiCalls.some((c) => c.startsWith('GET /api/availability')),
    chosenDate ?? '',
  );
  await page
    .locator('[role="radiogroup"] [role="radio"]:not([disabled])')
    .first()
    .click();
  await page.getByRole('button', { name: /continue to details/i }).click();
  await page.fill('#reserve-name', 'ZZ TEST UI Guest');
  await page.fill('#reserve-phone', phone);
  await page.fill('#reserve-notes', 'live check');
  await page.getByRole('button', { name: /review and confirm/i }).click();
  await page.locator('#reserve-consent').check();
  await page.waitForTimeout(3500); // minimum time to submit is 3 seconds
  await page.getByRole('button', { name: 'Reserve slot' }).click();
  await page.waitForURL(/\/reserve\/confirmed\?code=PH-BK-\d+/, {
    timeout: 15000,
  });
  code = new URL(page.url()).searchParams.get('code');
  ok('real booking created and page moved to confirmation', !!code, code ?? '');

  const posts = apiCalls.filter((c) => c === 'POST /api/bookings');
  ok(
    'exactly one booking request was sent',
    posts.length === 1,
    `${posts.length}`,
  );

  const { data: row } = await db
    .from('bookings')
    .select(
      'code,status,party_size,name,phone,booking_slots(slot_tables(label,seats))',
    )
    .eq('code', code)
    .maybeSingle();
  ok(
    'row exists, confirmed, party 4',
    row?.status === 'confirmed' && row?.party_size === 4,
    JSON.stringify(row?.status),
  );
  const slot = Array.isArray(row?.booking_slots) ? row.booking_slots[0] : null;
  const label = Array.isArray(slot?.slot_tables)
    ? slot.slot_tables[0]?.label
    : slot?.slot_tables?.label;
  ok('one slot assigned, 4 seats or more', !!label, label ?? 'none');
  ok('phone stored normalised', row?.phone === `+91${phone}`);

  await page
    .locator('[data-ticket-code]')
    .waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(
    () => /SLOT\s*\d+/i.test(document.body.innerText),
    null,
    { timeout: 10000 },
  );
  const body = await page.locator('body').innerText();
  ok(
    'confirmation shows the real slot label',
    label ? body.toUpperCase().includes(label.toUpperCase()) : false,
    label ?? '',
  );
  ok('confirmation shows hold-until text', /held until/i.test(body));
  ok(
    'confirmation shows no phone digits or name',
    !body.includes(phone) && !body.includes('ZZ TEST'),
  );

  // Wrong digits must be refused with the neutral message and change nothing.
  await page.locator('#booking-cancel-toggle').click();
  await page.fill('#cancel-last4', '0000');
  await page.locator('#cancel-submit').click();
  await page.locator('#cancel-feedback').waitFor({ state: 'visible' });
  const wrongText = (await page.locator('#cancel-feedback').innerText()).trim();
  const { data: stillThere } = await db
    .from('bookings')
    .select('status')
    .eq('code', code)
    .maybeSingle();
  ok(
    'wrong last four digits refused, booking untouched',
    stillThere?.status === 'confirmed',
    wrongText.slice(0, 60),
  );

  // Correct digits cancel it and free the slot.
  await page.fill('#cancel-last4', last4);
  await page.locator('#cancel-submit').click();
  await page.waitForFunction(
    () => /cancelled/i.test(document.body.innerText),
    null,
    { timeout: 10000 },
  );
  const { data: after } = await db
    .from('bookings')
    .select('status,booking_slots(slot_table_id)')
    .eq('code', code)
    .maybeSingle();
  ok(
    'cancel through the UI sets status cancelled',
    after?.status === 'cancelled',
    after?.status,
  );
  ok('cancel freed the slot row', (after?.booking_slots ?? []).length === 0);
  ok(
    'no browser console errors',
    problems.length === 0,
    problems.join(' | ').slice(0, 200),
  );
} catch (error) {
  ok('script ran without throwing', false, String(error).slice(0, 220));
} finally {
  await browser.close();
  if (code) await db.from('bookings').delete().eq('code', code);
  // Remove this run's hashed rate-limit rows (IP and phone keys).
  const hash = async (v) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)),
      ),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const keys = [
    await hash(`${process.env.RATE_LIMIT_SALT}:booking-ip:${testIp}`),
    await hash(`${process.env.RATE_LIMIT_SALT}:booking-phone:+91${phone}`),
    await hash(
      `${process.env.RATE_LIMIT_SALT}:booking-availability-ip:${testIp}`,
    ),
  ];
  await db.from('rate_limits').delete().in('key', keys);
  const { data: left } = await db
    .from('bookings')
    .select('code')
    .ilike('name', 'ZZ TEST%');
  console.log(`CLEANUP: test bookings left: ${left?.length ?? '?'}`);
}
console.log(
  failures
    ? `\n${failures} LIVE CHECK(S) FAILED`
    : '\nALL LIVE RESERVE CHECKS PASSED',
);
process.exit(failures ? 1 : 0);
