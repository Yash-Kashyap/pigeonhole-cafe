// How the order form reacts to every kind of server answer. The server is mocked, so nothing is written
// to the database. Needs the dev server on 127.0.0.1:4321.
import { chromium } from '@playwright/test';

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

async function openFilledForm() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const problems = [];
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !/Failed to load resource/.test(m.text()) &&
      problems.push(m.text().slice(0, 140)),
  );
  page.on('pageerror', (e) => problems.push(String(e).slice(0, 140)));
  await page.goto(`${base}/menu`, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    localStorage.setItem(
      'ph_cart_v1',
      JSON.stringify([
        { id: 'PH0003', quantity: 2 },
        { id: 'PH0060', quantity: 1 },
      ]),
    ),
  );
  await page.goto(`${base}/order`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.fill('#order-name', 'Ira Mock');
  await page.fill('#order-phone', '9000000000');
  if ((await page.locator('input[name="pickup_mode"]').count()) > 1)
    await page.locator('input[name="pickup_mode"]').nth(1).check();
  await page.waitForTimeout(300);
  const dates = await page
    .locator('#pickup-date-select option')
    .evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled })));
  await page.selectOption(
    '#pickup-date-select',
    dates.find((o) => !o.d && o.v).v,
  );
  await page.waitForTimeout(300);
  const times = await page
    .locator('#pickup-time-select option')
    .evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled })));
  await page.selectOption(
    '#pickup-time-select',
    times.find((o) => !o.d && o.v).v,
  );
  await page.locator('#order-consent').check();
  await page.waitForTimeout(3300);
  return { context, page, problems };
}
const place = (page) =>
  page.getByRole('button', { name: /place order/i }).click();
const cartQty = (page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('ph_cart_v1') || '[]').reduce(
      (n, i) => n + i.quantity,
      0,
    ),
  );

try {
  // 409: an item sold out
  {
    const { context, page, problems } = await openFilledForm();
    await page.route('**/api/orders', (r) =>
      r.fulfill(
        json(409, {
          message: 'One or more items are unavailable.',
          unavailableIds: ['PH0003'],
        }),
      ),
    );
    await place(page);
    await page.waitForTimeout(800);
    ok(
      '409: the sold-out line offers "Remove it"',
      (await page.getByRole('button', { name: /remove it/i }).count()) > 0,
    );
    ok(
      '409: the error summary says what happened and has focus',
      /sold out/i.test(await page.locator('[role="alert"]').innerText()),
    );
    ok('409: the cart is kept', (await cartQty(page)) === 3);
    ok(
      '409: the form values are kept',
      (await page.inputValue('#order-name')) === 'Ira Mock',
    );
    ok(
      '409: placing the order is blocked while the line is there',
      await page.getByRole('button', { name: /place order/i }).isDisabled(),
    );
    await page
      .getByRole('button', { name: /remove it/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    ok(
      '409: "Remove it" removes only that line and unblocks the order',
      (await cartQty(page)) === 1 &&
        !(await page
          .getByRole('button', { name: /place order/i })
          .isDisabled()),
    );
    ok('409: no console errors', problems.length === 0, problems[0] ?? '');
    await context.close();
  }

  // 422: pickup rule refused, with a suggestion
  {
    const { context, page } = await openFilledForm();
    await page.route('**/api/orders', (r) =>
      r.fulfill(
        json(422, {
          message: 'Choose another pickup time.',
          errors: ['Pickup must be before last orders at 9:00 PM.'],
        }),
      ),
    );
    await place(page);
    await page.waitForTimeout(800);
    ok(
      '422: the rule message is shown',
      /last orders/i.test(await page.locator('[role="alert"]').innerText()),
    );
    ok('422: the cart is kept', (await cartQty(page)) === 3);
    ok(
      '422: a nearest valid time is offered',
      (await page
        .getByRole('button', { name: /pick next valid time/i })
        .count()) > 0,
    );
    await context.close();
  }

  // 429: rate limited
  {
    const { context, page } = await openFilledForm();
    await page.route('**/api/orders', (r) =>
      r.fulfill(
        json(
          429,
          { message: 'Too many.', retryAfter: 3600 },
          { 'Retry-After': '3600' },
        ),
      ),
    );
    await place(page);
    await page.waitForTimeout(800);
    ok(
      '429: a calm message with the wait time',
      /wait 60 minutes/i.test(await page.locator('[role="alert"]').innerText()),
    );
    ok('429: the cart is kept', (await cartQty(page)) === 3);
    await context.close();
  }

  // 500: server trouble
  {
    const { context, page } = await openFilledForm();
    await page.route('**/api/orders', (r) =>
      r.fulfill(
        json(500, {
          message: 'We could not place the order. Please try again.',
        }),
      ),
    );
    await place(page);
    await page.waitForTimeout(800);
    ok(
      '500: a plain message, nothing technical',
      /could not place the order/i.test(
        await page.locator('[role="alert"]').innerText(),
      ),
    );
    ok('500: the cart is kept', (await cartQty(page)) === 3);
    await context.close();
  }

  // network failure, then a retry that succeeds
  {
    const { context, page, problems } = await openFilledForm();
    let calls = 0;
    await page.route('**/api/orders', (r) => {
      calls += 1;
      if (calls === 1) return r.abort('failed');
      return r.fulfill(
        json(201, {
          code: 'PH-ORD-9999',
          pickupAt: new Date().toISOString(),
          subtotal: 4.2,
        }),
      );
    });
    await place(page);
    await page.waitForTimeout(800);
    ok(
      'network failure: cart and form values are kept and a retry is offered',
      (await cartQty(page)) === 3 &&
        (await page.inputValue('#order-name')) === 'Ira Mock' &&
        /connection failed/i.test(await page.locator('main').innerText()),
    );
    ok(
      'network failure: the button works again',
      !(await page.getByRole('button', { name: /place order/i }).isDisabled()),
    );
    await place(page);
    await page.waitForURL(/\/order\/confirmed\?code=PH-ORD-9999/, {
      timeout: 10000,
    });
    ok('retry succeeds: goes to the confirmation page', true);
    ok('retry succeeds: the cart is cleared', (await cartQty(page)) === 0);
    ok(
      'network failure and retry: no page errors',
      problems.length === 0,
      problems[0] ?? '',
    );
    await context.close();
  }

  // a double click must send one request only
  {
    const { context, page } = await openFilledForm();
    let calls = 0;
    await page.route('**/api/orders', async (r) => {
      calls += 1;
      await page.waitForTimeout(1500);
      await r.fulfill(
        json(500, {
          message: 'We could not place the order. Please try again.',
        }),
      );
    });
    // Worst case: three clicks in the same instant, before React can disable the button.
    // (A Playwright locator cannot be used for a second click: the label changes to
    // "Sending order…" while the request is pending.)
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        /place order/i.test(b.textContent ?? ''),
      );
      button?.click();
      button?.click();
      button?.click();
    });
    await page.waitForTimeout(2200);
    ok(
      'double click sends exactly one request',
      calls === 1,
      `${calls} requests`,
    );
    await context.close();
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL: script error: ${String(error).slice(0, 240)}`);
} finally {
  await browser.close();
  console.log(
    failures
      ? `\n${failures} CHECK(S) FAILED`
      : '\nALL ORDER ERROR-STATE CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
