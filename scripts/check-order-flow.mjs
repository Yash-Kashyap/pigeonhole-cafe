// End to end: cart -> /order form -> real submit -> confirmation page, in a real browser.
// Creates ONE real order named "ZZ TEST UI Guest" and deletes it afterwards (by its code).
// Needs the dev server on 127.0.0.1:4321 and migration 0003 applied.
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

const browser = await chromium.launch({ channel: 'chrome' });
const testIp = `198.51.100.${200 + Math.floor(Math.random() * 50)}`;
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: { 'x-ph-test-ip': testIp },
});
const page = await context.newPage();
const problems = [];
const requests = [];
page.on(
  'console',
  (m) => m.type() === 'error' && problems.push(m.text().slice(0, 160)),
);
page.on('pageerror', (e) =>
  problems.push(`pageerror: ${String(e).slice(0, 160)}`),
);
page.on('request', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/'))
    requests.push(`${r.method()} ${u.pathname}`);
});

let code = null;
try {
  await page.goto(`${base}/menu`, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    localStorage.setItem(
      'ph_cart_v1',
      JSON.stringify([
        { id: 'PH0003', quantity: 2, note: 'less sugar' },
        { id: 'PH0060', quantity: 1 },
      ]),
    ),
  );
  await page.goto(`${base}/order`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.fill('#order-name', 'ZZ TEST UI Guest');
  await page.fill('#order-phone', `9000${String(Date.now()).slice(-6)}`);
  const radios = await page.locator('input[name="pickup_mode"]').count();
  if (radios > 1)
    await page.locator('input[name="pickup_mode"]').nth(1).check();
  await page.waitForTimeout(400);
  const dates = await page
    .locator('#pickup-date-select option')
    .evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled })));
  const date = dates.find((o) => !o.d && o.v);
  ok('an orderable date exists in the date list', !!date);
  await page.selectOption('#pickup-date-select', date.v);
  await page.waitForTimeout(300);
  const times = await page
    .locator('#pickup-time-select option')
    .evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled })));
  const time = times.find((o) => !o.d && o.v);
  ok('an orderable time exists', !!time);
  await page.selectOption('#pickup-time-select', time.v);
  await page.locator('#order-consent').check();
  await page.waitForTimeout(3500); // the server refuses forms submitted in under 3 seconds

  await page.getByRole('button', { name: /place order/i }).click();
  await page.waitForURL(/\/order\/confirmed\?code=PH-ORD-\d+/, {
    timeout: 20000,
  });
  code = new URL(page.url()).searchParams.get('code');
  ok(
    'submit redirects to the confirmation page with a code',
    /^PH-ORD-\d{4,}$/.test(code ?? ''),
    code ?? '',
  );
  ok(
    'exactly one POST /api/orders was sent',
    requests.filter((r) => r === 'POST /api/orders').length === 1,
  );
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  ok(
    'cart is cleared after success',
    (await page.evaluate(() => localStorage.getItem('ph_cart_v1'))) === null,
  );

  const text = await page.locator('main').innerText();
  ok(
    'confirmation shows code, items and the database subtotal',
    text.includes(code) &&
      /Post Chai/.test(text) &&
      /Maska Pav/.test(text) &&
      /\$4\.20/.test(text),
  );
  ok('confirmation never shows the phone number', !/\b9000\d{6}\b/.test(text));
  await page.screenshot({ path: '.checks/order-confirmed-1280.png' });

  const { data: row } = await db
    .from('orders')
    .select('name,status,order_items(menu_item_id,qty,note)')
    .eq('code', code)
    .single();
  const chai = row?.order_items?.find((l) => l.menu_item_id === 'PH0003');
  ok(
    'database row has the line note and quantity',
    row?.name === 'ZZ TEST UI Guest' &&
      chai?.qty === 2 &&
      chai?.note === 'less sugar',
  );

  // live status polling and the status chip
  const pollsBefore = requests.filter((r) =>
    r.startsWith('GET /api/orders/PH-ORD'),
  ).length;
  await db.from('orders').update({ status: 'preparing' }).eq('code', code);
  await page
    .waitForFunction(
      () =>
        document
          .querySelector('#order-status')
          ?.textContent?.trim()
          .toLowerCase() === 'preparing',
      null,
      { timeout: 25000 },
    )
    .catch(() => {});
  const chip = (await page.locator('#order-status').innerText())
    .trim()
    .toLowerCase();
  ok(
    'status chip follows the database (new -> preparing) by polling',
    chip === 'preparing',
    chip,
  );
  ok(
    'polling sent status requests',
    requests.filter((r) => r.startsWith('GET /api/orders/PH-ORD')).length >
      pollsBefore,
  );

  // calendar and WhatsApp
  const href = await page
    .getByRole('link', { name: /add to calendar/i })
    .getAttribute('href');
  const ics = decodeURIComponent(
    href.replace(/^data:text\/calendar;charset=utf-8,/, ''),
  );
  ok(
    'calendar file has a start, end and the code',
    /DTSTART:\d{8}T\d{6}Z/.test(ics) &&
      /DTEND:\d{8}T\d{6}Z/.test(ics) &&
      ics.includes(code),
  );
  const wa = await page
    .getByRole('link', { name: /whatsapp/i })
    .getAttribute('href');
  ok(
    'WhatsApp link uses our redirect and no phone number',
    wa.startsWith('/whatsapp?text=') &&
      !wa.includes(process.env.PUBLIC_WHATSAPP_NUMBER),
  );
  ok(
    'WhatsApp text carries the code and items',
    decodeURIComponent(wa).includes(code) &&
      /2 × Post Chai/.test(decodeURIComponent(wa)),
  );

  // Order again restores the cart
  await page.getByRole('button', { name: /order again/i }).click();
  await page.waitForURL(/\/order$/, { timeout: 8000 }).catch(() => {});
  const cart = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ph_cart_v1') || '[]'),
  );
  ok(
    'Order again returns to /order with the cart restored',
    page.url().endsWith('/order') &&
      cart.reduce((n, i) => n + i.quantity, 0) === 3,
    `${page.url().replace(base, '')} ${JSON.stringify(cart)}`,
  );

  ok(
    'no console errors or page errors during the whole flow',
    problems.length === 0,
    problems[0] ?? '',
  );

  // unknown code
  const nf = await page.goto(`${base}/order/confirmed?code=PH-ORD-999999`);
  ok(
    'unknown code shows the not-found page with status 404',
    nf.status() === 404 &&
      /missing/i.test(await page.locator('main').innerText()),
  );

  // 360 px layout of the confirmation page
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 360, height: 800 });
  await phone.goto(`${base}/order/confirmed?code=${code}`, {
    waitUntil: 'networkidle',
  });
  const wide = await phone.evaluate(
    (vw) =>
      [...document.querySelectorAll('main *')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      }).length,
    360,
  );
  ok(
    'confirmation at 360px: nothing extends past the screen edge',
    wide === 0,
    `${wide} elements`,
  );
  ok(
    'confirmation at 360px: no horizontal scroll',
    (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 360,
  );
  await phone.screenshot({ path: '.checks/order-confirmed-360.png' });
} catch (error) {
  failures += 1;
  console.log(`FAIL: script error: ${String(error).slice(0, 240)}`);
} finally {
  if (code) {
    await db.from('orders').delete().eq('code', code);
    console.log(`CLEANUP: deleted ${code}`);
  }
  await browser.close();
  console.log(
    failures
      ? `\n${failures} CHECK(S) FAILED`
      : '\nALL ORDER FLOW CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
