import { expect, type Page } from '@playwright/test';

/** Navigates and waits for the client's first /api/auth/session check, i.e. until React has hydrated. */
export async function openApp(page: Page, path = '/') {
  const sessionCheck = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/session');
  await page.goto(path);
  await sessionCheck;
}

export const signOutButton = (page: Page) => page.getByRole('button', { name: 'Sign out' });
export const headerSignInButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Sign In' });
export const option = (page: Page, label: string | RegExp) => page.getByRole('radio', { name: label });
export const authForm = (page: Page) => page.locator('form').filter({ has: page.getByPlaceholder('you@domain.com') });

export async function submit(page: Page) {
  await page.getByRole('button', { name: 'Submit' }).click();
}

export async function chooseOption(page: Page, label: string | RegExp) {
  await option(page, label).click();
  await submit(page);
}

export async function typeMessage(page: Page, text: string) {
  const input = page.getByPlaceholder(/Type your dilemma|Add specific details/);
  await input.fill(text);
  await input.press('Enter');
}

/** From the neutral welcome screen: pick "Describe a new problem", then send the problem text. */
export async function startProblem(page: Page, text: string) {
  await chooseOption(page, /Describe a new problem/);
  await expect(page.getByPlaceholder('Type your dilemma, tension, or situation here...')).toBeVisible();
  await typeMessage(page, text);
}

export async function fillAuthForm(page: Page, email: string, password: string) {
  const form = authForm(page);
  await form.getByPlaceholder('you@domain.com').fill(email);
  await form.getByPlaceholder('••••••••').fill(password);
  await form.locator('button[type="submit"]').click();
}
