// Browser check for Phase 3b: /reserve and /reserve/confirmed.
// Every API endpoint is mocked so nothing is written to the database.
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

function defaultAvailability(party) {
  if (party >= 7) {
    return {
      times: [
        { time: '18:00', remaining: null, requestable: true },
        { time: '19:00', remaining: null, requestable: true },
        { time: '19:30', remaining: null, requestable: true },
      ],
    };
  }
  return {
    times: [
      { time: '18:00', remaining: 3, requestable: false },
      { time: '18:30', remaining: 1, requestable: false },
      { time: '19:00', remaining: 0, requestable: false },
      { time: '19:30', remaining: 2, requestable: false },
    ],
  };
}

async function mockDefaultAvailability(page, customHandler) {
  await page.route('**/api/availability**', (route) => {
    const url = new URL(route.request().url());
    const party = Number(url.searchParams.get('party') ?? '2');
    const date = url.searchParams.get('date') ?? '';
    if (customHandler) {
      return customHandler(route, { date, party });
    }
    return route.fulfill(json(200, defaultAvailability(party)));
  });
}

async function fillUpToConfirm(page, { party = 4, withPreorder = false } = {}) {
  await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
  await page.locator('[role="radiogroup"] [role="radio"]').first().waitFor({
    state: 'visible',
    timeout: 10000,
  });

  // Set party size (default is 2)
  const incBtn = page.getByRole('button', { name: 'Increase party size' });
  const decBtn = page.getByRole('button', { name: 'Decrease party size' });
  if (party > 2) {
    for (let i = 2; i < party; i += 1) await incBtn.click();
  } else if (party < 2) {
    for (let i = 2; i > party; i -= 1) await decBtn.click();
  }

  await page.waitForTimeout(250);
  await page
    .locator('[role="radiogroup"] [role="radio"]:not([disabled])')
    .first()
    .click();
  await page.getByRole('button', { name: /continue to details/i }).click();

  await page.fill('#reserve-name', 'Ira Mock');
  await page.fill('#reserve-phone', '+919876543210');
  await page.fill('#reserve-email', 'ira@example.com');
  await page.fill('#reserve-notes', 'Near a plug point please');

  if (withPreorder) {
    await page.locator('summary', { hasText: /order ahead/i }).click();
    await page.fill('#preorder-search', 'Post Chai');
    await page
      .getByRole('button', { name: 'Add Post Chai to pre-order' })
      .click();
  }

  await page.getByRole('button', { name: /review and confirm/i }).click();
  await page.locator('#reserve-consent').check();
}

const browser = await chromium.launch({ channel: 'chrome' });

try {
  // 1. Responsive, overflow, edge-clipping, touch targets & screenshots at 360, 768, 1280
  for (const [width, height] of [
    [360, 800],
    [768, 900],
    [1280, 900],
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

    await mockDefaultAvailability(page);
    await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
    await page
      .locator('[role="radiogroup"] [role="radio"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    ok(
      `/reserve at ${width}px: no console errors`,
      errors.length === 0,
      errors[0] ?? '',
    );
    ok(
      `/reserve at ${width}px: no horizontal overflow`,
      scrollWidth <= width,
      `scrollWidth ${scrollWidth} vs ${width}`,
    );

    const clipped = await page.evaluate((vw) => {
      const out = [];
      for (const el of document.querySelectorAll('main *')) {
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
      `/reserve at ${width}px: nothing extends past screen edge`,
      clipped.length === 0,
      clipped.join('; '),
    );

    const minCell = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[role="gridcell"]')];
      let minH = Infinity;
      let minW = Infinity;
      for (const cell of cells) {
        const r = cell.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          minH = Math.min(minH, r.height);
          minW = Math.min(minW, r.width);
        }
      }
      return { minW: Math.round(minW), minH: Math.round(minH) };
    });
    ok(
      `/reserve at ${width}px: calendar cells at least 44px`,
      minCell.minW >= 44 && minCell.minH >= 44,
      `${minCell.minW}x${minCell.minH}`,
    );

    await page.screenshot({ path: `.checks/reserve-${width}.png` });
    await context.close();
  }

  // 2. Calendar disabled days, party helpers, >12 hand-over, time grid states, invalid time clear, honeypot
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page, (route, { party }) => {
      if (party === 4) {
        return route.fulfill(
          json(200, {
            times: [
              { time: '18:00', remaining: 3, requestable: false },
              { time: '18:30', remaining: 1, requestable: false },
              { time: '19:00', remaining: 0, requestable: false },
              { time: '19:30', remaining: 2, requestable: false },
            ],
          }),
        );
      }
      if (party === 6) {
        return route.fulfill(
          json(200, {
            times: [
              { time: '18:00', remaining: 0, requestable: false },
              { time: '19:30', remaining: 1, requestable: false },
            ],
          }),
        );
      }
      return route.fulfill(json(200, defaultAvailability(party)));
    });

    await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
    await page
      .locator('[role="radiogroup"] [role="radio"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    // Calendar disabled Monday with reason
    const disabledMonday = page.locator(
      '[role="gridcell"][disabled][title="Closed on Mondays."]',
    );
    ok(
      'Calendar disables Mondays with reason text',
      (await disabledMonday.count()) >= 4,
      `count ${await disabledMonday.count()}`,
    );

    // Honeypot hidden from users
    const honeypotVisible = await page.locator('#reserve-website').isVisible();
    ok('Honeypot field is not visible to users', !honeypotVisible);

    // Party helper text for 2 -> 7 -> 8 -> >12
    ok(
      'Party 2 helper text shows slot sizes',
      (await page.getByText('Slots seat 2, 4 or 6.').count()) > 0,
    );

    const incBtn = page.getByRole('button', { name: 'Increase party size' });
    await incBtn.click(); // 3
    await incBtn.click(); // 4
    await page.waitForTimeout(250);

    // Time grid states: normal, Few left, Full (disabled)
    const fewLeftBtn = page.locator('[role="radio"]', { hasText: 'Few left' });
    const fullBtn = page.locator('[role="radio"]', { hasText: 'Full' });
    ok('Time grid shows Few left badge', (await fewLeftBtn.count()) === 1);
    ok(
      'Time grid shows Full badge and disables button',
      (await fullBtn.count()) === 1 && (await fullBtn.isDisabled()),
    );

    // Select 6:00 PM (18:00) for party 4, then change to party 6 where 18:00 is Full -> cleared
    await page.locator('[role="radio"]', { hasText: '6:00 PM' }).click();
    ok(
      'Live summary reflects chosen time and party',
      (await page.locator('#reserve-live-summary').innerText()).includes(
        '6:00 PM, 4 people',
      ),
    );
    await incBtn.click(); // 5
    await incBtn.click(); // 6
    await page.waitForTimeout(300);
    const summaryAfterPartyChange = await page
      .locator('#reserve-live-summary')
      .innerText();
    ok(
      'Party change clears an invalid chosen time',
      summaryAfterPartyChange.includes('choose a time') &&
        !summaryAfterPartyChange.includes('6:00 PM'),
      summaryAfterPartyChange,
    );

    // Party 7 helper + Request times (no free counts)
    await incBtn.click(); // 7
    await page.waitForTimeout(300);
    ok(
      'Party 7 helper text updates to team confirmation',
      (await page
        .getByText('Groups of 7 or more are confirmed by the team.')
        .count()) > 0,
    );
    const requestRadios = page.locator('[role="radio"]', {
      hasText: 'Request',
    });
    const fewLeftOn7 = page.locator('[role="radio"]', { hasText: 'Few left' });
    ok(
      'Party 7 time grid shows Request and never free counts',
      (await requestRadios.count()) === 3 && (await fewLeftOn7.count()) === 0,
    );

    // Party 8 helper text
    await incBtn.click(); // 8
    ok(
      'Party 8 helper text shows 24 hours notice',
      (await page
        .getByText("Groups of 8 or more need 24 hours' notice.")
        .count()) > 0,
    );

    // Try above 12 -> stays at 12 and shows hand-over message
    for (let i = 8; i < 12; i += 1) await incBtn.click();
    await incBtn.click(); // attempt 13
    const handoffVisible = await page
      .getByText('Groups above 12 cannot be booked online.')
      .isVisible();
    const waHref = await page
      .getByRole('link', { name: 'Message on WhatsApp' })
      .getAttribute('href');
    ok(
      'Trying party > 12 shows hand-over message and /whatsapp contact option',
      handoffVisible &&
        typeof waHref === 'string' &&
        waHref.startsWith('/whatsapp?text='),
    );

    await context.close();
  }

  // 3. Reload restores state + Birthday >= 7 gathering link + pre-order estimate
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
    await page
      .locator('[role="radiogroup"] [role="radio"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    const incBtn = page.getByRole('button', { name: 'Increase party size' });
    for (let i = 2; i < 7; i += 1) await incBtn.click();
    await page.waitForTimeout(250);
    await page.locator('[role="radio"]', { hasText: '7:00 PM' }).click();
    await page.getByRole('button', { name: /continue to details/i }).click();

    await page.fill('#reserve-name', 'Ira Reload');
    await page.fill('#reserve-phone', '9876543210');
    await page.selectOption('#reserve-occasion', 'birthday');
    await page.fill('#reserve-notes', 'Window slot please');

    const gatheringHref = await page
      .getByRole('link', { name: /plan a bigger gathering/i })
      .getAttribute('href');
    ok(
      'Birthday with party >= 7 shows Plan a bigger gathering link',
      gatheringHref === '/gatherings#private-tables',
    );

    await page.locator('summary', { hasText: /order ahead/i }).click();
    await page.fill('#preorder-search', 'Post Chai');
    await page
      .getByRole('button', { name: 'Add Post Chai to pre-order' })
      .click();
    ok(
      'Pre-order total displays pay at the café estimate',
      /Pre-order total \$\d+\.\d{2}, pay at the café/.test(
        await page.locator('main').innerText(),
      ),
    );

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok(
      'Reload restores step, details, occasion and pre-order',
      (await page.inputValue('#reserve-name')) === 'Ira Reload' &&
        (await page.inputValue('#reserve-phone')) === '9876543210' &&
        (await page.inputValue('#reserve-notes')) === 'Window slot please' &&
        /1 item/.test(await page.locator('main summary').innerText()),
    );
    await context.close();
  }

  // 4. Happy path for party 4 (with pre-order) + strict API contract check
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    let capturedBody = null;
    await page.route('**/api/bookings', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      capturedBody = route.request().postDataJSON();
      return route.fulfill(
        json(201, {
          code: 'PH-BK-4004',
          status: 'confirmed',
          slotLabels: ['SLOT 09'],
          date: capturedBody.date,
          time: capturedBody.time,
          holdUntil: '2026-11-21T14:15:00.000Z',
        }),
      );
    });
    await page.route('**/api/bookings/PH-BK-4004', (route) =>
      route.fulfill(
        json(200, {
          code: 'PH-BK-4004',
          status: 'confirmed',
          slotLabels: ['SLOT 09'],
          date: '2026-11-21',
          time: '18:00',
          party: 4,
          holdUntil: '2026-11-21T12:45:00.000Z',
          preorder: {
            lines: [
              {
                id: 'PH0003',
                name: 'Post Chai',
                price: 1.4,
                qty: 1,
                lineTotal: 1.4,
              },
            ],
            total: 1.4,
          },
        }),
      ),
    );

    await fillUpToConfirm(page, { party: 4, withPreorder: true });
    await page.getByRole('button', { name: 'Reserve slot' }).click();
    await page.waitForURL(/\/reserve\/confirmed\?code=PH-BK-4004/, {
      timeout: 10000,
    });

    const allowedKeys = new Set([
      'name',
      'phone',
      'email',
      'date',
      'time',
      'partySize',
      'occasion',
      'notes',
      'preorder',
      'honeypot',
      'mountedAt',
    ]);
    const extraKeys = Object.keys(capturedBody ?? {}).filter(
      (k) => !allowedKeys.has(k),
    );
    const preorderLineKeys = capturedBody?.preorder?.[0]
      ? Object.keys(capturedBody.preorder[0]).sort()
      : [];
    ok(
      'Happy path party 4 sends exact strict payload keys and {id, qty} preorder',
      extraKeys.length === 0 &&
        capturedBody?.partySize === 4 &&
        capturedBody?.honeypot === '' &&
        typeof capturedBody?.mountedAt === 'number' &&
        preorderLineKeys.join(',') === 'id,qty',
      `extra=${extraKeys.join(',')} preorderKeys=${preorderLineKeys.join(',')}`,
    );
    await context.close();
  }

  // 5. Happy path for party 7 ("Send request")
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    let capturedParty = 0;
    await page.route('**/api/bookings', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      capturedParty = body.partySize;
      return route.fulfill(
        json(201, {
          code: 'PH-BK-7007',
          status: 'requested',
          slotLabels: [],
          date: body.date,
          time: body.time,
          holdUntil: '2026-11-21T12:45:00.000Z',
        }),
      );
    });
    await page.route('**/api/bookings/PH-BK-7007', (route) =>
      route.fulfill(
        json(200, {
          code: 'PH-BK-7007',
          status: 'requested',
          slotLabels: [],
          date: '2026-11-21',
          time: '18:00',
          party: 7,
          holdUntil: '2026-11-21T12:45:00.000Z',
          preorder: { lines: [], total: 0 },
        }),
      ),
    );

    await fillUpToConfirm(page, { party: 7 });
    const sendReqBtn = page.getByRole('button', { name: 'Send request' });
    ok(
      'Party 7 confirm button reads "Send request"',
      await sendReqBtn.isVisible(),
    );
    await sendReqBtn.click();
    await page.waitForURL(/\/reserve\/confirmed\?code=PH-BK-7007/, {
      timeout: 10000,
    });
    ok(
      'Happy path party 7 submits partySize 7 and navigates',
      capturedParty === 7,
    );
    await context.close();
  }

  // 6. 409 with alternatives
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    await page.route('**/api/bookings', (route) =>
      route.fulfill(
        json(409, {
          message: 'That time was just taken.',
          alternatives: ['18:30', '19:30', '20:00'],
        }),
      ),
    );
    await fillUpToConfirm(page, { party: 4 });
    await page.getByRole('button', { name: 'Reserve slot' }).click();
    await page.locator('[role="alert"]').waitFor({ state: 'visible' });

    const altBtn = page.getByRole('button', { name: '7:30 PM' });
    const alertFocused = await page.evaluate(
      () => document.activeElement?.getAttribute('role') === 'alert',
    );
    ok(
      '409 shows alternatives and focuses error summary',
      (await altBtn.count()) === 1 && alertFocused,
    );
    await altBtn.click();
    ok(
      'Clicking 409 alternative selects that time and keeps form details',
      (await page.locator('main').innerText()).includes('7:30 PM') &&
        (await page.locator('main').innerText()).includes('Ira Mock') &&
        (await page.locator('[role="alert"]').count()) === 0,
    );
    await context.close();
  }

  // 7. 422, 429, 500 error responses
  for (const scenario of [
    {
      name: '422',
      status: 422,
      body: {
        message: 'Choose another booking time.',
        errors: ['Groups of 8 or more need 24 hours notice.'],
      },
      headers: {},
      match: /24 hours notice/i,
      forbid: null,
    },
    {
      name: '429',
      status: 429,
      body: { message: 'Too many.', retryAfter: 3600 },
      headers: { 'Retry-After': '3600' },
      match: /too many attempts, try again later/i,
      forbid: null,
    },
    {
      name: '500',
      status: 500,
      body: { message: 'RAW_PG_SECRET_STACK_TRACE' },
      headers: {},
      match: /could not complete your booking/i,
      forbid: /RAW_PG_SECRET_STACK_TRACE/,
    },
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    await page.route('**/api/bookings', (route) =>
      route.fulfill(json(scenario.status, scenario.body, scenario.headers)),
    );
    await fillUpToConfirm(page, { party: 4 });
    await page.getByRole('button', { name: 'Reserve slot' }).click();
    await page.locator('[role="alert"]').waitFor({ state: 'visible' });
    const text = await page.locator('[role="alert"]').innerText();
    ok(
      `${scenario.name}: shows expected calm message${scenario.forbid ? ' without raw server text' : ''}`,
      scenario.match.test(text) &&
        (!scenario.forbid || !scenario.forbid.test(text)),
      text.replace(/\s+/g, ' ').slice(0, 90),
    );
    await context.close();
  }

  // 8. Triple-click sends exactly one request
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    let postCalls = 0;
    await page.route('**/api/bookings', async (route) => {
      postCalls += 1;
      await page.waitForTimeout(1000);
      await route.fulfill(json(500, { message: 'error' }));
    });
    await fillUpToConfirm(page, { party: 4 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Reserve slot',
      );
      btn?.click();
      btn?.click();
      btn?.click();
    });
    await page.waitForTimeout(1500);
    ok(
      'Triple-click sends exactly one POST /api/bookings request',
      postCalls === 1,
      `${postCalls} calls`,
    );
    await context.close();
  }

  // 9. Keyboard-only flow
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await mockDefaultAvailability(page);
    let submitted = false;
    await page.route('**/api/bookings', (route) => {
      submitted = true;
      const body = route.request().postDataJSON();
      return route.fulfill(
        json(201, {
          code: 'PH-BK-5005',
          status: 'confirmed',
          slotLabels: ['SLOT 01'],
          date: body.date,
          time: body.time,
          holdUntil: '2026-11-21T12:45:00.000Z',
        }),
      );
    });
    await page.route('**/api/bookings/PH-BK-5005', (route) =>
      route.fulfill(
        json(200, {
          code: 'PH-BK-5005',
          status: 'confirmed',
          slotLabels: ['SLOT 01'],
          date: '2026-11-21',
          time: '18:30',
          party: 2,
          holdUntil: '2026-11-21T13:15:00.000Z',
          preorder: { lines: [], total: 0 },
        }),
      ),
    );

    await page.goto(`${base}/reserve`, { waitUntil: 'networkidle' });
    await page
      .locator('[role="radiogroup"] [role="radio"]')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    const activeDate = page.locator('[role="gridcell"][aria-selected="true"]');
    const beforeDate = await activeDate.getAttribute('aria-label');
    await activeDate.focus();
    await page.keyboard.press('ArrowRight');
    const afterDate = await page
      .locator('[role="gridcell"][aria-selected="true"]')
      .getAttribute('aria-label');
    ok(
      'Keyboard ArrowRight advances selected calendar date',
      beforeDate !== afterDate,
    );

    await page.waitForTimeout(250);
    const firstTime = page
      .locator('[role="radiogroup"] [role="radio"]:not([disabled])')
      .first();
    await firstTime.focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: /continue to details/i }).focus();
    await page.keyboard.press('Enter');

    await page.locator('#reserve-name').focus();
    await page.keyboard.type('Ira Keyboard');
    await page.locator('#reserve-phone').focus();
    await page.keyboard.type('9876543210');
    await page.getByRole('button', { name: /review and confirm/i }).focus();
    await page.keyboard.press('Enter');

    await page.locator('#reserve-consent').focus();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Reserve slot' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/reserve\/confirmed\?code=PH-BK-5005/, {
      timeout: 10000,
    });
    ok('Keyboard-only flow completes booking end-to-end', submitted);
    await context.close();
  }

  // 10. Confirmation states: confirmed (joined slots, .ics, WhatsApp, responsive, cancel 404/409/200)
  {
    for (const [width, height] of [
      [360, 800],
      [768, 900],
      [1280, 900],
    ]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.route('**/api/bookings/PH-BK-0099', (route) =>
        route.fulfill(
          json(200, {
            code: 'PH-BK-0099',
            status: 'confirmed',
            slotLabels: ['SLOT 09', 'SLOT 10'],
            date: '2026-11-21',
            time: '19:30',
            party: 8,
            holdUntil: '2026-11-21T14:15:00.000Z',
            preorder: {
              lines: [
                {
                  id: 'PH0003',
                  name: 'Post Chai',
                  price: 1.4,
                  qty: 2,
                  lineTotal: 2.8,
                },
              ],
              total: 2.8,
            },
          }),
        ),
      );

      await page.goto(`${base}/reserve/confirmed?code=PH-BK-0099`, {
        waitUntil: 'networkidle',
      });
      await page.locator('#booking-view').waitFor({ state: 'visible' });

      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      ok(
        `/reserve/confirmed at ${width}px: no horizontal overflow`,
        scrollWidth <= width,
        `scrollWidth ${scrollWidth} vs ${width}`,
      );
      const clipped = await page.evaluate((vw) => {
        const out = [];
        for (const el of document.querySelectorAll('main *')) {
          const r = el.getBoundingClientRect();
          if (
            r.width > 0 &&
            r.height > 0 &&
            (r.right > vw + 1 || r.left < -1)
          ) {
            out.push(
              `${el.tagName.toLowerCase()} left=${Math.round(r.left)} right=${Math.round(r.right)}`,
            );
          }
        }
        return out.slice(0, 4);
      }, width);
      ok(
        `/reserve/confirmed at ${width}px: nothing extends past screen edge`,
        clipped.length === 0,
        clipped.join('; '),
      );

      await page.screenshot({
        path: `.checks/reserve-confirmed-${width}.png`,
      });

      if (width === 1280) {
        const noindexCount = await page
          .locator('meta[name="robots"][content*="noindex"]')
          .count();
        ok('/reserve/confirmed has noindex meta', noindexCount > 0);

        const bodyText = await page.locator('main').innerText();
        ok(
          'Confirmed view shows joined slots, hold-until IST time, Postmark stamp and preorder',
          bodyText.includes('SLOT 09 + SLOT 10') &&
            bodyText.includes('Your slot is held until 7:45 PM.') &&
            bodyText.includes('Post Chai') &&
            bodyText.includes('$2.80') &&
            (await page.locator('#booking-postmark').isVisible()),
        );

        const icsHref = await page.locator('#booking-ics').getAttribute('href');
        const icsDecoded = icsHref
          ? decodeURIComponent(
              icsHref.replace(/^data:text\/calendar;charset=utf-8,/, ''),
            )
          : '';
        ok(
          '.ics content has 90-minute Asia/Kolkata event and escaped location',
          icsDecoded.includes('DTSTART;TZID=Asia/Kolkata:20261121T193000') &&
            icsDecoded.includes('DTEND;TZID=Asia/Kolkata:20261121T210000') &&
            icsDecoded.includes('SLOT 09 + SLOT 10') &&
            icsDecoded.includes('Old Sorting Room\\, Post Office Lane'),
        );

        const waHref = await page
          .locator('#booking-whatsapp')
          .getAttribute('href');
        ok(
          'WhatsApp share uses /whatsapp redirect without printing a phone number',
          typeof waHref === 'string' &&
            waHref.startsWith('/whatsapp?text=') &&
            !waHref.includes('wa.me') &&
            !/\d{10}/.test(waHref),
        );

        // Cancel 404 (neutral), 409, then 200
        let cancelAttempt = 0;
        await page.route('**/api/bookings/cancel', (route) => {
          cancelAttempt += 1;
          if (cancelAttempt === 1) {
            return route.fulfill(json(404, { message: 'Booking not found.' }));
          }
          if (cancelAttempt === 2) {
            return route.fulfill(
              json(409, {
                message: 'This booking can no longer be cancelled.',
              }),
            );
          }
          return route.fulfill(json(200, { cancelled: true }));
        });

        await page.locator('#booking-cancel-toggle').click();
        await page.fill('#cancel-last4', '1111');
        await page.locator('#cancel-submit').click();
        await page.locator('#cancel-feedback').waitFor({ state: 'visible' });
        const msg404 = await page.locator('#cancel-feedback').innerText();
        ok(
          'Cancel 404 shows neutral message without saying which field was wrong',
          /could not match that booking code and those four digits/i.test(
            msg404,
          ),
          msg404,
        );

        await page.fill('#cancel-last4', '2222');
        await page.locator('#cancel-submit').click();
        await page.waitForTimeout(250);
        const msg409 = await page.locator('#cancel-feedback').innerText();
        ok(
          'Cancel 409 shows already cancelled or inside two hours message',
          /within two hours/i.test(msg409),
          msg409,
        );

        await page.fill('#cancel-last4', '3210');
        await page.locator('#cancel-submit').click();
        await page
          .locator('#booking-cancel-success')
          .waitFor({ state: 'visible' });
        ok(
          'Cancel 200 updates status chip to cancelled and hides cancel button',
          (await page.locator('#booking-status').innerText())
            .trim()
            .toLowerCase() === 'cancelled' &&
            !(await page.locator('#booking-cancel-toggle').isVisible()),
        );
      }

      await context.close();
    }
  }

  // 11. Confirmation requested state + live 10s polling update + not-found state
  {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.clock.install();

    let pollCount = 0;
    await page.route('**/api/bookings/PH-BK-0100', (route) => {
      pollCount += 1;
      if (pollCount === 1) {
        return route.fulfill(
          json(200, {
            code: 'PH-BK-0100',
            status: 'requested',
            slotLabels: [],
            date: '2026-11-22',
            time: '19:00',
            party: 7,
            holdUntil: '2026-11-22T13:45:00.000Z',
            preorder: { lines: [], total: 0 },
          }),
        );
      }
      return route.fulfill(
        json(200, {
          code: 'PH-BK-0100',
          status: 'confirmed',
          slotLabels: ['SLOT 15', 'SLOT 16'],
          date: '2026-11-22',
          time: '19:00',
          party: 7,
          holdUntil: '2026-11-22T13:45:00.000Z',
          preorder: { lines: [], total: 0 },
        }),
      );
    });

    await page.goto(`${base}/reserve/confirmed?code=PH-BK-0100`, {
      waitUntil: 'networkidle',
    });
    await page.locator('#booking-view').waitFor({ state: 'visible' });
    ok(
      'Requested view shows "We will confirm within the day." and hides confirmed stamp',
      (await page.locator('#booking-message').innerText()).includes(
        'We will confirm within the day.',
      ) && !(await page.locator('#booking-postmark').isVisible()),
    );

    await page.clock.runFor(10_500);
    await page.waitForFunction(
      () =>
        document
          .querySelector('#booking-status')
          ?.textContent?.trim()
          .toLowerCase() === 'confirmed',
      null,
      { timeout: 5000 },
    );
    ok(
      'Requested view polls at 10s and updates chip, stamp and joined slot labels live',
      (await page.locator('[data-ticket-slot]').innerText()).includes(
        'SLOT 15 + SLOT 16',
      ) && (await page.locator('#booking-postmark').isVisible()),
    );

    // Not found state
    await page.route('**/api/bookings/PH-BK-9999', (route) =>
      route.fulfill(json(404, { message: 'Booking not found.' })),
    );
    await page.goto(`${base}/reserve/confirmed?code=PH-BK-9999`, {
      waitUntil: 'networkidle',
    });
    await page.locator('#booking-not-found').waitFor({ state: 'visible' });
    ok(
      'Unknown booking code renders friendly not-found state',
      (await page.locator('#booking-not-found').innerText()).includes(
        'This booking slip is missing.',
      ),
    );
    await context.close();
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL: script error: ${String(error).slice(0, 240)}`);
} finally {
  await browser.close();
  console.log(
    failures ? `\n${failures} CHECK(S) FAILED` : '\nALL RESERVE CHECKS PASSED',
  );
  process.exit(failures ? 1 : 0);
}
