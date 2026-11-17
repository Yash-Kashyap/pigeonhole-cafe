// Browser check for /menu. Needs the dev server on 127.0.0.1:4321.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const base = 'http://127.0.0.1:4321/menu';
mkdirSync('.checks', { recursive: true });
let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const browser = await chromium.launch({ channel: 'chrome' });

for (const [width, height] of [
  [360, 800],
  [768, 900],
  [1280, 900],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  ok(
    `/menu at ${width}px: no console errors`,
    errors.length === 0,
    errors[0] ?? '',
  );
  ok(
    `/menu at ${width}px: no horizontal scroll`,
    scrollWidth <= width,
    `scrollWidth ${scrollWidth}`,
  );
  await page.screenshot({ path: `.checks/menu-${width}.png` });
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(100);
const cards = page.locator('.menu-card');
// The page server-renders the first category, then React shows all items once hydrated.
const html = await (await page.request.get(base)).text();
const serverRendered = (html.match(/class="menu-card"/g) ?? []).length;
ok(
  'server-rendered HTML already has the first category',
  serverRendered > 0 && serverRendered < 240,
  `${serverRendered} cards before hydration`,
);
await page
  .waitForFunction(
    () => document.querySelectorAll('.menu-card').length > 100,
    null,
    { timeout: 15000 },
  )
  .catch(() => {});
const total = await cards.count();
ok('all 240 items render on All', total === 240, `count ${total}`);
ok(
  'Add buttons are enabled in Phase 2',
  (await page.locator('.menu-card button:not([disabled])').count()) > 0,
);
ok(
  'h1 reads "The menu"',
  (await page.locator('main h1').first().innerText()).trim() === 'The menu',
);

await page.getByRole('button', { name: 'Vegan', exact: true }).click();
await page.getByRole('button', { name: 'Gluten-free', exact: true }).click();
await page.waitForTimeout(300);
const vg = await cards.count();
const bad = await cards.evaluateAll(
  (els) =>
    els.filter(
      // The V badge reads "Vegan" and the GF badge reads "no gluten" for screen readers.
      (el) =>
        !/Vegan/.test(el.textContent) || !/no gluten/.test(el.textContent),
    ).length,
);
ok(
  'vegan AND gluten-free shows only matching items',
  vg > 0 && vg < total && bad === 0,
  `${vg} items, ${bad} wrong`,
);
ok(
  'URL mirrors the filters',
  /vegan=1/.test(page.url()) && /(gf|gluten)/i.test(page.url()),
  page.url().replace(base, ''),
);

const shared = page.url();
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page2.goto(shared, { waitUntil: 'networkidle' });
await page2.waitForTimeout(500);
ok(
  'shared URL restores the same result',
  (await page2.locator('.menu-card').count()) === vg,
);
await page2.close();

const clear = page
  .getByRole('button', { name: /clear (all )?filters/i })
  .first();
await clear.click();
await page.waitForTimeout(300);
ok('clear all restores 240 items', (await cards.count()) === 240);

const search = page.getByRole('searchbox');
await search.fill('jain');
await page.waitForTimeout(500);
const jain = await cards.count();
ok(
  'search "jain" finds Jain-option items',
  jain > 0 && jain < 240,
  `${jain} items`,
);
await search.fill('zzzzqq');
await page.waitForTimeout(500);
ok(
  'no-match search shows the empty state',
  (await cards.count()) === 0 &&
    (await page.getByText('Nothing matches those filters.').count()) > 0,
);
await search.fill('');
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Vegan under $3' }).click();
await page.waitForTimeout(300);
const under3 = await cards.evaluateAll((els) =>
  els.map((el) =>
    Number(
      (el.querySelector('span.font-mono')?.textContent ?? '').replace(
        /[^0-9.]/g,
        '',
      ),
    ),
  ),
);
ok(
  '"Vegan under $3" respects the price cap',
  under3.length > 0 && under3.every((p) => p <= 3),
  `${under3.length} items, max ${Math.max(...under3)}`,
);
await page
  .getByRole('button', { name: /clear (all )?filters/i })
  .first()
  .click();

const tabs = await page.getByRole('tab').count();
ok('category tabs: All plus 15', tabs === 16, `${tabs} tabs`);
const withNuts = await page.getByRole('button', { name: /nuts/i }).count();
ok(
  'avoid-allergen control for nuts exists',
  withNuts > 0 || (await page.getByLabel(/nuts/i).count()) > 0,
);

// keyboard: tab through the controls, focus must always be visible, no trap
await page.goto(base, { waitUntil: 'networkidle' });
let visibleFocus = 0;
let steps = 0;
for (; steps < 40; steps += 1) {
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    const s = getComputedStyle(el);
    const hasRing =
      (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
      s.boxShadow !== 'none';
    return hasRing ? 'ring' : 'none';
  });
  if (ring === 'ring') visibleFocus += 1;
}
ok(
  'keyboard: focus ring visible on most of 40 tab stops',
  visibleFocus >= 30,
  `${visibleFocus}/40`,
);

// availability must fail safe
const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page3.route('**/api/menu/availability', (r) => r.abort());
await page3.goto(base, { waitUntil: 'networkidle' });
await page3.waitForTimeout(600);
ok(
  'availability call blocked: nothing is marked sold out',
  (await page3.getByText('Sold out today').count()) === 0,
);
await page3.close();

const jsonLd = await page.evaluate(() =>
  [...document.querySelectorAll('script[type="application/ld+json"]')].map(
    (s) => {
      try {
        return JSON.parse(s.textContent)['@type'];
      } catch {
        return 'INVALID';
      }
    },
  ),
);
ok('JSON-LD parses as Menu', jsonLd.includes('Menu'), jsonLd.join(','));

await browser.close();
console.log(
  failures ? `\n${failures} CHECK(S) FAILED` : '\nALL MENU CHECKS PASSED',
);
process.exit(failures ? 1 : 0);
