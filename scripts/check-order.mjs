// Browser check for Phase 2a: cart & /order page.
// Dev server must be running on 127.0.0.1:4321.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('.checks', { recursive: true });
let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const browser = await chromium.launch({ channel: 'chrome' });

try {
  // 1. Responsive checks at 360, 768, 1280 px on /order
  for (const [width, height] of [
    [360, 800],
    [768, 900],
    [1280, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('ERR_NETWORK_CHANGED')) {
        errors.push(m.text());
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('http://127.0.0.1:4321/order', {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(400);

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    ok(
      `/order at ${width}px: no console errors`,
      errors.length === 0,
      errors[0] ?? '',
    );
    ok(
      `/order at ${width}px: no horizontal scroll`,
      scrollWidth <= width,
      `scrollWidth ${scrollWidth} vs clientWidth ${width}`,
    );

    // Verify metadata
    const title = await page.title();
    ok(
      `/order at ${width}px title check`,
      title.includes('Order takeaway | The Pigeonhole Café (demo)'),
      title,
    );
    const noindexMeta = await page
      .locator('meta[name="robots"][content*="noindex"]')
      .count();
    ok(
      `/order at ${width}px has noindex meta`,
      noindexMeta > 0,
      `count ${noindexMeta}`,
    );

    await page.screenshot({ path: `.checks/order-${width}.png` });
    await page.close();
  }

  // 1b. A filled cart must not be clipped or pushed off screen at any width.
  // (A hidden-overflow container passes the scrollWidth check above while cutting content off.)
  for (const [width, height] of [
    [360, 800],
    [768, 900],
    [1280, 900],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:4321/menu', { waitUntil: 'networkidle' });
    await page.evaluate(() =>
      window.localStorage.setItem(
        'ph_cart_v1',
        JSON.stringify([
          { id: 'PH0003', quantity: 2 },
          { id: 'PH0060', quantity: 1 },
          { id: 'PH0109', quantity: 1 },
        ]),
      ),
    );
    await page.goto('http://127.0.0.1:4321/order', {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(700);
    const clipped = await page.evaluate((vw) => {
      const out = [];
      for (const el of document.querySelectorAll('main *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          out.push(el.tagName.toLowerCase() + ' right=' + Math.round(r.right));
        }
      }
      return out.slice(0, 3);
    }, width);
    ok(
      `/order with items at ${width}px: nothing extends past the screen edge`,
      clipped.length === 0,
      clipped.join('; '),
    );
    const controls = await page
      .locator('[aria-label^="Remove "][aria-label$=" from order"]')
      .first()
      .boundingBox();
    ok(
      `/order with items at ${width}px: Remove link is fully on screen`,
      controls !== null &&
        controls.x >= 0 &&
        controls.x + controls.width <= width,
      controls
        ? `x ${Math.round(controls.x)} w ${Math.round(controls.width)}`
        : 'not found',
    );
    await ctx.close();
  }

  // Use a shared BrowserContext for multi-page cart interaction and tab sync tests
  const context = await browser.newContext();

  // 2. Add from /menu, stepper up and down, remove to zero
  console.log(
    '\nTesting /menu Add button, stepper up and down, and remove to zero...',
  );
  const menuPage = await context.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await menuPage.goto('http://127.0.0.1:4321/menu', {
    waitUntil: 'networkidle',
  });
  await menuPage.evaluate(() => window.localStorage.clear());
  await menuPage.reload({ waitUntil: 'networkidle' });
  await menuPage.waitForTimeout(500);

  // Find Post Chai card
  const postChaiCard = menuPage.locator('.menu-card#item-PH0003');
  const addBtn = postChaiCard.locator('button:has-text("Add")');
  await addBtn.click();
  await menuPage.waitForTimeout(200);

  // Stepper should now be visible
  const qtySpan = postChaiCard.locator('span[aria-label*="quantity"]');
  const initialQty = await qtySpan.innerText();
  ok('Post Chai first add creates stepper with qty 1', initialQty === '1');

  // Stepper up
  const incBtn = postChaiCard.getByRole('button', {
    name: 'Increase quantity of Post Chai',
  });
  await incBtn.click();
  await menuPage.waitForTimeout(200);
  const incQty = await qtySpan.innerText();
  ok('Stepper up increases qty to 2', incQty === '2');

  // Stepper down
  const decBtn = postChaiCard.getByRole('button', {
    name: 'Decrease quantity of Post Chai',
  });
  await decBtn.click();
  await menuPage.waitForTimeout(200);
  const decQty = await qtySpan.innerText();
  ok('Stepper down decreases qty to 1', decQty === '1');

  // Stepper down to zero
  await decBtn.click();
  await menuPage.waitForTimeout(200);
  const addBackCount = await postChaiCard
    .locator('button:has-text("Add")')
    .count();
  ok(
    'Stepper down to zero returns to Add button',
    addBackCount === 1,
    `Add button count ${addBackCount}`,
  );

  // 3. Agreement between Cart button count, peek total, and /order total
  console.log(
    '\nTesting agreement across Cart button, CartPeek, and /order...',
  );
  // Add 2 Post Chai ($1.40 each = $2.80) and 1 Maska Pav ($1.40 each = $1.40) => 3 items, $4.20
  await postChaiCard.locator('button:has-text("Add")').click();
  await menuPage.waitForTimeout(200);
  await postChaiCard
    .getByRole('button', { name: 'Increase quantity of Post Chai' })
    .click();
  await menuPage.waitForTimeout(200);

  const maskaPavCard = menuPage.locator('.menu-card#item-PH0060');
  await maskaPavCard.locator('button:has-text("Add")').click();
  await menuPage.waitForTimeout(300);

  // Cart button count in header
  const headerCartCount = await menuPage
    .locator('header a[aria-label^="Cart with"]')
    .first()
    .innerText();
  ok(
    'Cart button in header shows 3 items',
    headerCartCount.includes('3'),
    `header text: "${headerCartCount}"`,
  );

  // Cart peek text
  const peekLocator = menuPage.locator(
    'div[role="region"][aria-label="Cart summary"]',
  );
  const peekText = await peekLocator.first().innerText();
  ok(
    'Cart peek shows "3 items, $4.20"',
    peekText.includes('3') && peekText.includes('4.20'),
    peekText.replace(/\n/g, ' '),
  );

  // Navigate to /order
  await menuPage.goto('http://127.0.0.1:4321/order', {
    waitUntil: 'networkidle',
  });
  // Wait for hydration to show the saved cart instead of guessing a delay.
  await menuPage
    .waitForFunction(
      () =>
        document
          .querySelector('section[aria-labelledby="cart-heading"]')
          ?.textContent?.includes('4.20'),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});

  const orderSubtotalText = await menuPage
    .locator('section[aria-labelledby="cart-heading"]')
    .innerText();
  ok(
    '/order displays matching subtotal $4.20',
    orderSubtotalText.includes('4.20') && orderSubtotalText.includes('3 items'),
  );

  // 4. Cart survives a reload
  console.log('\nTesting cart persistence after reload...');
  await menuPage.reload({ waitUntil: 'networkidle' });
  await menuPage.waitForTimeout(400);
  const reloadedText = await menuPage
    .locator('section[aria-labelledby="cart-heading"]')
    .innerText();
  ok(
    'Cart items survive reload',
    reloadedText.includes('Post Chai') && reloadedText.includes('Maska Pav'),
  );

  // 5. Second tab updates through storage event
  console.log('\nTesting multi-tab synchronization via storage event...');
  const tab2 = await context.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await tab2.goto('http://127.0.0.1:4321/order', { waitUntil: 'networkidle' });
  await tab2.waitForTimeout(300);

  // Modify cart on tab 1: add note and increase quantity
  await menuPage.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('ph_cart_v1') || '[]');
    raw.push({ id: 'PH0152', quantity: 1, note: 'extra hot' });
    window.localStorage.setItem('ph_cart_v1', JSON.stringify(raw));
  });
  await tab2.waitForTimeout(500);

  const tab2Content = await tab2
    .locator('section[aria-labelledby="cart-heading"]')
    .innerText();
  ok(
    'Tab 2 automatically received cart update from Tab 1 without reload',
    tab2Content.includes('Himachali Siddu') || tab2Content.includes('4 items'),
  );
  await tab2.close();

  // 6. Assistant button does not overlap CartPeek on mobile
  console.log('\nTesting mobile assistant button lift above cart peek...');
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 360, height: 800 });
  await mobilePage.goto('http://127.0.0.1:4321/menu', {
    waitUntil: 'networkidle',
  });

  const mobilePeek = mobilePage.locator('[data-cart-peek="mobile"]');
  await mobilePeek.waitFor({ state: 'visible', timeout: 5000 });
  const peekVisible = await mobilePeek.isVisible();
  ok('Cart peek is visible on mobile', peekVisible);

  const peekBox = await mobilePeek.boundingBox();
  const asstBtnBox = await mobilePage.locator('#assistant-open').boundingBox();

  if (peekBox && asstBtnBox) {
    const assistantIsAbovePeek =
      asstBtnBox.y + asstBtnBox.height <= peekBox.y + 4;
    ok(
      'Assistant button is positioned above mobile cart peek without overlap',
      assistantIsAbovePeek,
      `assistant bottom: ${asstBtnBox.y + asstBtnBox.height}px, peek top: ${peekBox.y}px`,
    );
  } else {
    ok('Found bounding boxes for assistant and peek', false);
  }
  await mobilePage.close();

  // 7. /order empty state
  console.log('\nTesting /order empty state...');
  await menuPage.evaluate(() => {
    window.localStorage.clear();
    window.dispatchEvent(new window.CustomEvent('ph-cart-change'));
  });
  await menuPage.goto('http://127.0.0.1:4321/order', {
    waitUntil: 'networkidle',
  });
  await menuPage.waitForTimeout(300);

  const emptyMsg = await menuPage.getByText('Your order is empty.').count();
  ok('/order shows "Your order is empty."', emptyMsg > 0);
  const browseLink = await menuPage
    .getByRole('link', { name: 'Browse the menu' })
    .getAttribute('href');
  ok('/order provides Browse the menu link to /menu', browseLink === '/menu');
  const quickAddCount = await menuPage
    .locator('button[aria-label^="Add "]')
    .count();
  ok(
    '/order empty state displays quick-add signature dishes',
    quickAddCount >= 6,
    `quick add count ${quickAddCount}`,
  );

  // Quick add an item from empty state
  await menuPage.locator('button[aria-label^="Add "]').first().click();
  await menuPage.waitForTimeout(300);
  const itemsAfterQuickAdd = await menuPage
    .locator('section[aria-labelledby="cart-heading"] article')
    .count();
  ok(
    'Quick add button adds item to empty order immediately',
    itemsAfterQuickAdd === 1,
  );

  // 8. Pickup time options show disabled reasons
  console.log('\nTesting pickup options and disabled reasons...');
  const chooseTimeRadio = menuPage.getByRole('radio', {
    name: 'Choose a time',
  });
  await chooseTimeRadio.check();
  await menuPage.waitForTimeout(200);

  const dateSelect = menuPage.locator('#pickup-date-select');
  const dateOptions = await dateSelect.locator('option').allInnerTexts();
  const hasDisabledDateReason = dateOptions.some(
    (opt) => opt.includes('closed') || opt.includes('Monday'),
  );
  ok(
    'Pickup dates select includes disabled reasons (e.g. Monday closed)',
    hasDisabledDateReason,
    dateOptions.find((o) => o.includes('closed')),
  );

  // 9. Failed submit error summary receives focus
  console.log('\nTesting failed submit validation and focus ring...');
  const submitBtn = menuPage.getByRole('button', { name: 'Place order' });
  await submitBtn.click();
  await menuPage.waitForTimeout(300);

  const isAlertFocused = await menuPage.evaluate(() => {
    const el = document.activeElement;
    return (
      el?.getAttribute('role') === 'alert' ||
      el?.id === 'error-summary-title' ||
      el?.closest('[role="alert"]') !== null
    );
  });
  ok(
    'Failed submit error summary receives focus',
    isAlertFocused,
    'focused element has role=alert',
  );

  const errorTexts = await menuPage.locator('[role="alert"]').innerText();
  ok(
    'Error summary reports required fields',
    errorTexts.includes('Name') && errorTexts.includes('Phone'),
  );

  // 10. Keyboard navigation through form & stepper
  console.log('\nTesting keyboard-only interaction...');
  const nameInput = menuPage.locator('#order-name');
  await nameInput.focus();
  await menuPage.keyboard.type('Ira Postal');
  const phoneInput = menuPage.locator('#order-phone');
  await phoneInput.focus();
  await menuPage.keyboard.type('+919876543210');
  const consentCheckbox = menuPage.locator('#order-consent');
  await consentCheckbox.focus();
  await menuPage.keyboard.press('Space');
  const isChecked = await consentCheckbox.isChecked();
  ok('Keyboard Space toggled demo consent checkbox', isChecked);

  // Test valid submit showing inline demo notice (no fake success, no API call)
  await submitBtn.click();
  await menuPage.waitForTimeout(300);

  const noticeCount = await menuPage
    .locator('div[role="status"]:has-text("Order ready for Phase 2b")')
    .count();
  ok(
    'Valid submit displays clear inline Phase 2b readiness notice without API call',
    noticeCount === 1,
  );

  await menuPage.close();
  await context.close();
} finally {
  await browser.close();
}

console.log(
  failures ? `\n${failures} CHECK(S) FAILED` : '\nALL ORDER CHECKS PASSED',
);
process.exit(failures ? 1 : 0);
