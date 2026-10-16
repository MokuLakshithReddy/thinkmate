import { defineConfig, devices } from '@playwright/test';

/**
 * Two suites:
 * - local (default): starts `next dev` and mocks Supabase-backed auth/session/cloud APIs per test.
 *   The guest simulator (/api/demo/cothink) and CSRF checks run against the real local server.
 * - staging: set E2E_BASE_URL (plus E2E_TEST_EMAIL / E2E_TEST_PASSWORD) to run e2e/staging against
 *   a deployed app with real Supabase, Redis and Gemini. Nothing is mocked there.
 */
const stagingUrl = process.env.E2E_BASE_URL;
const localPort = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: stagingUrl
    ? [{ name: 'staging', testDir: './e2e/staging', use: { ...devices['Desktop Chrome'], baseURL: stagingUrl } }]
    : [{ name: 'local', testDir: './e2e/local', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${localPort}` } }],
  webServer: stagingUrl
    ? undefined
    : {
        command: `npm run dev -- --port ${localPort}`,
        url: `http://localhost:${localPort}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          // Keep the local server hermetic: no real Supabase/Gemini/Redis even if a developer has them configured.
          NEXT_PUBLIC_SUPABASE_URL: '',
          NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
          SUPABASE_SERVICE_ROLE_KEY: '',
          GEMINI_API_KEY: '',
          GOOGLE_API_KEY: '',
          UPSTASH_REDIS_REST_URL: '',
          UPSTASH_REDIS_REST_TOKEN: '',
        },
      },
});
