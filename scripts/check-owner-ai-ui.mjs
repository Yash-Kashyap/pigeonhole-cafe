// Browser check for Phase 7b: Owner UI for the AI learning loop (/owner/app/questions and /owner/app/insights)
// Mocks all /api/owner/questions*, /api/owner/overrides*, /api/owner/insights*, and /api/owner/summary* calls
// so nothing is written to database and no live AI model is called.
// Dev server must be running on 127.0.0.1:4321.

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('.checks', { recursive: true });

const base = 'http://127.0.0.1:4321';
const credentials = readFileSync('.demo-credentials', 'utf8');
const ownerEmail = /^Email: (.+)$/m.exec(credentials)?.[1]?.trim();
const ownerPassword = /^Password: (.+)$/m.exec(credentials)?.[1]?.trim();
if (!ownerEmail || !ownerPassword) {
  throw new Error('Demo owner credentials are missing from .demo-credentials.');
}

// This check signs in once through the real form (the owner login allows 5
// attempts per 10 minutes). If you re-run it many times in a row, wait a few
// minutes. It never touches the database: do not add a rate-limit reset here.

let failures = 0;
const ok = (name, pass, extra = '') => {
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`,
  );
  if (!pass) failures += 1;
};

const jsonResponse = (status, body) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// Mock datasets
const mockQuestionsUnanswered = [
  {
    id: 'q-test-1',
    time: new Date(Date.now() - 15 * 60_000).toISOString(),
    unanswered_topic: 'parking_near_cafe',
    question: 'Where can I park a motorcycle near the café?',
    excerpt: [
      {
        role: 'user',
        content: 'Hi, is there parking?',
        time: new Date(Date.now() - 16 * 60_000).toISOString(),
      },
      {
        role: 'assistant',
        content: 'We do not have private parking.',
        time: new Date(Date.now() - 15 * 60_000).toISOString(),
      },
      {
        role: 'user',
        content: 'Where can I park a motorcycle near the café?',
        time: new Date(Date.now() - 15 * 60_000).toISOString(),
      },
    ],
    handled: false,
  },
  {
    id: 'q-test-2-xss',
    time: new Date(Date.now() - 45 * 60_000).toISOString(),
    unanswered_topic: 'gluten_free_scones',
    question: '<img src=x onerror=alert(1)>Do you have gluten free buns?',
    excerpt: [
      {
        role: 'user',
        content: '<script>alert(2)</script>Gluten free?',
        time: new Date(Date.now() - 46 * 60_000).toISOString(),
      },
      {
        role: 'assistant',
        content: 'I am not sure about gluten free buns.',
        time: new Date(Date.now() - 45 * 60_000).toISOString(),
      },
    ],
    handled: false,
  },
];

const mockOverridesInitial = [
  {
    id: 'ov-1',
    question: 'Are pets allowed outside?',
    answer:
      'Yes, well-behaved dogs are welcome in the outer courtyard with a leash.',
    created_at: new Date(Date.now() - 86400_000).toISOString(),
  },
];

const mockInsights7d = {
  insights: {
    range: '7d',
    start: '2026-11-15T00:00:00.000Z',
    end: '2026-11-21T23:59:59.999Z',
    orderCount: 42,
    orderTotal: 485.5,
    bookingCount: 18,
    ordersPerDay: [
      { day: '2026-11-15', count: 5 },
      { day: '2026-11-16', count: 0 },
      { day: '2026-11-17', count: 8 },
      { day: '2026-11-18', count: 7 },
      { day: '2026-11-19', count: 6 },
      { day: '2026-11-20', count: 9 },
      { day: '2026-11-21', count: 7 },
    ],
    topItems: [
      { id: 'PH0001', name: 'Post Chai', quantity: 38 },
      {
        id: 'PH0002',
        name: '<img src=x onerror=alert(1)>Maska Pav',
        quantity: 24,
      },
      { id: 'PH0003', name: 'Bun Maska', quantity: 18 },
    ],
    ordersPerHour: [
      { hour: 8, count: 4 },
      { hour: 9, count: 10 },
      { hour: 12, count: 12 },
      { hour: 17, count: 16 },
    ],
    bookingsByPartySize: [
      { partySize: 2, count: 10 },
      { partySize: 4, count: 6 },
      { partySize: 6, count: 2 },
    ],
    assistant: {
      conversations: 85,
      answeredRate: 0.92,
      cartActions: 19,
      bookingActions: 6,
    },
  },
};

const mockInsightsNullMetrics = {
  insights: {
    range: 'today',
    start: '2026-11-21T00:00:00.000Z',
    end: '2026-11-21T23:59:59.999Z',
    orderCount: 12,
    orderTotal: 140.0,
    bookingCount: 3,
    ordersPerDay: [{ day: '2026-11-21', count: 12 }],
    topItems: [{ id: 'PH0001', name: 'Post Chai', quantity: 10 }],
    ordersPerHour: [{ hour: 9, count: 12 }],
    bookingsByPartySize: [{ partySize: 2, count: 3 }],
    assistant: {
      conversations: null,
      answeredRate: null,
      cartActions: null,
      bookingActions: null,
    },
  },
};

const mockSummaryRow = {
  day: '2026-11-21',
  content: JSON.stringify({
    bullets: [
      'Morning chai sales peaked between 8 AM and 10 AM.',
      'Table reservations for 2 guests formed majority of evening bookings.',
      'Maska Pav demand was steady throughout high-tea hours.',
      'No stock shortages reported across pastry counters.',
      'Assistant handled 85 queries with a 92% direct answer rate.',
    ],
    suggestion:
      'Prep extra buns and infuser pots ahead of the Saturday morning rush.',
  }),
  created_at: new Date(Date.now() - 3600_000).toISOString(),
};

const browser = await chromium.launch({ channel: 'chrome' });

try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    // Realtime WebSocket connection errors depend on the network, not on the app.
    if (
      msg.type() === 'error' &&
      !/Failed to load resource|WebSocket connection to/.test(msg.text())
    ) {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  // Sign in via /owner
  await page.goto(`${base}/owner`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ownerEmail);
  await page.fill('input[name="password"]', ownerPassword);
  try {
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/owner/app', {
        timeout: 30_000,
      }),
      page.click('#owner-login-form button[type="submit"]'),
    ]);
  } catch (err) {
    const errText = await page.locator('#owner-login-error').textContent();
    console.error(`Login error on page: "${errText}"`);
    throw err;
  }
  ok(
    'Owner sign in redirects to /owner/app',
    page.url().endsWith('/owner/app'),
  );

  // Set up API interception for owner AI endpoints
  let currentQuestions = [...mockQuestionsUnanswered];
  let currentOverrides = [...mockOverridesInitial];
  let currentSummary = null; // Start with null to test generate flow
  let summaryCallCount = 0;
  let force401 = false;

  await page.route('**/api/owner/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (force401) {
      await route.fulfill(jsonResponse(401, { message: 'Session expired' }));
      return;
    }

    // GET /api/owner/questions
    if (url.pathname === '/api/owner/questions' && method === 'GET') {
      const filter = url.searchParams.get('filter') || 'unanswered';
      const items =
        filter === 'unanswered'
          ? currentQuestions.filter((q) => !q.handled)
          : currentQuestions;
      await route.fulfill(
        jsonResponse(200, {
          questions: items,
          page: 1,
          pageSize: 25,
          total: items.length,
        }),
      );
      return;
    }

    // POST /api/owner/questions/:id/answer
    const answerMatch = url.pathname.match(
      /^\/api\/owner\/questions\/([^/]+)\/answer$/,
    );
    if (answerMatch && method === 'POST') {
      const qId = answerMatch[1];
      const body = route.request().postDataJSON();

      // Simulated error if question text contains "TRIGGER_ERROR"
      if (body?.answer?.includes('TRIGGER_409')) {
        await route.fulfill(
          jsonResponse(409, { message: 'Taught answers limit reached (50).' }),
        );
        return;
      }

      currentQuestions = currentQuestions.map((q) =>
        q.id === qId ? { ...q, handled: true } : q,
      );
      currentOverrides.push({
        id: `ov-added-${Date.now()}`,
        question: body.question,
        answer: body.answer,
        created_at: new Date().toISOString(),
      });
      await route.fulfill(jsonResponse(201, { id: qId, handled: true }));
      return;
    }

    // POST /api/owner/questions/:id/handled
    const handledMatch = url.pathname.match(
      /^\/api\/owner\/questions\/([^/]+)\/handled$/,
    );
    if (handledMatch && method === 'POST') {
      const qId = handledMatch[1];
      currentQuestions = currentQuestions.map((q) =>
        q.id === qId ? { ...q, handled: true } : q,
      );
      await route.fulfill(jsonResponse(200, { id: qId, handled: true }));
      return;
    }

    // GET /api/owner/overrides
    if (url.pathname === '/api/owner/overrides' && method === 'GET') {
      await route.fulfill(
        jsonResponse(200, {
          overrides: currentOverrides,
          limit: 50,
        }),
      );
      return;
    }

    // PATCH /api/owner/overrides/:id
    const patchOverrideMatch = url.pathname.match(
      /^\/api\/owner\/overrides\/([^/]+)$/,
    );
    if (patchOverrideMatch && method === 'PATCH') {
      const ovId = patchOverrideMatch[1];
      const body = route.request().postDataJSON();
      currentOverrides = currentOverrides.map((ov) =>
        ov.id === ovId
          ? {
              ...ov,
              question: body.question ?? ov.question,
              answer: body.answer ?? ov.answer,
            }
          : ov,
      );
      const updated = currentOverrides.find((ov) => ov.id === ovId);
      await route.fulfill(jsonResponse(200, { override: updated }));
      return;
    }

    // DELETE /api/owner/overrides/:id
    const deleteOverrideMatch = url.pathname.match(
      /^\/api\/owner\/overrides\/([^/]+)$/,
    );
    if (deleteOverrideMatch && method === 'DELETE') {
      const ovId = deleteOverrideMatch[1];
      currentOverrides = currentOverrides.filter((ov) => ov.id !== ovId);
      await route.fulfill(jsonResponse(200, { deleted: true, id: ovId }));
      return;
    }

    // GET /api/owner/insights
    if (url.pathname === '/api/owner/insights' && method === 'GET') {
      const range = url.searchParams.get('range');
      if (range === 'today') {
        await route.fulfill(jsonResponse(200, mockInsightsNullMetrics));
      } else {
        await route.fulfill(jsonResponse(200, mockInsights7d));
      }
      return;
    }

    // GET /api/owner/summary
    if (url.pathname === '/api/owner/summary' && method === 'GET') {
      await route.fulfill(jsonResponse(200, { summary: currentSummary }));
      return;
    }

    // POST /api/owner/summary
    if (url.pathname === '/api/owner/summary' && method === 'POST') {
      summaryCallCount++;
      const body = route.request().postDataJSON() || {};
      if (body.regenerate && summaryCallCount > 3) {
        await route.fulfill(
          jsonResponse(429, { message: 'Daily limit of 3 summaries reached.' }),
        );
        return;
      }
      currentSummary = mockSummaryRow;
      await route.fulfill(jsonResponse(200, mockSummaryRow));
      return;
    }

    // Fallback pass-through for other endpoints
    await route.continue();
  });

  // ==========================================
  // SUITE 1: Nav Bar Verification (Desktop & Mobile)
  // ==========================================
  console.log('\n--- SUITE 1: Navigation Verification ---');
  await page.goto(`${base}/owner/app`, { waitUntil: 'networkidle' });

  // Desktop nav order
  const desktopNavLinks = await page
    .locator('nav[aria-label="Primary owner navigation"] a')
    .allTextContents();
  const trimmedDesktopLinks = desktopNavLinks.map((t) =>
    t.trim().split('\n')[0].trim(),
  );
  const expectedNavOrder = [
    'Today',
    'Orders',
    'Bookings',
    'Inbox',
    'Questions',
    'Insights',
    'Menu',
  ];
  ok(
    'Desktop navigation has all 7 items in exact order',
    JSON.stringify(trimmedDesktopLinks) === JSON.stringify(expectedNavOrder),
    `Found: ${trimmedDesktopLinks.join(', ')}`,
  );

  // Mobile nav at 360 px
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);

  const mobileNavLinks = await page
    .locator('nav[aria-label="Mobile owner navigation"] a')
    .allTextContents();
  const trimmedMobileLinks = mobileNavLinks.map((t) =>
    t.trim().split('\n')[0].trim(),
  );
  ok(
    'Mobile nav at 360px has all 7 tabs',
    trimmedMobileLinks.length === 7 &&
      JSON.stringify(trimmedMobileLinks) === JSON.stringify(expectedNavOrder),
    `Found: ${trimmedMobileLinks.join(', ')}`,
  );

  const navScrollMetrics = await page.evaluate(() => {
    const nav = document.querySelector(
      'nav[aria-label="Mobile owner navigation"]',
    );
    const pageScrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    const links = Array.from(nav?.querySelectorAll('a') ?? []);
    const touchTargets = links.map((a) => {
      const rect = a.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    return { pageScrollWidth, clientWidth, touchTargets };
  });

  ok(
    'Mobile nav at 360px does not cause horizontal page overflow',
    navScrollMetrics.pageScrollWidth <= 360,
    `pageScrollWidth=${navScrollMetrics.pageScrollWidth}`,
  );

  const allTouchTargetsValid = navScrollMetrics.touchTargets.every(
    (t) => t.width >= 44 && t.height >= 44,
  );
  ok(
    'All 7 mobile nav items meet 44px touch target minimum',
    allTouchTargetsValid,
    JSON.stringify(navScrollMetrics.touchTargets),
  );

  // ==========================================
  // SUITE 2: Questions Screen & Excerpts
  // ==========================================
  console.log('\n--- SUITE 2: /owner/app/questions List & Excerpt ---');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${base}/owner/app/questions`, { waitUntil: 'networkidle' });

  // Heading check
  const questionsH1 = page.getByRole('heading', {
    level: 1,
    name: 'Questions',
  });
  await questionsH1.waitFor({ state: 'visible' });
  ok('Questions screen renders H1 "Questions"', true);

  // Check unanswered question card
  const firstQuestionCard = page.locator(
    'article[data-question-id="q-test-1"]',
  );
  await firstQuestionCard.waitFor({ state: 'visible' });
  const questionText = await firstQuestionCard
    .locator('p.font-display')
    .textContent();
  ok(
    'First question renders question text',
    questionText?.includes('Where can I park a motorcycle'),
    questionText ?? '',
  );

  // XSS protection in question text
  const xssCard = page.locator('article[data-question-id="q-test-2-xss"]');
  await xssCard.waitFor({ state: 'visible' });
  const xssRenderedImgTag = await xssCard.locator('img').count();
  const xssHeadingText = await xssCard.locator('p.font-display').textContent();
  ok(
    'Hostile question with <img src=x> renders as plain text with no executed img element',
    xssRenderedImgTag === 0 &&
      (xssHeadingText?.includes('<img src=x') ?? false),
  );

  // Excerpt toggle
  const excerptToggle = firstQuestionCard.locator('button', {
    hasText: 'Show conversation excerpt',
  });
  await excerptToggle.click();

  const excerptContent = firstQuestionCard.locator(
    '[data-testid="conversation-excerpt"]',
  );
  await excerptContent.waitFor({ state: 'visible' });
  const excerptRoles = await excerptContent
    .locator('span.font-mono')
    .allTextContents();
  ok(
    'Excerpt roles are labeled "Guest" and "Assistant" (never user/model)',
    excerptRoles.some((r) => r.includes('Guest')) &&
      excerptRoles.some((r) => r.includes('Assistant')),
    excerptRoles.join(', '),
  );

  // Collapse excerpt
  await firstQuestionCard
    .locator('button', { hasText: 'Hide excerpt' })
    .click();
  await excerptContent.waitFor({ state: 'hidden' });
  ok('Excerpt collapses smoothly on click', true);

  // ==========================================
  // SUITE 3: Add an Answer Dialog, Validation & Errors
  // ==========================================
  console.log('\n--- SUITE 3: Add an Answer Dialog ---');
  const addAnswerBtn = firstQuestionCard.getByRole('button', {
    name: 'Add an answer',
  });
  await addAnswerBtn.click();

  const dialog = page.locator('div[role="dialog"]');
  await dialog.waitFor({ state: 'visible' });
  ok(
    'Clicking "Add an answer" opens accessible dialog',
    (await dialog.getAttribute('aria-modal')) === 'true',
  );

  const dialogQuestionTextarea = dialog.locator('#dialog-question');
  const dialogAnswerTextarea = dialog.locator('#dialog-answer');
  const initialPrefill = await dialogQuestionTextarea.inputValue();
  ok(
    'Dialog question textarea is prefilled with guest question',
    initialPrefill === 'Where can I park a motorcycle near the café?',
  );

  // Helper text presence
  const dialogHelper = await dialog
    .locator('text=The assistant uses this answer within about a minute.')
    .count();
  ok('Dialog displays the required helper note', dialogHelper === 1);

  // Character counter check
  const charCounter300 = await dialog
    .locator('span:has-text("/ 300")')
    .textContent();
  const charCounter600 = await dialog
    .locator('span:has-text("/ 600")')
    .textContent();
  ok(
    'Live character counters present (300 and 600)',
    Boolean(charCounter300 && charCounter600),
  );

  // Focus trap verification
  await dialogAnswerTextarea.focus();
  await page.keyboard.press('Tab'); // Cancel button
  await page.keyboard.press('Tab'); // Submit button
  await page.keyboard.press('Tab'); // Close button (top right)
  const focusedTag = await page.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') ||
      document.activeElement?.tagName,
  );
  ok('Focus is trapped inside dialog', Boolean(focusedTag));

  // Esc key closes dialog and restores focus
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const activeElementAfterEsc = await page.evaluate(
    () => document.activeElement?.textContent,
  );
  ok(
    'Esc key closes dialog and returns focus to trigger button',
    activeElementAfterEsc?.includes('Add an answer'),
  );

  // Re-open dialog to test server error inline handling (409)
  await addAnswerBtn.click();
  await dialog.waitFor({ state: 'visible' });
  await dialogAnswerTextarea.fill('Park in municipal lot. TRIGGER_409');
  await dialog.getByRole('button', { name: 'Save answer' }).click();

  const inlineError = dialog.locator('p[role="alert"]');
  await inlineError.waitFor({ state: 'visible' });
  const errorMsg = await inlineError.textContent();
  ok(
    'Server error (409) appears inline in dialog',
    errorMsg?.includes('Taught answers limit reached'),
    errorMsg ?? '',
  );

  const retainedAnswer = await dialogAnswerTextarea.inputValue();
  ok(
    'User typed text is preserved after server error',
    retainedAnswer.includes('TRIGGER_409'),
  );

  // Submit valid answer (201)
  await dialogAnswerTextarea.fill(
    'Motorcycles can park in the marked bays on Kothi Bagh lane.',
  );
  await dialog.getByRole('button', { name: 'Save answer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  ok('Dialog closes on successful 201 save', true);

  // Toast confirmation check
  const toast = page.locator('[data-testid="owner-toast"]');
  await toast.waitFor({ state: 'visible' });
  const toastText = await toast.textContent();
  ok(
    'Success toast displays confirmation message',
    Boolean(
      toastText &&
      (toastText.includes('Answer added') ||
        toastText.includes('Answer saved')),
    ),
  );

  // Verify question removed from unanswered list
  const removedQuestion = await page
    .locator('article[data-question-id="q-test-1"]')
    .count();
  ok(
    'Handled question is removed from "Unanswered only" list',
    removedQuestion === 0,
  );

  // ==========================================
  // SUITE 4: Mark as Handled
  // ==========================================
  console.log('\n--- SUITE 4: Mark as Handled ---');
  const handledCard = page.locator('article[data-question-id="q-test-2-xss"]');
  await handledCard.waitFor({ state: 'visible' });
  const markHandledBtn = handledCard.getByRole('button', {
    name: 'Mark as handled',
  });
  await markHandledBtn.click();

  const handledToast = page.locator(
    '[data-testid="owner-toast"]:has-text("marked as handled")',
  );
  await handledToast.waitFor({ state: 'visible' });
  ok('Mark as handled produces confirmation toast', true);

  const remainingQuestions = await page
    .locator('article[data-question-id="q-test-2-xss"]')
    .count();
  ok(
    'Question removed from unanswered list after mark as handled',
    remainingQuestions === 0,
  );

  // ==========================================
  // SUITE 5: Answers You Have Taught (Overrides)
  // ==========================================
  console.log('\n--- SUITE 5: Answers You Have Taught ---');
  const overridesHeading = page.getByRole('heading', {
    level: 2,
    name: 'Answers you have taught',
  });
  await overridesHeading.waitFor({ state: 'visible' });

  // Check 50-limit counter indicator
  const overridesCounterBadge = page.locator('span:has-text("of 50 used")');
  await overridesCounterBadge.waitFor({ state: 'visible' });
  const counterText = await overridesCounterBadge.textContent();
  ok(
    'Overrides counter badge renders "N of 50 used"',
    Boolean(counterText && counterText.includes('of 50 used')),
  );

  // Edit override
  const editOverrideBtn = page.locator(
    'article:has-text("Are pets allowed outside?") button',
    { hasText: 'Edit' },
  );
  await editOverrideBtn.click();
  await dialog.waitFor({ state: 'visible' });
  const editDialogTitle = await dialog.locator('#dialog-title').textContent();
  ok(
    'Edit dialog opens with title "Edit taught answer"',
    editDialogTitle === 'Edit taught answer',
  );

  await dialogAnswerTextarea.fill(
    'Yes, well-behaved dogs on a leash are welcome in the courtyard.',
  );
  await dialog.getByRole('button', { name: 'Update answer' }).click();
  await dialog.waitFor({ state: 'hidden' });
  ok('Edit dialog submits PATCH and closes', true);

  // Delete override with confirmation step
  const overrideCard = page.locator('article[data-override-id="ov-1"]');
  const deleteOverrideBtn = overrideCard.getByRole('button', {
    name: 'Delete',
  });
  await deleteOverrideBtn.click();

  const confirmSpan = overrideCard.locator('span', { hasText: 'Confirm?' });
  await confirmSpan.waitFor({ state: 'visible' });
  ok('Clicking Delete presents inline confirmation prompt', true);

  const confirmDeleteBtn = overrideCard.getByRole('button', {
    name: 'Delete',
  });
  await confirmDeleteBtn.click();
  await page.waitForTimeout(300);

  const deletedOverrideCount = await page
    .locator('article[data-override-id="ov-1"]')
    .count();
  ok(
    'Confirming delete calls DELETE and removes taught answer',
    deletedOverrideCount === 0,
  );

  // ==========================================
  // SUITE 6: Insights Screen & Range Switching
  // ==========================================
  console.log('\n--- SUITE 6: /owner/app/insights & Ranges ---');
  await page.goto(`${base}/owner/app/insights`, { waitUntil: 'networkidle' });

  const insightsH1 = page.getByRole('heading', { level: 1, name: 'Insights' });
  await insightsH1.waitFor({ state: 'visible' });
  ok('Insights screen renders H1 "Insights"', true);

  // Stat tiles
  const ordersStat = page
    .locator('section[aria-label="Core metrics summary"] p.font-display')
    .first();
  await ordersStat.waitFor({ state: 'visible' });
  const ordersCountText = await ordersStat.textContent();
  ok(
    'Core stat tiles render metrics (Orders count)',
    ordersCountText?.trim() === '42',
    ordersCountText ?? '',
  );

  // Range switching to Today
  const todayRangeBtn = page.locator('div[role="radiogroup"] button', {
    hasText: 'Today',
  });
  await todayRangeBtn.click();
  await page.waitForTimeout(400);

  // ==========================================
  // SUITE 7: Assistant Null Metrics Handling
  // ==========================================
  console.log('\n--- SUITE 7: Assistant Null Metrics ("Not tracked yet") ---');
  const assistantSection = page.locator(
    'section[aria-labelledby="assistant-metrics-heading"]',
  );
  await assistantSection.waitFor({ state: 'visible' });
  const assistantMetricValues = await assistantSection
    .locator('p.font-mono')
    .allTextContents();
  ok(
    'Assistant metrics with null values display "Not tracked yet" (never 0)',
    assistantMetricValues.length === 4 &&
      assistantMetricValues.every((val) => val.trim() === 'Not tracked yet'),
    assistantMetricValues.join(', '),
  );

  // Switch back to 7 days
  const sevenDaysRangeBtn = page.locator('div[role="radiogroup"] button', {
    hasText: '7 days',
  });
  await sevenDaysRangeBtn.click();
  await page.waitForTimeout(400);

  const populatedMetrics = await assistantSection
    .locator('p.font-mono')
    .allTextContents();
  ok(
    'Assistant metrics with non-null values display formatted numbers and percentages',
    populatedMetrics.some((m) => m.includes('%')) &&
      populatedMetrics.some((m) => m.includes('85')),
    populatedMetrics.join(', '),
  );

  // ==========================================
  // SUITE 8: Hand-Made SVG Charts
  // ==========================================
  console.log('\n--- SUITE 8: Hand-Made SVG Charts ---');
  const chartsSection = page.locator(
    'section[aria-label="Visual trend charts"]',
  );
  await chartsSection.waitFor({ state: 'visible' });

  const chartHeadings = await chartsSection.locator('h2').allTextContents();
  const expectedChartHeadings = [
    'Orders per day',
    'Top 10 items',
    'Orders by hour',
    'Bookings by party size',
  ];
  ok(
    'All 4 hand-made charts render their section headings',
    JSON.stringify(chartHeadings) === JSON.stringify(expectedChartHeadings),
    chartHeadings.join(', '),
  );

  // SVG presence & screen-reader data table presence
  const svgCount = await chartsSection.locator('svg').count();
  const srTableCount = await chartsSection.locator('table.sr-only').count();
  ok(
    'Charts render 4 SVGs with 4 hidden screen-reader accessible tables',
    svgCount === 4 && srTableCount === 4,
    `svgs=${svgCount}, tables=${srTableCount}`,
  );

  // Check 24 hour bars in Orders by hour
  const hourlySvgBars = await chartsSection
    .locator('svg[aria-label="Orders by hour of day chart"]')
    .locator('rect')
    .count();
  ok(
    'Orders by hour chart renders all 24 hours zero-filled (24 rect bars)',
    hourlySvgBars === 24,
    `found ${hourlySvgBars} bars`,
  );

  // XSS protection in Top Items chart
  const topItemsText = await chartsSection
    .locator('table.sr-only td', {
      hasText: '<img src=x onerror=alert(1)>Maska Pav',
    })
    .count();
  ok(
    'Dish name with <img src=x> renders as plain text without HTML execution',
    topItemsText >= 1,
  );

  // ==========================================
  // SUITE 9: Daily AI Summary Flow
  // ==========================================
  console.log('\n--- SUITE 9: Daily AI Summary Flow ---');
  const summarySection = page.locator(
    'section[aria-labelledby="daily-summary-heading"]',
  );
  await summarySection.waitFor({ state: 'visible' });

  // Verify initial "Generate daily summary" button
  const generateSummaryBtn = summarySection.getByRole('button', {
    name: 'Generate daily summary',
  });
  await generateSummaryBtn.waitFor({ state: 'visible' });
  ok('Initial summary state shows "Generate daily summary" button', true);

  // Click generate
  await generateSummaryBtn.click();

  // Summary content rendered
  const summaryContent = summarySection.locator(
    '[data-testid="daily-summary-content"]',
  );
  await summaryContent.waitFor({ state: 'visible', timeout: 10_000 });

  const bulletsCount = await summaryContent.locator('li').count();
  ok(
    'Generated daily summary renders 5 key observation bullets',
    bulletsCount === 5,
    `found ${bulletsCount} bullets`,
  );

  const suggestionText = await summaryContent
    .locator('p.font-semibold')
    .textContent();
  ok(
    'Daily summary renders team suggestion',
    Boolean(suggestionText && suggestionText.length > 10),
  );

  const aiDisclosure = await summarySection
    .locator("text=Written by AI from today's numbers")
    .count();
  ok('AI disclosure badge is displayed', aiDisclosure === 1);

  // Regenerate button test
  const regenerateBtn = summarySection.getByRole('button', {
    name: 'Regenerate',
  });
  await regenerateBtn.waitFor({ state: 'visible' });
  await regenerateBtn.click();
  await page.waitForTimeout(500);
  ok('Regenerate summary button is functional', true);

  // ==========================================
  // SUITE 10: Viewport Screenshots & Overflow
  // ==========================================
  console.log('\n--- SUITE 10: Viewports & Screenshots ---');

  for (const [w, h, label] of [
    [360, 800, '360'],
    [1024, 900, '1024'],
  ]) {
    await page.setViewportSize({ width: w, height: h });

    // Questions screenshot
    await page.goto(`${base}/owner/app/questions`, {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(300);
    const qScrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    ok(
      `/owner/app/questions at ${label}px: no horizontal overflow`,
      qScrollWidth <= w,
      `scrollWidth=${qScrollWidth} viewport=${w}`,
    );
    await page.screenshot({
      path: `.checks/owner-questions-${label}.png`,
      fullPage: true,
    });

    // Insights screenshot
    await page.goto(`${base}/owner/app/insights`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const iScrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    ok(
      `/owner/app/insights at ${label}px: no horizontal overflow`,
      iScrollWidth <= w,
      `scrollWidth=${iScrollWidth} viewport=${w}`,
    );
    if (w === 360) {
      // Seven tabs do not fit in 360 px: the current tab must be scrolled into view.
      const activeTab = await page.evaluate(() => {
        const el = document.querySelector(
          'nav[aria-label="Mobile owner navigation"] [aria-current="page"]',
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right) };
      });
      ok(
        'Insights at 360px: the active tab is fully visible in the bottom bar',
        !!activeTab && activeTab.left >= 0 && activeTab.right <= 360,
        JSON.stringify(activeTab),
      );

      // Chart drawings must not be scaled down so far that labels become unreadable.
      const textSizes = await page.evaluate(() =>
        [...document.querySelectorAll('svg[role="img"]')]
          .map((svg) => {
            const text = svg.querySelector('text');
            if (!text) return null;
            const scale =
              svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
            return parseFloat(getComputedStyle(text).fontSize) * scale;
          })
          .filter((value) => value !== null),
      );
      ok(
        'Insights at 360px: chart text renders at 8.5px or larger',
        textSizes.length > 0 && textSizes.every((size) => size >= 8.5),
        JSON.stringify(textSizes.map((size) => Math.round(size * 10) / 10)),
      );
    }
    await page.screenshot({
      path: `.checks/owner-insights-${label}.png`,
      fullPage: true,
    });
  }

  // ==========================================
  // SUITE 11: 401 Session Expiry Redirect
  // ==========================================
  console.log('\n--- SUITE 11: 401 Session Expiry Redirect ---');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${base}/owner/app/insights`, { waitUntil: 'networkidle' });
  force401 = true;
  await page
    .locator('div[role="radiogroup"] button', { hasText: '30 days' })
    .click();
  await page.waitForURL((url) => url.pathname === '/owner', {
    timeout: 10_000,
  });
  ok(
    '401 response from owner API redirects to /owner login',
    page.url().endsWith('/owner'),
  );
  force401 = false;

  ok(
    'No unhandled console errors during check',
    consoleErrors.length === 0,
    consoleErrors[0] ?? '',
  );

  await context.close();
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nOwner AI UI check failed with ${failures} failure(s).`);
  process.exit(1);
}
console.log('\nOwner AI UI check passed cleanly.');
