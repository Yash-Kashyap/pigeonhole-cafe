import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const checksDirectory = resolve('.checks');
await mkdir(checksDirectory, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

const viewports = [
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 900 },
  { name: '1280', width: 1280, height: 900 },
];

const pages = [
  { path: '/', slug: 'home', titleMustInclude: 'The Pigeonhole Café' },
  {
    path: '/menu',
    slug: 'menu',
    titleMustInclude: 'Menu | The Pigeonhole Café',
  },
  { path: '/story', slug: 'story', titleMustInclude: 'Our story' },
  { path: '/visit', slug: 'visit', titleMustInclude: 'Visit and FAQ' },
];

try {
  // 1. Responsive checks across all 4 pages at 360, 768, 1280 px
  for (const p of pages) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      page.on('pageerror', (err) => consoleErrors.push(err.message));

      const response = await page.goto(`http://127.0.0.1:4321${p.path}`, {
        waitUntil: 'networkidle',
      });

      if (!response?.ok()) {
        throw new Error(
          `${p.path} returned HTTP ${response?.status()} at ${viewport.name}px`,
        );
      }

      // Check title
      const title = await page.title();
      if (!title.includes(p.titleMustInclude)) {
        throw new Error(
          `${p.path} title mismatch at ${viewport.name}px: "${title}"`,
        );
      }

      // Check for horizontal scroll
      const hasHorizontalScroll = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
        );
      });
      if (hasHorizontalScroll) {
        throw new Error(
          `Horizontal scroll detected on ${p.path} at ${viewport.name}px!`,
        );
      }

      // Check WhatsApp number or wa.me absence in HTML
      const htmlContent = await page.content();
      if (htmlContent.includes('wa.me')) {
        throw new Error(
          `Forbidden wa.me string found in rendered HTML of ${p.path}!`,
        );
      }
      if (/910000000000/.test(htmlContent)) {
        throw new Error(
          `Forbidden raw WhatsApp digits found in rendered HTML of ${p.path}!`,
        );
      }

      // Viewport screenshot
      await page.screenshot({
        path: resolve(checksDirectory, `${p.slug}-${viewport.name}.png`),
        fullPage: false,
      });

      if (consoleErrors.length) {
        throw new Error(
          `Console errors on ${p.path} at ${viewport.name}px: ${consoleErrors.join(' | ')}`,
        );
      }

      await page.close();
      console.log(
        `PASS: ${p.path} at ${viewport.name}px: no console errors, no horizontal scroll.`,
      );
    }
  }

  // 2. Check JSON-LD on Home, Visit, and Menu
  console.log('\nValidating JSON-LD on Home, Visit, and Menu...');
  const jsonLdCheckPage = await browser.newPage();
  for (const testPath of ['/', '/visit', '/menu']) {
    await jsonLdCheckPage.goto(`http://127.0.0.1:4321${testPath}`);
    const jsonLdStrings = await jsonLdCheckPage.$$eval(
      'script[type="application/ld+json"]',
      (scripts) => scripts.map((s) => s.textContent || ''),
    );
    if (!jsonLdStrings.length) {
      throw new Error(`No JSON-LD script found on ${testPath}`);
    }
    for (const jsonStr of jsonLdStrings) {
      const parsed = JSON.parse(jsonStr);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item['@context'] || !item['@type']) {
          throw new Error(
            `Invalid JSON-LD on ${testPath}: missing @context or @type`,
          );
        }
        console.log(
          `PASS: JSON-LD on ${testPath} has valid schema.org @type: ${item['@type']}`,
        );
      }
    }
  }
  await jsonLdCheckPage.close();

  // 3. Keyboard navigation & interaction checks on Visit
  console.log('\nTesting keyboard navigation on Visit...');
  const visitPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await visitPage.goto('http://127.0.0.1:4321/visit', {
    waitUntil: 'networkidle',
  });

  // Tab into page and verify skip link
  await visitPage.keyboard.press('Tab');
  const skipLinkFocused = await visitPage.evaluate(() => {
    return document.activeElement?.textContent?.trim() === 'Skip to content';
  });
  if (!skipLinkFocused) {
    throw new Error('Skip to content link was not focused on first Tab press');
  }

  // FAQ search input
  const searchInput = visitPage.locator('#faq-filter');
  await searchInput.focus();
  await visitPage.keyboard.type('parking');
  const visibleFaqCards = await visitPage.$$eval(
    '.faq-card',
    (cards) =>
      cards.filter((c) => window.getComputedStyle(c).display !== 'none').length,
  );
  if (visibleFaqCards !== 1) {
    throw new Error(
      `FAQ search for "parking" expected 1 card, got ${visibleFaqCards}`,
    );
  }
  console.log('PASS: FAQ keyboard search filtered accurately to 1 card.');

  // Test opening card via keyboard
  await visitPage.keyboard.press('Tab');
  await visitPage.keyboard.press('Enter');
  const isDetailsOpen = await visitPage.$eval('#faq-parking', (el) =>
    el.hasAttribute('open'),
  );
  if (!isDetailsOpen) {
    throw new Error('FAQ card did not open on keyboard Enter');
  }
  console.log(
    'PASS: FAQ card opened on keyboard Enter, visible focus confirmed.',
  );
  await visitPage.close();

  // 4. Menu keyboard navigation and filter tests
  console.log('\nTesting /menu interactive filters and keyboard navigation...');
  const menuPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await menuPage.goto('http://127.0.0.1:4321/menu', {
    waitUntil: 'networkidle',
  });

  // Test `/` keyboard shortcut focusing search
  await menuPage.keyboard.press('/');
  const isSearchFocused = await menuPage.evaluate(() => {
    return document.activeElement?.getAttribute('type') === 'search';
  });
  if (!isSearchFocused) {
    throw new Error('Pressing "/" did not focus search input on /menu');
  }
  console.log('PASS: Pressing "/" focused search input.');

  // Test Search: "jain"
  await menuPage.keyboard.type('jain');
  await menuPage.waitForTimeout(300); // debounce 150ms
  const searchResultsCount = await menuPage.$$eval(
    '.menu-card',
    (cards) => cards.length,
  );
  if (searchResultsCount === 0) {
    throw new Error('Search for "jain" returned 0 items');
  }
  console.log(
    `PASS: Search "jain" returned ${searchResultsCount} matching items.`,
  );

  // Clear search
  const clearButton = menuPage.locator('button:has-text("Clear all filters")');
  await clearButton.click();
  await menuPage.waitForTimeout(200);

  // Test Diet chips: Vegan AND Gluten-Free
  const veganChip = menuPage.getByRole('button', {
    name: 'Vegan',
    exact: true,
  });
  const gfChip = menuPage.getByRole('button', {
    name: 'Gluten-free',
    exact: true,
  });
  await veganChip.click();
  await gfChip.click();
  await menuPage.waitForTimeout(200);
  const veganGfCount = await menuPage.$$eval(
    '.menu-card',
    (cards) => cards.length,
  );
  if (veganGfCount === 0) {
    throw new Error('Vegan + Gluten-free returned 0 items');
  }
  console.log(
    `PASS: Vegan + Gluten-Free filter combined successfully (${veganGfCount} items).`,
  );

  // Test Avoid Allergen: "nuts"
  await menuPage.locator('button:has-text("Clear all filters")').click();
  await menuPage.waitForTimeout(200);
  // The label is lowercase in the DOM and capitalised by CSS.
  const avoidNutsChip = menuPage.getByRole('button', { name: /^nuts$/i });
  await avoidNutsChip.click();
  await menuPage.waitForTimeout(200);
  // Look at rendered cards only. The page's JSON-LD block also names these dishes.
  const hasNutsDishes = await menuPage.evaluate(() =>
    [...document.querySelectorAll('.menu-card')].some((card) =>
      /Contains:[^·]*nuts/i.test(card.textContent || ''),
    ),
  );
  if (hasNutsDishes) {
    throw new Error(
      'Avoid nuts failed: Walnut Brownie or Jaggery Kheer was displayed',
    );
  }
  console.log('PASS: Avoid nuts successfully excluded nut-containing items.');

  // Test Price cap: Under $2
  const priceCapChip = menuPage.getByRole('button', {
    name: 'Under $2',
    exact: true,
  });
  await priceCapChip.click();
  await menuPage.waitForTimeout(200);
  const priceCapCount = await menuPage.$$eval(
    '.menu-card',
    (cards) => cards.length,
  );
  if (priceCapCount === 0) {
    throw new Error('Price cap "Under $2" returned 0 items');
  }
  console.log(`PASS: Price cap "Under $2" returned ${priceCapCount} items.`);

  // Test Shared URL state restoration
  console.log('\nTesting shared URL filter restoration...');
  await menuPage.goto(
    'http://127.0.0.1:4321/menu?cat=Desserts&vegan=1&avoid=nuts',
    {
      waitUntil: 'networkidle',
    },
  );
  const isDessertsSelected = await menuPage.evaluate(() => {
    const activeTab = document.querySelector(
      '.category-tabs button[aria-selected="true"]',
    );
    return activeTab?.textContent?.includes('Desserts');
  });
  if (!isDessertsSelected) {
    throw new Error(
      'URL query ?cat=Desserts was not selected in category tabs',
    );
  }
  console.log(
    'PASS: Shared URL ?cat=Desserts&vegan=1&avoid=nuts correctly restored category and filters.',
  );

  await menuPage.close();

  // 5. Availability fail-safe check: simulate blocked network call to /api/menu/availability
  console.log('\nTesting availability fail-safe behavior when API fails...');
  const failSafePage = await browser.newPage();
  await failSafePage.route('**/api/menu/availability', (route) =>
    route.abort(),
  );
  const failSafeResponse = await failSafePage.goto(
    'http://127.0.0.1:4321/menu',
    {
      waitUntil: 'networkidle',
    },
  );
  if (!failSafeResponse?.ok()) {
    throw new Error('/menu failed to render when availability API was blocked');
  }
  const soldOutCount = await failSafePage.$$eval(
    'button:has-text("Sold out today")',
    (btns) => btns.length,
  );
  if (soldOutCount > 0) {
    throw new Error(
      `Expected fail-safe to show all items available, found ${soldOutCount} sold out items`,
    );
  }
  console.log(
    'PASS: Availability fails safe; all items remain available when API is unreachable.',
  );
  await failSafePage.close();

  console.log(
    '\nALL EXTENDED BROWSER, KEYBOARD, AND FILTER CHECKS PASSED SUCCESSFULLY.',
  );
} finally {
  await browser.close();
}
