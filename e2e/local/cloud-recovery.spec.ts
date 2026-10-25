import { test, expect } from '@playwright/test';
import { CLOUD_REPLY_TEXT, CLOUD_SESSION_ID, MockBackend, USER } from '../support/mock-backend';
import { chooseOption, fillAuthForm, openApp, option, signOutButton, startProblem, typeMessage } from '../support/app';

const LOCAL_DRAFT = /Continue as local draft/;

test.describe('expired auth and explicit local draft (Supabase/Gemini mocked, simulator real)', () => {
  test('expiry after a cloud reply holds the message; signing in again resends it to the same session', async ({ page }) => {
    const api = new MockBackend(page);
    api.authenticated = true;
    await api.install();
    await openApp(page);
    await expect(signOutButton(page)).toBeVisible();

    await startProblem(page, 'Should we migrate to a monorepo?');
    await expect(page.getByText(CLOUD_REPLY_TEXT)).toBeVisible();

    api.authenticated = false;
    await chooseOption(page, 'Speed of delivery');

    await expect(page.getByText('Your sign-in session has expired.')).toBeVisible();
    await expect(option(page, 'Sign in again')).toBeVisible();
    await expect(option(page, LOCAL_DRAFT)).toBeVisible();
    await expect(option(page, 'Speed of delivery')).toHaveCount(0);
    expect(api.callsTo('/api/auth/refresh')).toHaveLength(1);
    expect(api.callsTo('/api/demo/cothink')).toHaveLength(0);

    await chooseOption(page, 'Sign in again');
    await fillAuthForm(page, USER.email, 'right-password');
    await expect(page.getByText('You are signed in again.')).toBeVisible();
    await chooseOption(page, 'Resend my message');

    await expect.poll(() => api.callsTo('/api/cothink').length).toBe(3);
    const resent = api.callsTo('/api/cothink').at(-1)!;
    expect(resent.body).toMatchObject({ sessionId: CLOUD_SESSION_ID, userMessage: 'Speed of delivery' });
    expect(api.callsTo('/api/demo/cothink')).toHaveLength(0);
  });

  test('cloud session creation failure offers Retry, which reuses the held message', async ({ page }) => {
    const api = new MockBackend(page);
    api.authenticated = true;
    api.sessionCreateReplies.push({ status: 500, body: { error: 'Failed to create session' } });
    await api.install();
    await openApp(page);

    await startProblem(page, 'Pick a database for analytics');
    await expect(page.getByText('Could not save to your cloud session: Failed to create session.')).toBeVisible();
    expect(api.callsTo('/api/cothink')).toHaveLength(0);
    expect(api.callsTo('/api/demo/cothink')).toHaveLength(0);

    await chooseOption(page, 'Retry');
    await expect(page.getByText(CLOUD_REPLY_TEXT)).toBeVisible();
    expect(api.callsTo('/api/cothink')[0].body).toMatchObject({ sessionId: CLOUD_SESSION_ID, userMessage: 'Pick a database for analytics' });
  });

  test('explicit local draft from a ?session= URL uses the real simulator and drops the cloud session', async ({ page }) => {
    const api = new MockBackend(page);
    api.authenticated = true;
    api.sessionDetails.set(CLOUD_SESSION_ID, {
      id: CLOUD_SESSION_ID,
      title: 'Hiring plan',
      problemStatement: 'Hire a senior or two juniors?',
      currentMode: 'understand',
      currentStage: 'clarify_objective',
      messages: [
        { id: 'h1', role: 'user', content: 'Hire a senior or two juniors?', mode: 'understand' },
        { id: 'h2', role: 'assistant', content: 'Saved cloud reply: what does the team lack most?', mode: 'understand' },
      ],
    });
    await api.install();
    await openApp(page, `/app?session=${CLOUD_SESSION_ID}`);
    await expect(page.getByText('Saved cloud reply: what does the team lack most?')).toBeVisible();

    api.authenticated = false;
    await typeMessage(page, 'Mostly mentoring capacity');
    await expect(page.getByText('Your sign-in session has expired.')).toBeVisible();

    const demoResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/demo/cothink');
    await chooseOption(page, LOCAL_DRAFT);
    const demo = await demoResponse;
    expect(demo.status()).toBe(200);
    const demoJson = await demo.json();
    expect(demoJson.executionMode).toBe('simulator');
    expect(demo.request().postDataJSON()).toMatchObject({ userMessage: 'Mostly mentoring capacity' });

    await expect(page.getByText(/Demo Mode/).last()).toBeVisible();
    await expect(page.getByText('Mostly mentoring capacity', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/session=/);
    expect(api.callsTo('/api/cothink')).toHaveLength(1);

    await page.reload();
    await expect(page.getByText('Saved cloud reply: what does the team lack most?')).toHaveCount(0);
    await expect(page.getByText(/saved session\(s\)/)).toBeVisible();
  });
});
