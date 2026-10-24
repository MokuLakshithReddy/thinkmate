import { test, expect } from '@playwright/test';
import { MockBackend, USER } from '../support/mock-backend';
import { authForm, fillAuthForm, headerSignInButton, openApp, signOutButton } from '../support/app';

test.describe('signup, email confirmation, login and logout (Supabase mocked)', () => {
  test('signup that needs email confirmation shows the notice and does not sign in', async ({ page }) => {
    const api = new MockBackend(page);
    await api.install();
    await openApp(page);

    await headerSignInButton(page).click();
    await page.getByRole('button', { name: 'Create Account', exact: true }).first().click();
    await fillAuthForm(page, 'new-user@example.com', 'correct-horse-battery', { path: '/api/auth/signup' });

    await expect(page.getByText('Please check your email to confirm your account before signing in.')).toBeVisible();
    await expect(authForm(page).getByPlaceholder('••••••••')).toHaveValue('');

    const [signup] = api.callsTo('/api/auth/signup');
    expect(signup.body).toEqual({ email: 'new-user@example.com', password: 'correct-horse-battery' });
    expect(signup.headers['content-type']).toBe('application/json');
    expect(new URL(signup.headers['origin']).origin).toBe(new URL(page.url()).origin);

    await page.keyboard.press('Escape');
    await expect(headerSignInButton(page)).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test('wrong password shows the error; correct password signs in; sign out clears the session', async ({ page }) => {
    const api = new MockBackend(page);
    await api.install();
    await openApp(page);

    await headerSignInButton(page).click();
    await fillAuthForm(page, USER.email, 'wrong-password', { expectedStatus: 401 });
    await expect(page.getByText('Invalid login credentials')).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);

    await fillAuthForm(page, USER.email, 'right-password');
    await expect(signOutButton(page)).toBeVisible();
    await expect(page.getByPlaceholder('you@domain.com')).toHaveCount(0);

    await signOutButton(page).click();
    await expect(headerSignInButton(page)).toBeVisible();
    expect(api.callsTo('/api/auth/logout')).toHaveLength(1);
  });
});

test.describe('login CSRF against the real local server', () => {
  for (const [name, headers, expected] of [
    ['cross-origin Origin', { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, 403],
    ['text/plain body', { 'Content-Type': 'text/plain' }, 415],
    ['cross-site fetch metadata', { 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, 403],
  ] as [string, Record<string, string>, number][]) {
    test(`login rejects ${name} with ${expected}`, async ({ request, baseURL }) => {
      const res = await request.post('/api/auth/login', {
        headers: { Origin: baseURL as string, ...headers },
        data: JSON.stringify({ email: USER.email, password: 'whatever-password' }),
      });
      expect(res.status()).toBe(expected);
    });
  }
});
