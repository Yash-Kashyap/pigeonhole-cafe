import { chromium } from 'playwright';

const origin = process.env.CHECK_ORIGIN || 'http://127.0.0.1:4321';
const paths = [
  '/',
  '/menu',
  '/order',
  '/reserve',
  '/gatherings',
  '/trek-stop',
  '/visit',
  '/story',
  '/owner',
  '/owner/app',
  '/owner/app/orders',
  '/owner/app/bookings',
  '/owner/app/inbox',
  '/owner/app/questions',
  '/owner/app/insights',
  '/owner/app/menu',
  '/500',
  '/missing-phase-8a-route',
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage();
  const selfTestErrors = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /content security policy/i.test(message.text())
    )
      selfTestErrors.push(message.text());
  });
  await page.setContent(
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><script>window.cspSelfTest = true</script>',
  );
  if (!selfTestErrors.length)
    throw new Error(
      'CSP checker self-test did not detect a deliberately blocked inline script.',
    );
  console.log(
    'PASS: checker self-test detected a deliberately broken inline-script rule.',
  );

  for (const path of paths) {
    const errors = [];
    const violationListener = (message) => {
      if (
        message.type() === 'error' &&
        /content security policy/i.test(message.text())
      )
        errors.push(message.text());
    };
    page.on('console', violationListener);
    const response = await page.goto(new URL(path, origin).href, {
      waitUntil: 'networkidle',
    });
    if (!response) throw new Error(`${path}: no response.`);
    if (path === '/missing-phase-8a-route' && response.status() !== 404)
      throw new Error(`404 route returned HTTP ${response.status()}.`);
    const headers = response.headers();
    if (
      headers['strict-transport-security'] !==
      'max-age=31536000; includeSubDomains'
    )
      throw new Error(`${path}: HSTS header missing or incorrect.`);
    if (path.startsWith('/api/')) {
      if (headers['cross-origin-resource-policy'])
        throw new Error(`${path}: CORP must be omitted for API routes.`);
    } else if (headers['cross-origin-resource-policy'] !== 'same-origin') {
      throw new Error(`${path}: CORP header missing or incorrect.`);
    }
    const csp =
      headers['content-security-policy'] ||
      (await page
        .locator('meta[http-equiv="content-security-policy"]')
        .getAttribute('content'));
    if (!csp)
      throw new Error(
        `${path}: CSP is missing from both response headers and the page meta policy.`,
      );
    if (/script-src[^;]*unsafe-inline|style-src[^;]*unsafe-inline/i.test(csp))
      throw new Error(`${path}: unsafe-inline found in script or style CSP.`);
    if (errors.length)
      throw new Error(`${path}: CSP console violations: ${errors.join(' | ')}`);
    if (path === '/owner/app' && response.url().endsWith('/owner')) {
      console.log(
        `PASS: ${path} redirected to login because this check has no owner session.`,
      );
    } else {
      console.log(`PASS: ${path} CSP and security headers.`);
    }
    page.off('console', violationListener);
  }
} finally {
  await browser.close();
}
