import { test, expect } from '@playwright/test';
import { MockBackend } from '../support/mock-backend';
import { openApp, signOutButton, startProblem } from '../support/app';

test('AI provider failure on a cloud session shows the error, keeps the input, and never falls back to the simulator', async ({ page }) => {
  const api = new MockBackend(page);
  api.authenticated = true;
  api.cothinkReplies.push({
    status: 503,
    body: { error: 'AI provider unavailable: Gemini returned 503 UNAVAILABLE', executionMode: 'error' },
  });
  await api.install();
  await openApp(page);
  await expect(signOutButton(page)).toBeVisible();

  await startProblem(page, 'Should I accept the job offer?');

  await expect(page.getByText(/I encountered an issue processing this workflow stage/)).toBeVisible();
  await expect(page.getByText(/AI provider unavailable: Gemini returned 503 UNAVAILABLE/).first()).toBeVisible();
  await expect(page.getByText(/Should I accept the job offer\?.*has been retained/)).toBeVisible();
  expect(api.callsTo('/api/cothink')).toHaveLength(1);
  expect(api.callsTo('/api/demo/cothink')).toHaveLength(0);
});
