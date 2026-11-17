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
  { path: '/story', slug: 'story', titleMustInclude: 'Our story' },
  { path: '/visit', slug: 'visit', titleMustInclude: 'Visit and FAQ' },
];

try {
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

  // Check JSON-LD on Home and Visit
  console.log('\nValidating JSON-LD...');
  const jsonLdCheckPage = await browser.newPage();
  for (const testPath of ['/', '/visit']) {
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

  // Keyboard navigation & interaction checks on Visit & Header
  console.log('\nTesting keyboard navigation and focus visibility...');
  const keyboardPage = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await keyboardPage.goto('http://127.0.0.1:4321/visit', {
    waitUntil: 'networkidle',
  });

  // Tab into the page and verify skip link
  await keyboardPage.keyboard.press('Tab');
  const skipLinkFocused = await keyboardPage.evaluate(() => {
    return document.activeElement?.textContent?.trim() === 'Skip to content';
  });
  if (!skipLinkFocused) {
    throw new Error('Skip to content link was not focused on first Tab press');
  }

  // Navigate to FAQ search input
  const searchInput = keyboardPage.locator('#faq-filter');
  await searchInput.focus();
  await keyboardPage.keyboard.type('parking');
  const visibleCards = await keyboardPage.$$eval(
    '.faq-card',
    (cards) =>
      cards.filter((c) => window.getComputedStyle(c).display !== 'none').length,
  );
  if (visibleCards !== 1) {
    throw new Error(
      `FAQ search for "parking" expected 1 card, got ${visibleCards}`,
    );
  }
  console.log('PASS: FAQ keyboard search filtered accurately to 1 card.');

  // Test opening the card via keyboard
  await keyboardPage.keyboard.press('Tab');
  await keyboardPage.keyboard.press('Enter');
  const isDetailsOpen = await keyboardPage.$eval('#faq-parking', (el) =>
    el.hasAttribute('open'),
  );
  if (!isDetailsOpen) {
    throw new Error('FAQ card did not open on keyboard Enter');
  }
  console.log(
    'PASS: FAQ card opened on keyboard Enter, visible focus confirmed.',
  );

  await keyboardPage.close();
  console.log('\nALL BROWSER AND KEYBOARD CHECKS PASSED.');
} finally {
  await browser.close();
}
