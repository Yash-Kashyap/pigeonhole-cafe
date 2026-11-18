// Browser check for Phase 4b: /owner/app dashboard screens.
// Logs in with the demo owner from .demo-credentials, visits all five screens at
// 390 px and 1024 px, advances one temporary ZZ TEST order, logs out, and cleans up.
// Dev server must be running on 127.0.0.1:4321.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, readFileSync } from 'node:fs';

process.loadEnvFile('.env');
mkdirSync('.checks', { recursive: true });

const base = 'http://127.0.0.1:4321';
const credentials = readFileSync('.demo-credentials', 'utf8');
const ownerEmail = /^Email: (.+)$/m.exec(credentials)?.[1]?.trim();
const ownerPassword = /^Password: (.+)$/m.exec(credentials)?.[1]?.trim();
if (!ownerEmail || !ownerPassword) {
  throw new Error('Demo owner credentials are missing from .demo-credentials.');
}

const service = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'User-Agent': 'PigeonholeCafe-owner-ui-check/1.0' } },
  },
);

let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const screens = [
  { path: '/owner/app', heading: 'Today' },
  { path: '/owner/app/orders', heading: 'Orders' },
  { path: '/owner/app/bookings', heading: 'Bookings' },
  { path: '/owner/app/inbox', heading: 'Inbox' },
  { path: '/owner/app/menu', heading: 'Menu' },
];

let createdOrderId = null;
const testOrderCode = `ZZ-UI-ORD-${Date.now().toString().slice(-6)}`;

async function createTempOrder() {
  const { data: menuItem, error: menuError } = await service
    .from('menu_items')
    .select('id,name,price_usd')
    .eq('available', true)
    .limit(1)
    .single();
  if (menuError || !menuItem) {
    throw new Error('Could not find an available menu item for UI check.');
  }

  const now = new Date();
  const pickupAt = new Date(now.getTime() + 25 * 60_000).toISOString();
  const { data: order, error: orderError } = await service
    .from('orders')
    .insert({
      code: testOrderCode,
      name: 'ZZ TEST UI Order Guest',
      phone: '+919876543210',
      pickup_at: pickupAt,
      notes: 'Counter UI check order',
      subtotal: Number(menuItem.price_usd),
      status: 'new',
      source: 'site',
      seeded: false,
      created_at: new Date(now.getTime() + 60_000).toISOString(),
    })
    .select('id')
    .single();
  if (orderError || !order) {
    throw new Error(
      `Could not create temp order: ${orderError?.message ?? ''}`,
    );
  }
  createdOrderId = order.id;

  const { error: itemError } = await service.from('order_items').insert({
    order_id: createdOrderId,
    menu_item_id: menuItem.id,
    name_snapshot: menuItem.name,
    price_snapshot: Number(menuItem.price_usd),
    qty: 1,
    note: 'Extra hot',
  });
  if (itemError) {
    throw new Error(`Could not create temp order item: ${itemError.message}`);
  }
}

async function cleanupTempOrder() {
  if (!createdOrderId) return;
  await service.from('orders').delete().eq('id', createdOrderId);
  createdOrderId = null;
}

const browser = await chromium.launch({ channel: 'chrome' });

try {
  await createTempOrder();

  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(String(err));
  });

  // 1. Sign in via /owner
  await page.goto(`${base}/owner`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ownerEmail);
  await page.fill('input[name="password"]', ownerPassword);
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/owner/app', {
      timeout: 15_000,
    }),
    page.click('#owner-login-form button[type="submit"]'),
  ]);
  ok(
    'Owner sign in redirects to /owner/app',
    page.url().endsWith('/owner/app'),
  );

  // 2. Visit all 5 screens at 1024 px and 390 px
  for (const [width, height] of [
    [1024, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    for (const screen of screens) {
      const errorStart = consoleErrors.length;
      await page.goto(`${base}${screen.path}`, { waitUntil: 'networkidle' });
      await page
        .getByRole('heading', { level: 1, name: screen.heading })
        .waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(400);

      const newErrors = consoleErrors.slice(errorStart);
      ok(
        `${screen.path} at ${width}px: no console errors`,
        newErrors.length === 0,
        newErrors[0] ?? '',
      );

      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        robots:
          document
            .querySelector('meta[name="robots"]')
            ?.getAttribute('content') ?? '',
        hasDisclosure: document.body.innerText.includes(
          'Demo area. Data shown is fictional.',
        ),
        hasRealtimePill: Boolean(
          document.querySelector('[data-realtime-pill]'),
        ),
        localStorageValues: Object.values(localStorage),
      }));

      ok(
        `${screen.path} at ${width}px: no horizontal overflow`,
        metrics.scrollWidth <= width,
        `scrollWidth=${metrics.scrollWidth} viewport=${width}`,
      );
      ok(
        `${screen.path} at ${width}px: noindex meta and footer disclosure`,
        metrics.robots.includes('noindex') &&
          metrics.hasDisclosure &&
          metrics.hasRealtimePill,
        `robots=${metrics.robots}`,
      );
      const tokenInStorage = metrics.localStorageValues.some((value) =>
        /^eyJ[A-Za-z0-9_-]+\./.test(value),
      );
      ok(
        `${screen.path} at ${width}px: realtime token not in localStorage`,
        !tokenInStorage,
      );
    }
  }

  // 3. Advance our temporary ZZ TEST order from new -> preparing on /owner/app/orders
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${base}/owner/app/orders`, { waitUntil: 'networkidle' });

  const orderCard = page.locator(
    `[data-orders-kanban] [data-order-card="${testOrderCode}"]`,
  );
  await orderCard.waitFor({ state: 'visible', timeout: 15_000 });
  ok(
    'Orders Kanban shows temporary new order',
    (await orderCard.getAttribute('data-order-status')) === 'new',
  );

  const waHref = await orderCard
    .locator('a', { hasText: 'Message on WhatsApp' })
    .getAttribute('href');
  ok(
    'Order card WhatsApp link prefills ready message with real order code',
    Boolean(
      waHref &&
      waHref.startsWith('https://wa.me/919876543210') &&
      waHref.includes(
        encodeURIComponent(`Your order ${testOrderCode} is ready`),
      ),
    ),
    waHref ?? '',
  );

  await orderCard.getByRole('button', { name: 'Start preparing' }).click();
  await page
    .locator(
      `[data-orders-kanban] [data-order-card="${testOrderCode}"][data-order-status="preparing"]`,
    )
    .waitFor({ state: 'visible', timeout: 15_000 });
  ok('Advancing order status moves card to Preparing', true);

  // 4. Verify Menu search and disabled Save when unchanged
  await page.goto(`${base}/owner/app/menu`, { waitUntil: 'networkidle' });
  const firstMenuRow = page.locator('[data-menu-row]').first();
  await firstMenuRow.waitFor({ state: 'visible', timeout: 15_000 });
  const saveDisabled = await firstMenuRow
    .getByRole('button', { name: 'Save' })
    .isDisabled();
  ok('Menu Save button is disabled when row is unchanged', saveDisabled);

  // 5. Log out and verify protected route redirects to /owner
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/owner', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Log out' }).click(),
  ]);
  ok('Log out redirects to /owner', new URL(page.url()).pathname === '/owner');

  await page.goto(`${base}/owner/app`, { waitUntil: 'networkidle' });
  ok(
    'Protected /owner/app redirects back to /owner after logout',
    new URL(page.url()).pathname === '/owner',
  );

  await context.close();
} finally {
  await cleanupTempOrder();
  await browser.close();
}

if (failures > 0) {
  console.error(`\nOwner UI check failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log('\nOwner UI check passed.');
