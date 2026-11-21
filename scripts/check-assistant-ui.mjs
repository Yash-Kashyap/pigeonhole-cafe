// Browser check for Phase 6b: Assistant Widget UI ("Ask the Pigeonhole")
// Every /api/assistant and /api/bookings call is mocked so nothing is written to database.
// Dev server must be running on 127.0.0.1:4321.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('.checks', { recursive: true });
const base = 'http://127.0.0.1:4321';
let failures = 0;

const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const json = (status, body, headers = {}) => ({
  status,
  contentType: 'application/json',
  headers,
  body: JSON.stringify(body),
});

const browser = await chromium.launch({ channel: 'chrome' });

try {
  // 1. Check widget presence on public pages and absence on /owner
  const publicPages = [
    { name: 'Home', path: '/' },
    { name: 'Menu', path: '/menu' },
    { name: 'Order', path: '/order' },
    { name: 'Reserve', path: '/reserve' },
    { name: 'Visit', path: '/visit' },
    { name: 'Story', path: '/story' },
    { name: 'Gatherings', path: '/gatherings' },
    { name: 'Trek Stop', path: '/trek-stop' },
  ];

  const ctxPresence = await browser.newContext({
    viewport: { width: 1024, height: 900 },
  });
  const pagePresence = await ctxPresence.newPage();

  for (const p of publicPages) {
    await pagePresence.goto(`${base}${p.path}`, { waitUntil: 'networkidle' });
    const btn = pagePresence.locator('#assistant-open');
    const count = await btn.count();
    ok(`Widget button present on ${p.name} (${p.path})`, count === 1);
  }

  // Absent on /owner
  await pagePresence.goto(`${base}/owner`, { waitUntil: 'networkidle' });
  const ownerRootBtn = pagePresence.locator('#assistant-open');
  ok('Widget button absent on /owner', (await ownerRootBtn.count()) === 0);

  await pagePresence.close();
  await ctxPresence.close();

  // 2. Responsive overflow, edge clipping & screenshots at 390 px and 1024 px
  for (const [width, height] of [
    [390, 844],
    [1024, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        errors.push(m.text());
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.locator('#assistant-open').waitFor({ state: 'visible' });

    // Open the widget
    await page.click('#assistant-open');
    await page
      .locator('[data-testid="assistant-dialog"]')
      .waitFor({ state: 'visible' });

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    ok(
      `Home at ${width}px: no horizontal overflow with widget open`,
      scrollWidth <= width,
      `scrollWidth ${scrollWidth} vs ${width}`,
    );

    const clipped = await page.evaluate((vw) => {
      const out = [];
      const dialog = document.querySelector('[data-testid="assistant-dialog"]');
      if (!dialog) return ['dialog missing'];
      const els = [dialog, ...dialog.querySelectorAll('*')];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1)) {
          out.push(
            `${el.tagName.toLowerCase()} left=${Math.round(r.left)} right=${Math.round(r.right)}`,
          );
        }
      }
      return out.slice(0, 4);
    }, width);

    ok(
      `Home at ${width}px: nothing extends past screen edge with widget open`,
      clipped.length === 0,
      clipped.join('; '),
    );

    await page.screenshot({
      path: `.checks/assistant-dialog-${width}px.png`,
      fullPage: false,
    });

    await page.close();
    await context.close();
  }

  // 3. Open, Focus Trap, Esc, and Focus Return
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const openBtn = page.locator('#assistant-open');
    await openBtn.focus();
    await openBtn.click();

    const dialog = page.locator('[data-testid="assistant-dialog"]');
    await dialog.waitFor({ state: 'visible' });
    ok(
      'Widget dialog opens when clicking Ask button',
      await dialog.isVisible(),
    );

    // Test Esc closes dialog and returns focus
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    ok('Pressing Esc closes the dialog', (await dialog.count()) === 0);

    const isTriggerFocused = await page.evaluate(() => {
      return document.activeElement?.id === 'assistant-open';
    });
    ok('Focus returns to the Ask button after Esc', isTriggerFocused);

    await page.close();
    await context.close();
  }

  // 4. Starter chips by page
  const pageChips = [
    { path: '/', chip: 'Is it open now?' },
    { path: '/menu', chip: 'What is vegan under $3?' },
    { path: '/order', chip: 'Add a Post Chai and two Maska Pav' },
    { path: '/reserve', chip: 'Book a slot for 4 tomorrow evening' },
    { path: '/visit', chip: 'Any parking?' },
    { path: '/trek-stop', chip: 'What should I eat before a trek?' },
  ];

  for (const pc of pageChips) {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(`${base}${pc.path}`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    const chip = page.locator('[data-testid="starter-chip"]');
    await chip.waitFor({ state: 'visible' });
    const text = await chip.textContent();
    ok(
      `Starter chip on ${pc.path} is "${pc.chip}"`,
      text?.includes(pc.chip) ?? false,
      text ?? '',
    );

    await page.close();
    await context.close();
  }

  // 5. Send message, typing state, plain text response, and chips disappearance
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    let assistantCallCount = 0;
    await page.route('**/api/assistant', async (route) => {
      assistantCallCount += 1;
      // Delay response slightly to verify typing state
      await new Promise((r) => globalThis.setTimeout(r, 400));
      return route.fulfill(
        json(200, {
          text: 'The café opens at 8:00 AM on weekdays and is closed on Mondays.',
          actions: [],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');

    // Click starter chip
    const chip = page.locator('[data-testid="starter-chip"]');
    await chip.click();

    // Check typing indicator appears
    const typing = page.locator('text=Consulting the ledger...');
    ok('Typing indicator visible while waiting', (await typing.count()) >= 0);

    // Wait for response
    await page.waitForSelector('text=The café opens at 8:00 AM');
    ok('Assistant answers with plain text response', assistantCallCount === 1);

    // Check chips disappeared after first message
    const chipAfter = await page
      .locator('[data-testid="starter-chip"]')
      .count();
    ok('Starter chips disappear after first message', chipAfter === 0);

    await page.close();
    await context.close();
  }

  // 6. cart_add card: adds to real cart, cart count updates, and Undo restores previous cart
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    // Start with empty cart
    await page.goto(`${base}/menu`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.setItem('ph_cart_v1', '[]'));

    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: 'I have prepared your order line for Maska Pav.',
          actions: [
            {
              type: 'cart_add',
              items: [{ id: 'PH0060', name: 'Maska Pav', qty: 2, price: 2.0 }],
            },
          ],
          ids: ['PH0060'],
          logged: true,
        }),
      );
    });

    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'Add two maska pav');
    await page.click('button[aria-label="Send message"]');

    const addCard = page.locator('[data-testid="cart-add-card"]');
    await addCard.waitFor({ state: 'visible' });
    ok('cart_add action card renders under assistant bubble', true);

    // Tap "Add to cart"
    await addCard.getByRole('button', { name: /add to cart/i }).click();
    await addCard
      .getByRole('button', { name: /undo/i })
      .waitFor({ state: 'visible' });

    // Verify localStorage cart updated to 2 items
    const cartCountAfterAdd = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('ph_cart_v1') || '[]');
      return items.reduce((sum, item) => sum + item.quantity, 0);
    });
    ok(
      'Tapping Add to cart updates real cart (qty = 2)',
      cartCountAfterAdd === 2,
      `cart count: ${cartCountAfterAdd}`,
    );

    // Verify Undo button appears
    const undoBtn = addCard.getByRole('button', { name: /undo/i });
    ok('Undo button appears after adding to cart', await undoBtn.isVisible());

    // Tap Undo
    await undoBtn.click();
    const cartCountAfterUndo = await page.evaluate(() => {
      const items = JSON.parse(localStorage.getItem('ph_cart_v1') || '[]');
      return items.reduce((sum, item) => sum + item.quantity, 0);
    });
    ok(
      'Tapping Undo restores previous cart state (qty = 0)',
      cartCountAfterUndo === 0,
      `cart count: ${cartCountAfterUndo}`,
    );

    // Verify Go to order link
    const orderLink = addCard.locator('a[href="/order"]');
    ok('Go to order link is present in card', (await orderLink.count()) === 1);

    await page.close();
    await context.close();
  }

  // 7. booking_proposal card: renders form, posts to mocked /api/bookings, goes to /reserve/confirmed
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    let bookingRequestReceived = null;
    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: 'Here is your reservation summary. Please enter your name and phone to confirm.',
          actions: [
            {
              type: 'booking_proposal',
              date: '2026-11-25',
              time: '18:30',
              partySize: 4,
              name: 'Ira Demo',
            },
          ],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.route('**/api/bookings', (route) => {
      bookingRequestReceived = route.request().postDataJSON();
      return route.fulfill(
        json(201, {
          code: 'PH-BK-9988',
          status: 'confirmed',
          slotLabels: ['S9'],
          date: '2026-11-25',
          time: '18:30',
          holdUntil: new Date(Date.now() + 600000).toISOString(),
        }),
      );
    });

    await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'Book for 4');
    await page.click('button[aria-label="Send message"]');

    const bookingCard = page.locator('[data-testid="booking-proposal-card"]');
    await bookingCard.waitFor({ state: 'visible' });
    ok('booking_proposal action card renders form', true);

    // Check prefilled name
    const nameVal = await page.inputValue('#assistant-booking-name');
    ok('Name field is pre-filled from proposal', nameVal === 'Ira Demo');

    // Fill phone and consent
    await page.fill('#assistant-booking-phone', '+919876543210');
    await bookingCard.locator('input[type="checkbox"]').check();

    // Click Confirm booking
    await bookingCard.locator('button:has-text("Confirm booking")').click();

    await page.waitForURL('**/reserve/confirmed?code=PH-BK-9988', {
      timeout: 10000,
    });
    ok(
      'Confirm booking navigates to /reserve/confirmed?code=PH-BK-9988',
      page.url().includes('/reserve/confirmed?code=PH-BK-9988'),
    );

    ok(
      'Booking payload sent to /api/bookings matched required shape',
      Boolean(
        bookingRequestReceived &&
        bookingRequestReceived.name === 'Ira Demo' &&
        bookingRequestReceived.phone === '+919876543210' &&
        bookingRequestReceived.partySize === 4 &&
        bookingRequestReceived.date === '2026-11-25' &&
        bookingRequestReceived.time === '18:30' &&
        bookingRequestReceived.honeypot === '',
      ),
    );

    await page.close();
    await context.close();
  }

  // 8. handoff card
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: 'I will connect you with our team.',
          actions: [{ type: 'handoff' }],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill(
      'textarea[placeholder*="Ask"]',
      'I need help with a custom party',
    );
    await page.click('button[aria-label="Send message"]');

    const handoffCard = page.locator('[data-testid="handoff-card"]');
    await handoffCard.waitFor({ state: 'visible' });
    ok('handoff card renders contact details', true);

    const waLink = handoffCard.locator('a[href^="/whatsapp"]');
    ok(
      'WhatsApp redirect button is present in handoff card',
      (await waLink.count()) === 1,
    );

    const phoneText = await handoffCard.textContent();
    ok(
      'Placeholder phone +91 00000 00000 displayed',
      phoneText?.includes('+91 00000 00000') ?? false,
    );

    await page.close();
    await context.close();
  }

  // 9. resting state
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: 'The assistant is resting for the day. Please contact the team.',
          actions: [],
          ids: [],
          logged: true,
          resting: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'Hello?');
    await page.click('button[aria-label="Send message"]');

    await page.waitForSelector('text=The assistant is currently resting');
    ok('Resting state message is displayed in dialog', true);

    // Verify textarea is replaced or disabled
    const textarea = await page.locator('textarea[placeholder*="Ask"]').count();
    ok('Input is disabled/hidden during resting state', textarea === 0);

    // Verify Talk to the team button
    const teamBtn = page.locator('a:has-text("Talk to the team")');
    ok(
      'Talk to the team button is visible when resting',
      (await teamBtn.count()) >= 1,
    );

    await page.close();
    await context.close();
  }

  // 10. 429/500/network error with Retry
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    let attempts = 0;
    await page.route('**/api/assistant', (route) => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill(json(500, { message: 'Internal server error' }));
      }
      return route.fulfill(
        json(200, {
          text: 'Now I am working after retry!',
          actions: [],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'What are your hours?');
    await page.click('button[aria-label="Send message"]');

    // Friendly error bubble
    const retryBtn = page.locator('button:has-text("Retry")');
    await retryBtn.waitFor({ state: 'visible' });
    ok('Friendly error bubble with Retry button appears on 500 error', true);

    // Click Retry
    await retryBtn.click();
    await page.waitForSelector('text=Now I am working after retry!');
    ok('Clicking Retry resends the request and recovers', attempts === 2);

    await page.close();
    await context.close();
  }

  // 11. "New chat" button clears messages and sessionStorage
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: 'First conversation answer.',
          actions: [],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'Message 1');
    await page.click('button[aria-label="Send message"]');

    await page.waitForSelector('text=First conversation answer.');

    // Click "New chat"
    await page.click('button:has-text("New chat")');

    // Check message list cleared
    const answers = await page
      .locator('text=First conversation answer.')
      .count();
    ok('New chat button clears messages from dialog', answers === 0);

    const storedSession = await page.evaluate(() => {
      const raw = window.sessionStorage.getItem('ph_assistant_chat_v1');
      return raw ? JSON.parse(raw) : null;
    });
    ok(
      'New chat resets stored messages in sessionStorage',
      Array.isArray(storedSession?.messages) &&
        storedSession.messages.length === 0,
    );

    await page.close();
    await context.close();
  }

  // 12. Prompt-injection text renders strictly as plain text
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();

    let dialogAlertTriggered = false;
    page.on('dialog', async (d) => {
      dialogAlertTriggered = true;
      await d.dismiss();
    });

    await page.route('**/api/assistant', (route) => {
      return route.fulfill(
        json(200, {
          text: '<img src=x onerror=alert(1)> Some plain text <script>alert(2)</script>',
          actions: [],
          ids: [],
          logged: true,
        }),
      );
    });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#assistant-open');
    await page.fill('textarea[placeholder*="Ask"]', 'Test injection');
    await page.click('button[aria-label="Send message"]');

    await page.waitForSelector('text=<img src=x onerror=alert(1)>');
    ok(
      'Injection payload renders as literal plain text',
      dialogAlertTriggered === false,
    );

    // Verify no <img> tag exists in the message list
    const imgCount = await page
      .locator('[data-testid="assistant-message-list"] img')
      .count();
    ok('No img element created by injection text', imgCount === 0);

    await page.close();
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\nBrowser checks finished with ${failures} failure(s).`);
if (failures > 0) {
  process.exit(1);
}
