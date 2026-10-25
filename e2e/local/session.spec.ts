import { test, expect } from '@playwright/test';
import { CLOUD_SESSION_ID, MockBackend, USER } from '../support/mock-backend';
import { headerSignInButton, openApp, signOutButton } from '../support/app';

test.describe('session restoration and cloud history (Supabase mocked)', () => {
  test('expired access token with a refresh cookie is restored via POST /api/auth/refresh', async ({ page }) => {
    const api = new MockBackend(page);
    api.canRefresh = true;
    await api.install();
    await openApp(page);

    await expect(signOutButton(page)).toBeVisible();
    expect(api.callsTo('/api/auth/refresh')).toHaveLength(1);

    await openApp(page);
    await expect(signOutButton(page)).toBeVisible();
    expect(api.callsTo('/api/auth/refresh')).toHaveLength(1);
  });

  test('unrecoverable refresh rotation leaves the user signed out instead of faking success', async ({ page }) => {
    const api = new MockBackend(page);
    api.canRefresh = true;
    api.refreshReplies.push({
      status: 401,
      body: { error: 'Session was rotated by a concurrent request and could not be recovered', code: 'REFRESH_ROTATION_UNRECOVERABLE' },
    });
    await api.install();
    await openApp(page);

    await expect(headerSignInButton(page)).toBeVisible();
    await expect(signOutButton(page)).toHaveCount(0);
  });

  test('cloud session history loads from ?session= and survives a reload', async ({ page }) => {
    const api = new MockBackend(page);
    api.authenticated = true;
    const session = {
      id: CLOUD_SESSION_ID,
      userId: USER.id,
      title: 'Monorepo migration',
      problemStatement: 'Should we migrate to a monorepo?',
      currentMode: 'understand',
      currentStage: 'clarify_objective',
      status: 'active',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    api.sessions = [session];
    api.sessionDetails.set(CLOUD_SESSION_ID, {
      ...session,
      messages: [
        { id: 'm1', role: 'user', content: 'Should we migrate to a monorepo?', mode: 'understand', createdAt: '2026-10-01T00:00:01.000Z' },
        { id: 'm2', role: 'assistant', content: 'Saved cloud reply: what slows releases today?', mode: 'understand', createdAt: '2026-10-01T00:00:02.000Z' },
      ],
    });
    await api.install();

    await openApp(page, `/app?session=${CLOUD_SESSION_ID}`);
    await expect(page.getByText('Saved cloud reply: what slows releases today?')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Saved cloud reply: what slows releases today?')).toBeVisible();
    expect(api.calls.filter((c) => c.search === `?id=${CLOUD_SESSION_ID}`).length).toBeGreaterThanOrEqual(2);
  });
});
