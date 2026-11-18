// Mocked browser check for Phase 5b: /gatherings, /trek-stop, /visit contact form,
// and query-parameter carry-over to /order and /reserve.
// Every API response is mocked; nothing is written to the database.
// Dev server must be running on 127.0.0.1:4321.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

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
  // 1. Responsive layout, overflow, edge clipping, and console errors at 390 px and 1024 px
  for (const [width, height] of [
    [390, 844],
    [1024, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    for (const path of ['/gatherings', '/trek-stop', '/visit']) {
      const start = errors.length;
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(250);

      const newErrors = errors.slice(start);
      ok(
        `${path} at ${width}px: no console errors`,
        newErrors.length === 0,
        newErrors[0] ?? '',
      );

      const layout = await page.evaluate((vw) => {
        const scrollWidth = document.documentElement.scrollWidth;
        const clipped = [];
        for (const el of document.querySelectorAll('main *')) {
          const rect = el.getBoundingClientRect();
          if (
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.right > vw + 1 || rect.left < -1)
          ) {
            clipped.push(
              `${el.tagName.toLowerCase()} left=${Math.round(rect.left)} right=${Math.round(rect.right)}`,
            );
          }
        }
        return { scrollWidth, clipped: clipped.slice(0, 4) };
      }, width);

      ok(
        `${path} at ${width}px: no horizontal overflow`,
        layout.scrollWidth <= width,
        `scrollWidth=${layout.scrollWidth} viewport=${width}`,
      );
      ok(
        `${path} at ${width}px: nothing in main extends past viewport`,
        layout.clipped.length === 0,
        layout.clipped.join('; '),
      );
    }
    await context.close();
  }

  // 2. /gatherings content, anchor chips, JSON-LD, stamp card, combo cart add, and both forms
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
        errors.push(m.text());
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${base}/gatherings`, { waitUntil: 'networkidle' });

    const staticCheck = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-anchor-chips] a')].map(
        (a) => a.getAttribute('href'),
      );
      const targetsExist = ['#open-mic', '#private-tables', '#offers'].every(
        (id) => Boolean(document.querySelector(id)),
      );
      const stampSvg = document.querySelector(
        'svg[role="img"][aria-label="Stamp card, seven of eight stamps collected"]',
      );
      const hasIllustrationWord = /\bIllustration\b/i.test(
        document.body.innerText,
      );
      const hasNoCatering = document.body.innerText.includes(
        'No catering. No delivery.',
      );
      const ldScripts = [
        ...document.querySelectorAll('script[type="application/ld+json"]'),
      ]
        .map((node) => {
          try {
            return JSON.parse(node.textContent ?? '');
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const eventLd = ldScripts.find((entry) => entry['@type'] === 'Event');
      const upcomingCount = document.querySelectorAll(
        '[data-upcoming-open-mics] li',
      ).length;
      return {
        chips,
        targetsExist,
        hasStampSvg: Boolean(stampSvg),
        hasIllustrationWord,
        hasNoCatering,
        eventLd,
        upcomingCount,
      };
    });

    ok(
      '/gatherings: anchor chips match sections',
      staticCheck.targetsExist &&
        staticCheck.chips.join(',') === '#open-mic,#private-tables,#offers',
      staticCheck.chips.join(','),
    );
    ok(
      '/gatherings: stamp card SVG label and Illustration word present',
      staticCheck.hasStampSvg && staticCheck.hasIllustrationWord,
    );
    ok(
      '/gatherings: next three open-mic dates and No catering line shown',
      staticCheck.upcomingCount === 3 && staticCheck.hasNoCatering,
    );
    ok(
      '/gatherings: Event JSON-LD uses date-only startDate and demo description',
      Boolean(
        staticCheck.eventLd &&
        /^\d{4}-\d{2}-\d{2}$/.test(staticCheck.eventLd.startDate) &&
        String(staticCheck.eventLd.description).toLowerCase().includes('demo'),
      ),
      staticCheck.eventLd?.startDate ?? '',
    );

    // Postmark Combo adds PH0215 to shared cart
    await page.click('[data-add-combo="PH0215"]');
    const cartRaw = await page.evaluate(() =>
      localStorage.getItem('ph_cart_v1'),
    );
    ok(
      '/gatherings: Postmark Combo adds PH0215 to shared cart',
      Boolean(cartRaw && cartRaw.includes('PH0215')),
      cartRaw ?? '',
    );

    // Open-mic form validation (inline aria-describedby)
    await page.click('[data-open-mic-form] button[type="submit"]');
    const openMicInvalid = await page.evaluate(() => {
      const nameInput = document.querySelector('#open-mic-name');
      const described = nameInput?.getAttribute('aria-describedby');
      return Boolean(
        nameInput?.getAttribute('aria-invalid') === 'true' &&
        described &&
        document.getElementById(described)?.textContent,
      );
    });
    ok(
      'Open-mic form: inline validation ties errors with aria-describedby',
      openMicInvalid,
    );

    // Open-mic 429 rate limit
    await page.route('**/api/enquiries', (route) =>
      route.fulfill(
        json(429, { message: 'Internal rate limit text', retryAfter: 3600 }),
      ),
    );
    await page.fill('#open-mic-name', 'Mira Demo');
    await page.fill('#open-mic-phone', '+919876543210');
    await page.selectOption('#open-mic-type', 'Poetry');
    await page.fill('#open-mic-notes', 'Two short poems');
    await page.check('#open-mic-consent');
    await page.click('[data-open-mic-form] button[type="submit"]');
    await page
      .locator('[data-open-mic-form] [role="alert"]')
      .waitFor({ state: 'visible', timeout: 5000 });
    const openMic429 = await page
      .locator('[data-open-mic-form] [role="alert"]')
      .textContent();
    ok(
      'Open-mic form: 429 shows fixed rate-limit copy',
      openMic429?.trim() === 'Too many enquiries. Please try again later.',
      openMic429 ?? '',
    );

    // Open-mic 500 does not echo raw server text
    await page.unroute('**/api/enquiries');
    await page.route('**/api/enquiries', (route) =>
      route.fulfill(json(500, { message: 'secret postgres failure' })),
    );
    await page.click('[data-open-mic-form] button[type="submit"]');
    await page.waitForTimeout(150);
    const openMic500 = await page
      .locator('[data-open-mic-form] [role="alert"]')
      .textContent();
    ok(
      'Open-mic form: 500 hides raw server text',
      Boolean(openMic500 && !openMic500.includes('postgres')),
      openMic500 ?? '',
    );

    // Open-mic 201 + double-submit guard + strict body check + no phone in storage
    await page.unroute('**/api/enquiries');
    const openMicPayloads = [];
    await page.route('**/api/enquiries', async (route) => {
      openMicPayloads.push(route.request().postDataJSON());
      await delay(150);
      return route.fulfill(json(201, { reference: 'ENQ-11223344' }));
    });
    await page.evaluate(() => {
      const btn = document.querySelector(
        '[data-open-mic-form] button[type="submit"]',
      );
      if (btn) {
        btn.click();
        btn.click();
        btn.click();
      }
    });
    await page
      .locator('[data-open-mic-success]')
      .waitFor({ state: 'visible', timeout: 5000 });
    const openMicSuccessText = await page
      .locator('[data-open-mic-success]')
      .textContent();
    const openMicBody = openMicPayloads[0];
    const phoneInStorage = await page.evaluate(() => {
      const combined = [
        ...Object.values(window.localStorage),
        ...Object.values(window.sessionStorage),
      ].join(' ');
      return combined.includes('9876543210');
    });
    ok(
      'Open-mic form: double-submit guard sends exactly 1 request',
      openMicPayloads.length === 1,
      `count=${openMicPayloads.length}`,
    );
    ok(
      'Open-mic form: strict payload keys and 201 reference shown',
      Boolean(
        openMicBody &&
        openMicBody.kind === 'open_mic' &&
        openMicBody.honeypot === '' &&
        typeof openMicBody.mountedAt === 'number' &&
        openMicBody.consent === true &&
        openMicSuccessText?.includes('ENQ-11223344') &&
        openMicSuccessText?.includes('Signed up. The team will confirm.'),
      ),
    );
    ok('Open-mic form: phone number not stored in browser', !phoneInStorage);

    // Private-table form: Mondays disabled, party 7-12, 24h notice for 8+, 422, 400, 201
    const privateMeta = await page.evaluate(() => {
      const dateOptions = [
        ...document.querySelectorAll('#private-date option'),
      ];
      const mondayOptions = dateOptions.filter((o) =>
        o.textContent?.includes('Monday'),
      );
      const allMondaysDisabled =
        mondayOptions.length > 0 && mondayOptions.every((o) => o.disabled);
      const partyValues = [
        ...document.querySelectorAll('#private-party option'),
      ].map((o) => Number(o.value));
      return { allMondaysDisabled, partyValues };
    });
    ok(
      'Private-table form: Mondays are disabled in date selector',
      privateMeta.allMondaysDisabled,
    );
    ok(
      'Private-table form: party sizes strictly 7 to 12',
      privateMeta.partyValues.join(',') === '7,8,9,10,11,12',
      privateMeta.partyValues.join(','),
    );

    await page.selectOption('#private-party', '8');
    const noticeText = await page.locator('#private-party-hint').textContent();
    ok(
      'Private-table form: groups of 8+ show 24 hour notice sentence',
      Boolean(noticeText?.includes("24 hours' notice")),
      noticeText ?? '',
    );

    await page.fill('#private-name', 'Rohan Demo');
    await page.fill('#private-phone', '+919876543211');
    await page.selectOption('#private-occasion', 'Birthday');

    await page.unroute('**/api/enquiries');
    await page.route('**/api/enquiries', (route) =>
      route.fulfill(json(422, { message: 'Choose another date or time.' })),
    );
    await page.click('[data-private-table-form] button[type="submit"]');
    await page
      .locator('[data-private-table-form] [role="alert"]')
      .waitFor({ state: 'visible', timeout: 5000 });
    const private422 = await page
      .locator('[data-private-table-form] [role="alert"]')
      .textContent();
    ok(
      'Private-table form: 422 displays booking-rule error',
      Boolean(private422?.includes('booking rules')),
      private422 ?? '',
    );

    await page.unroute('**/api/enquiries');
    const privatePayloads = [];
    await page.route('**/api/enquiries', (route) => {
      privatePayloads.push(route.request().postDataJSON());
      return route.fulfill(json(201, { reference: 'ENQ-55667788' }));
    });
    await page.click('[data-private-table-form] button[type="submit"]');
    await page
      .locator('[data-private-table-success]')
      .waitFor({ state: 'visible', timeout: 5000 });
    const privateSuccess = await page
      .locator('[data-private-table-success]')
      .textContent();
    const privateBody = privatePayloads[0];
    ok(
      'Private-table form: strict payload keys and 201 reference shown',
      Boolean(
        privateBody &&
        privateBody.kind === 'private_table' &&
        privateBody.partySize === 8 &&
        privateBody.honeypot === '' &&
        typeof privateBody.mountedAt === 'number' &&
        privateSuccess?.includes('ENQ-55667788') &&
        privateSuccess?.includes('The team will confirm within the day.'),
      ),
    );
    ok(
      '/gatherings: zero unexpected console errors',
      errors.length === 0,
      errors[0] ?? '',
    );

    await context.close();
  }

  // 3. /visit general contact form
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(`${base}/visit`, { waitUntil: 'networkidle' });

    await page.click('[data-general-contact-form] button[type="submit"]');
    const visitInvalid = await page.evaluate(() => {
      const input = document.querySelector('#visit-contact');
      const id = input?.getAttribute('aria-describedby');
      return Boolean(
        input?.getAttribute('aria-invalid') === 'true' &&
        id &&
        document.getElementById(id)?.textContent,
      );
    });
    ok(
      '/visit contact form: inline validation ties errors with aria-describedby',
      visitInvalid,
    );

    const generalPayloads = [];
    await page.route('**/api/enquiries', (route) => {
      generalPayloads.push(route.request().postDataJSON());
      return route.fulfill(json(201, { reference: 'ENQ-99AABBCC' }));
    });

    await page.fill('#visit-name', 'Ananya Demo');
    await page.fill('#visit-contact', 'ananya@example.com');
    await page.fill(
      '#visit-message',
      'Checking whether outdoor tables are shaded at noon.',
    );
    await page.click('[data-general-contact-form] button[type="submit"]');
    await page
      .locator('[data-general-contact-success]')
      .waitFor({ state: 'visible', timeout: 5000 });
    const generalSuccess = await page
      .locator('[data-general-contact-success]')
      .textContent();
    const body = generalPayloads[0];
    ok(
      '/visit contact form: strict general payload and 201 reference shown',
      Boolean(
        body &&
        body.kind === 'general' &&
        body.email === 'ananya@example.com' &&
        !('phone' in body) &&
        body.honeypot === '' &&
        typeof body.mountedAt === 'number' &&
        generalSuccess?.includes('ENQ-99AABBCC'),
      ),
    );

    await context.close();
  }

  // 4. /trek-stop: 3 groups, cart add, pickup carry-over to /order, Sunday planner carry-over to /reserve
  {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 900 },
    });
    const page = await context.newPage();
    await page.route('**/api/availability**', (route) =>
      route.fulfill(
        json(200, {
          times: [
            { time: '08:00', remaining: 4, requestable: false },
            { time: '09:00', remaining: 2, requestable: false },
          ],
        }),
      ),
    );

    await page.goto(`${base}/trek-stop`, { waitUntil: 'networkidle' });

    const trekCheck = await page.evaluate(() => {
      const groups = [
        document.querySelectorAll('[data-trek-group="before-you-go"] article')
          .length,
        document.querySelectorAll('[data-trek-group="take-with-you"] article')
          .length,
        document.querySelectorAll(
          '[data-trek-group="when-you-come-back"] article',
        ).length,
      ];
      const banner =
        document.querySelector('[data-season-banner]')?.textContent?.trim() ??
        '';
      return { groups, banner };
    });
    ok(
      '/trek-stop: renders 3 dish groups with all 13 curated items',
      trekCheck.groups.join(',') === '4,3,6',
      trekCheck.groups.join(','),
    );
    ok(
      '/trek-stop: season banner rendered',
      trekCheck.banner.includes('Trek season'),
      trekCheck.banner,
    );

    // Add Trek Fuel Pack and verify mini cart summary updates
    await page.click('[data-add-to-cart="PH0227"]');
    await page.waitForTimeout(150);
    const bagCount = await page.locator('[data-trek-cart-count]').textContent();
    ok(
      '/trek-stop: adding Trek Fuel Pack updates mini cart summary',
      Boolean(bagCount?.includes('1 item')),
      bagCount ?? '',
    );

    // Pick a valid pickup time and carry over via ?pickup= to /order
    const chosenPickup = await page.evaluate(() => {
      const dateSel = document.querySelector('#trek-pickup-date');
      const timeSel = document.querySelector('#trek-pickup-time');
      const availableTimes = [...(timeSel?.options ?? [])].filter(
        (opt) => !opt.disabled && opt.value,
      );
      const targetTime =
        availableTimes[Math.min(1, availableTimes.length - 1)]?.value ?? '';
      return { date: dateSel?.value ?? '', time: targetTime };
    });
    if (chosenPickup.time) {
      await page.selectOption('#trek-pickup-time', chosenPickup.time);
    }
    const orderHref = await page
      .locator('[data-trek-go-order]')
      .getAttribute('href');
    ok(
      '/trek-stop: Go to order carries ?pickup= query parameter',
      Boolean(orderHref && orderHref.startsWith('/order?pickup=')),
      orderHref ?? '',
    );

    await Promise.all([
      page.waitForURL((url) => url.pathname === '/order', { timeout: 10000 }),
      page.click('[data-trek-go-order]'),
    ]);
    // Wait for the island to hydrate and apply the query parameter instead of a fixed delay.
    await page
      .waitForFunction(
        () => document.querySelector('#pickup-time-select')?.value,
        null,
        { timeout: 10000 },
      )
      .catch(() => undefined);
    const orderPreselected = await page.evaluate(() => {
      const scheduledRadio = document.querySelector(
        'input[name="pickup_mode"][value="scheduled"]',
      );
      const timeSelect = document.querySelector('#pickup-time-select');
      const dateSelect = document.querySelector('#pickup-date-select');
      return {
        scheduledChecked: Boolean(scheduledRadio?.checked),
        dateValue: dateSelect?.value ?? '',
        timeValue: timeSelect?.value ?? '',
      };
    });
    ok(
      '/order: ?pickup= preselects scheduled pickup date and time',
      orderPreselected.scheduledChecked &&
        orderPreselected.dateValue === chosenPickup.date &&
        orderPreselected.timeValue === chosenPickup.time,
      JSON.stringify(orderPreselected),
    );

    // Invalid ?pickup= is ignored cleanly
    await page.goto(`${base}/order?pickup=2026-11-23T12:00:00%2B05:30`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(250);
    const invalidPickupState = await page.evaluate(() => {
      const scheduledRadio = document.querySelector(
        'input[name="pickup_mode"][value="scheduled"]',
      );
      const dateSelect = document.querySelector('#pickup-date-select');
      return {
        scheduledChecked: Boolean(scheduledRadio?.checked),
        dateValue: dateSelect?.value ?? '',
      };
    });
    ok(
      '/order: invalid Monday ?pickup= is ignored',
      invalidPickupState.dateValue !== '2026-11-23',
      JSON.stringify(invalidPickupState),
    );

    // Back to /trek-stop: Sunday planner updates aria-live and carries ?date= to /reserve
    await page.goto(`${base}/trek-stop`, { waitUntil: 'networkidle' });
    const sundayOptions = await page.evaluate(() =>
      [...document.querySelectorAll('#sunday-planner-select option')].map(
        (opt) => opt.value,
      ),
    );
    const pickedSunday = sundayOptions[1] ?? sundayOptions[0] ?? '';
    await page.selectOption('#sunday-planner-select', pickedSunday);
    const planText = await page
      .locator('[data-sunday-plan-result]')
      .textContent();
    ok(
      '/trek-stop: Sunday planner announces opening hours via aria-live',
      Boolean(
        planText &&
        (planText.includes('Opens 7:00 AM') ||
          planText.includes('Opens 8:00 AM')) &&
        planText.includes('Closes 11:00 PM'),
      ),
      planText ?? '',
    );

    await Promise.all([
      page.waitForURL((url) => url.pathname === '/reserve', { timeout: 10000 }),
      page.click('[data-reserve-sunday]'),
    ]);
    await page
      .waitForSelector('[role="gridcell"] button[aria-pressed="true"]', {
        timeout: 10000,
      })
      .catch(() => undefined);
    const reserveSelectedDate = await page.evaluate(() => {
      const selected = document.querySelector(
        '[role="gridcell"] button[aria-pressed="true"]',
      );
      return selected?.getAttribute('data-date') ?? window.location.hash;
    });
    ok(
      '/reserve: ?date=YYYY-MM-DD from Sunday planner preselects that Sunday',
      reserveSelectedDate.includes(pickedSunday),
      `${reserveSelectedDate} vs ${pickedSunday}`,
    );

    // Invalid Monday ?date= on /reserve is ignored
    await page.goto(`${base}/reserve?date=2026-11-23`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(300);
    const reserveAfterMonday = await page.evaluate(() => window.location.hash);
    ok(
      '/reserve: closed Monday ?date= is ignored',
      !reserveAfterMonday.includes('date=2026-11-23'),
      reserveAfterMonday,
    );

    await context.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(
    `\nGatherings / Trek Stop check failed with ${failures} failure(s).`,
  );
  process.exit(1);
}
console.log('\nGatherings / Trek Stop check passed.');
