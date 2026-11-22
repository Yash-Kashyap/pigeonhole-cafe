import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const pages = [
  { path: '/', name: 'Home' },
  { path: '/menu/', name: 'Menu' },
  { path: '/order/', name: 'Order' },
  { path: '/reserve/', name: 'Reserve' },
  { path: '/gatherings/', name: 'Gatherings' },
  { path: '/trek-stop/', name: 'Trek Stop' },
  { path: '/visit/', name: 'Visit' },
  { path: '/story/', name: 'Story' },
];

const viewports = [
  { name: '390px', width: 390, height: 844 },
  { name: '1024px', width: 1024, height: 900 },
];

// Locate axe.min.js
const localAxe = path.resolve('node_modules/axe-core/axe.min.js');
let axeSource;
if (fs.existsSync(localAxe)) {
  axeSource = fs.readFileSync(localAxe, 'utf8');
} else {
  console.error(
    'Error: axe-core is not installed. Run: npm install --no-save axe-core',
  );
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let totalSeriousCritical = 0;
const results = [];

try {
  for (const pageInfo of pages) {
    for (const vp of viewports) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
      });

      const url = `http://127.0.0.1:4321${pageInfo.path}`;
      const response = await page.goto(url, { waitUntil: 'networkidle' });
      if (!response?.ok()) {
        console.error(
          `Failed to load ${url} (HTTP ${response?.status() ?? 'unknown'})`,
        );
        process.exit(1);
      }

      // Wait a moment for dynamic hydration
      await page.waitForTimeout(400);

      const violations = await page.evaluate((source) => {
        window.eval(source);
        return new Promise((resolve, reject) => {
          window.axe.run(
            document,
            {
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
              },
            },
            (err, auditResults) => {
              if (err) return reject(err);
              resolve(auditResults.violations);
            },
          );
        });
      }, axeSource);

      const seriousCritical = violations.filter((v) =>
        ['serious', 'critical'].includes(v.impact),
      );

      results.push({
        page: pageInfo.name,
        path: pageInfo.path,
        viewport: vp.name,
        total: violations.length,
        seriousCritical: seriousCritical.length,
        violations: seriousCritical,
      });

      totalSeriousCritical += seriousCritical.length;
      await page.close();
    }
  }

  console.log('\n--- ACCESSIBILITY AUDIT REPORT (axe-core) ---');
  for (const r of results) {
    const status = r.seriousCritical === 0 ? 'PASS' : 'FAIL';
    console.log(
      `[${status}] ${r.page.padEnd(12)} (${r.path.padEnd(12)}) @ ${r.viewport.padEnd(7)}: ${r.seriousCritical} serious/critical (${r.total} total)`,
    );
    if (r.seriousCritical > 0) {
      for (const v of r.violations) {
        console.log(`       [${v.impact.toUpperCase()}] ${v.id}: ${v.help}`);
        for (const n of v.nodes) {
          console.log(`         target: ${n.target.join(' ')}`);
          console.log(`         summary: ${n.failureSummary}`);
        }
      }
    }
  }

  if (totalSeriousCritical > 0) {
    console.error(
      `\nAccessibility check FAILED: ${totalSeriousCritical} serious or critical violation(s) found.\n`,
    );
    process.exit(1);
  } else {
    console.log(
      '\nAccessibility check PASSED: zero serious or critical violations across all public pages.\n',
    );
  }
} finally {
  await browser.close();
}
