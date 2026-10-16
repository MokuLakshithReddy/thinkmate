import { test, expect, type Route } from '@playwright/test';
import { MockBackend, USER } from '../support/mock-backend';
import { headerSignInButton, openApp, signOutButton } from '../support/app';

/**
 * Two tabs restore the same expired session at once. The mocked refresh endpoint follows the server
 * contract tested in src/app/api/auth-hardening.test.ts: the first request rotates the refresh token,
 * a concurrent request with the old token either recovers the rotated session (200 + new cookies) or
 * fails honestly with REFRESH_ROTATION_UNRECOVERABLE.
 */
async function raceTwoTabs(recoverable: boolean, { context, page }: { context: import('@playwright/test').BrowserContext; page: import('@playwright/test').Page }) {
  const host = 'localhost';
  await context.addCookies([{ name: 'thinkmate_refresh_token', value: 'rt-old', domain: host, path: '/' }]);

  let rotated = false;
  let losers = 0;
  const handleRefresh = (api: MockBackend) => async (route: Route) => {
    const cookie = (await route.request().allHeaders())['cookie'] || '';
    const hasOld = cookie.includes('thinkmate_refresh_token=rt-old');
    const setNew = { 'set-cookie': 'thinkmate_refresh_token=rt-new; Path=/; HttpOnly; SameSite=Lax' };
    if (hasOld && !rotated) {
      rotated = true;
      api.authenticated = true;
      await new Promise((r) => setTimeout(r, 400));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: setNew, body: JSON.stringify({ success: true, user: USER }) });
    }
    if (hasOld && recoverable) {
      api.authenticated = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: setNew,
        body: JSON.stringify({ success: true, user: USER, message: 'Token refreshed via concurrent rotation recovery' }),
      });
    }
    losers++;
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Rotation could not be recovered', code: 'REFRESH_ROTATION_UNRECOVERABLE' }),
    });
  };

  const second = await context.newPage();
  const tabs = [page, second];
  const backends = tabs.map((p) => {
    const api = new MockBackend(p);
    api.canRefresh = true;
    return api;
  });
  for (let i = 0; i < tabs.length; i++) {
    await backends[i].install();
    await tabs[i].route('**/api/auth/refresh', handleRefresh(backends[i]));
  }
  await Promise.all(tabs.map((p) => openApp(p)));
  return { tabs, losersCount: () => losers };
}

test('concurrent refresh in two tabs: both recover the rotated session and keep the new cookie', async ({ context, page }) => {
  const { tabs, losersCount } = await raceTwoTabs(true, { context, page });
  for (const tab of tabs) await expect(signOutButton(tab)).toBeVisible();
  expect(losersCount()).toBe(0);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'thinkmate_refresh_token')?.value).toBe('rt-new');
});

test('concurrent refresh in two tabs: the unrecoverable tab reports signed out instead of success', async ({ context, page }) => {
  const { tabs, losersCount } = await raceTwoTabs(false, { context, page });
  const signedInTabs = async () => Promise.all(tabs.map((t) => signOutButton(t).isVisible()));
  await expect.poll(async () => (await signedInTabs()).filter(Boolean).length).toBe(1);
  expect(losersCount()).toBe(1);
  const signedIn = await signedInTabs();
  const loser = tabs[signedIn.indexOf(false)];
  await expect(headerSignInButton(loser)).toBeVisible();
});
