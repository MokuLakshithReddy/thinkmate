import { test, expect } from '@playwright/test';

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

test.skip(!email || !password || !process.env.E2E_BASE_URL, 'needs staging credentials and E2E_BASE_URL');

const sizes = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

for (const [name, viewport] of Object.entries(sizes)) {
  test(`guided workspace full loop (${name})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/thinkmate');
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
    await page.getByPlaceholder('you@domain.com').fill(email!);
    await page.getByPlaceholder('••••••••').fill(password!);
    await page.locator('form').getByRole('button', { name: 'Sign In' }).click();

    // Check for any immediate auth errors before waiting on navigation
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/thinkmate');

    const startInput = page.getByPlaceholder(new RegExp('Why do college students'));
    await expect(startInput).toBeVisible({ timeout: 15_000 });
    await startInput.fill(`E2E ${name} ${Date.now()}`);
    await page.getByRole('button', { name: new RegExp('Start Session') }).click();
    await expect(page).toHaveURL(new RegExp('/thinkmate/[0-9a-f-]{36}'));

    const box = page.getByPlaceholder(new RegExp('Describe your thinking'));
    await box.fill('Students miss morning workshops because they hear about them too late.');
    await box.press('Control+Enter');
    await expect(page.getByText('Students miss morning workshops').first()).toBeVisible({ timeout: 60_000 });

    if (name === 'mobile') {
      const toggle = page.getByRole('button', { name: new RegExp('thinking|cards', 'i') }).first();
      if (await toggle.isVisible()) {
        await toggle.click();
      }
    }

    const confirm = page.getByRole('button', { name: new RegExp('confirm', 'i') }).first();
    await expect(confirm).toBeVisible({ timeout: 60_000 });
    await confirm.click();

    await page.reload(); // state must survive a reload
    await expect(page.getByText('Students miss morning workshops').first()).toBeVisible();
  });
}
