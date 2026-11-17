import { expect, test } from '@playwright/test';

const viewports = [
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 900 },
  { name: '1280', width: 1280, height: 900 },
];

for (const viewport of viewports) {
  test(`component kit renders at ${viewport.name}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const response = await page.goto('/_kit');
    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole('heading', { name: 'Component kit' }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      'content',
      /noindex/,
    );
    await page.screenshot({
      path: `.checks/kit-${viewport.name}.png`,
      fullPage: false,
    });
    expect(errors).toEqual([]);
  });
}
