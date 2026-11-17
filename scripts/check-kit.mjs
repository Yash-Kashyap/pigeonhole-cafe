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

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto('http://127.0.0.1:4321/_kit', {
      waitUntil: 'networkidle',
    });
    if (!response?.ok())
      throw new Error(
        `/_kit returned ${response?.status() ?? 'no response'} at ${viewport.name}px.`,
      );
    if (
      (await page.locator('h1').first().textContent())?.trim() !==
      'Component kit'
    )
      throw new Error(`Component kit heading missing at ${viewport.name}px.`);
    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute('content');
    if (!robots?.includes('noindex'))
      throw new Error(`Noindex metadata missing at ${viewport.name}px.`);
    await page.screenshot({
      path: resolve(checksDirectory, `kit-${viewport.name}.png`),
      fullPage: false,
    });
    await page.close();
    if (errors.length)
      throw new Error(
        `Browser errors at ${viewport.name}px: ${errors.join(' | ')}`,
      );
    console.log(`PASS /_kit at ${viewport.name}px with no console errors.`);
  }
} finally {
  await browser.close();
}
