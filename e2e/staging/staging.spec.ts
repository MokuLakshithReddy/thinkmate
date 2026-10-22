import { test, expect } from '@playwright/test';
import { fillAuthForm, headerSignInButton, openApp, signOutButton, startProblem } from '../support/app';

/**
 * Runs against a deployed app (E2E_BASE_URL) with real Supabase, Redis and Gemini. Nothing is mocked.
 * Auth tests need a confirmed test account: E2E_TEST_EMAIL / E2E_TEST_PASSWORD.
 */
const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

test('readiness reports database, AI provider and auth infrastructure ready', async ({ request }) => {
  const res = await request.get('/api/health?readiness=true');
  const json = await res.json();
  expect(json.dependencies.authInfrastructure, JSON.stringify(json.dependencies)).toMatchObject({
    status: 'ready',
    rateLimiter: { status: 'ready', distributed: true },
  });
  expect(res.status(), JSON.stringify(json.dependencies)).toBe(200);
});

test('login rejects cross-origin requests', async ({ request }) => {
  const res = await request.post('/api/auth/login', {
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    data: JSON.stringify({ email: 'nobody@example.com', password: 'not-a-real-password' }),
  });
  expect(res.status()).toBe(403);
});

test('CSP policy enforces per-request nonces matching all rendered script tags', async ({ request, page }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const csp = res.headers()['content-security-policy'] || '';
  expect(csp).toContain('script-src');
  expect(csp).toContain('strict-dynamic');
  const nonceMatch = csp.match(/'nonce-([^']+)'/);
  expect(nonceMatch, 'CSP header must contain a script nonce').toBeTruthy();
  const nonce = nonceMatch![1];

  const html = await res.text();
  expect(html).toContain(`nonce="${nonce}"`);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await openApp(page);
  const cspViolations = consoleErrors.filter((e) => e.toLowerCase().includes('violates content security policy'));
  expect(cspViolations, `Observed CSP violations in browser: ${cspViolations.join('; ')}`).toEqual([]);
});

test.describe('real account', () => {
  test.beforeAll(() => {
    if (!email || !password) {
      throw new Error(
        'E2E_TEST_EMAIL and E2E_TEST_PASSWORD environment variables are required. Staging suite must not skip the real-service user journey.'
      );
    }
  });

  test('login, cloud session with a live AI reply, history reload, session restore and logout', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await headerSignInButton(page).click();
    await fillAuthForm(page, email!, password!);
    await expect(signOutButton(page)).toBeVisible();

    const created = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/sessions' && r.request().method() === 'POST');
    const replied = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/cothink', { timeout: 90_000 });
    await startProblem(page, `E2E staging check ${new Date().toISOString()}: choose between two vendors`);
    const sessionId = (await (await created).json()).session.id as string;
    const reply = await replied;
    expect(reply.status()).toBe(200);
    const replyJson = await reply.json();
    expect(replyJson.executionMode, 'Execution mode must be genuine gemini').toBe('gemini');
    expect(typeof replyJson.message).toBe('string');
    expect(replyJson.message.trim().length, 'Assistant reply message must be non-empty').toBeGreaterThan(10);
    const assistantSnippet = replyJson.message.trim().slice(0, 30);

    await openApp(page, `/?session=${sessionId}`);
    await expect(signOutButton(page)).toBeVisible();
    await expect(page.getByText(/E2E staging check/).first()).toBeVisible();
    await expect(page.getByText(assistantSnippet).first()).toBeVisible();

    await signOutButton(page).click();
    await expect(headerSignInButton(page)).toBeVisible();
    await openApp(page);
    await expect(headerSignInButton(page)).toBeVisible();
  });
});

