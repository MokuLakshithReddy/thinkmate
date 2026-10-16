import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateProductionConfig, getSessionEncryptionKeyStatus } from './production-config';

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-value',
  GEMINI_API_KEY: 'gemini-secret-value',
  UPSTASH_REDIS_REST_URL: 'https://db.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'upstash-token-secret-value',
  SESSION_ENCRYPTION_KEY: 'k'.repeat(48),
  APP_URL: 'https://thinkmate.example.com',
  VERCEL: '1',
};

const variables = (issues: { variable: string }[]) => issues.map((i) => i.variable);

describe('validateProductionConfig', () => {
  test('accepts a complete production configuration', () => {
    const report = validateProductionConfig(validEnv);
    assert.deepStrictEqual(report.errors, []);
    assert.deepStrictEqual(report.warnings, []);
    assert.strictEqual(report.ok, true);
  });

  test('reports every missing required variable', () => {
    const report = validateProductionConfig({});
    assert.strictEqual(report.ok, false);
    for (const v of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GEMINI_API_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'SESSION_ENCRYPTION_KEY',
      'APP_URL',
    ]) {
      assert.ok(variables(report.errors).includes(v), `missing error for ${v}`);
    }
  });

  test('GOOGLE_API_KEY alias and ROTATION_SECRET satisfy their requirements', () => {
    const report = validateProductionConfig({
      ...validEnv,
      GEMINI_API_KEY: undefined,
      SESSION_ENCRYPTION_KEY: undefined,
      GOOGLE_API_KEY: 'g',
      ROTATION_SECRET: 'r'.repeat(32),
    });
    assert.strictEqual(report.ok, true, JSON.stringify(report.errors));
  });

  test('rejects short, reused and non-https values', () => {
    assert.ok(variables(validateProductionConfig({ ...validEnv, SESSION_ENCRYPTION_KEY: 'short' }).errors).includes('SESSION_ENCRYPTION_KEY'));
    assert.ok(
      variables(
        validateProductionConfig({ ...validEnv, SESSION_ENCRYPTION_KEY: 'x'.repeat(40), SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40) }).errors
      ).includes('SESSION_ENCRYPTION_KEY')
    );
    assert.ok(variables(validateProductionConfig({ ...validEnv, UPSTASH_REDIS_REST_URL: 'http://db.upstash.io' }).errors).includes('UPSTASH_REDIS_REST_URL'));
    assert.ok(variables(validateProductionConfig({ ...validEnv, APP_URL: 'http://thinkmate.example.com' }).errors).includes('APP_URL'));
  });

  test('rejects staging Supabase overrides, wildcard origins and bad proxy settings', () => {
    const report = validateProductionConfig({
      ...validEnv,
      STAGING_SUPABASE_URL: 'https://staging.supabase.co',
      TRUSTED_ORIGINS: 'https://ok.example.com,*.example.com',
      TRUSTED_PROXY_PROVIDER: 'akamai',
      TRUSTED_PROXY_DEPTH: '0',
    });
    const errs = variables(report.errors);
    for (const v of ['STAGING_SUPABASE_URL', 'TRUSTED_ORIGINS', 'TRUSTED_PROXY_PROVIDER', 'TRUSTED_PROXY_DEPTH']) {
      assert.ok(errs.includes(v), `missing error for ${v}`);
    }
  });

  test('warns about degraded or ambiguous settings without failing', () => {
    const report = validateProductionConfig({ ...validEnv, VERCEL: undefined, RATE_LIMIT_FAIL_CLOSED: 'false' });
    assert.strictEqual(report.ok, true);
    assert.ok(variables(report.warnings).includes('RATE_LIMIT_FAIL_CLOSED'));
    assert.ok(variables(report.warnings).includes('TRUSTED_PROXY_HEADER'));
  });

  test('never echoes secret values in messages', () => {
    const report = validateProductionConfig({ ...validEnv, SESSION_ENCRYPTION_KEY: 'tiny-secret', UPSTASH_REDIS_REST_URL: 'ftp://user:pw@redis' });
    const text = JSON.stringify(report);
    for (const secret of ['tiny-secret', 'user:pw', 'service-role-secret-value', 'upstash-token-secret-value', 'gemini-secret-value']) {
      assert.ok(!text.includes(secret), `leaked ${secret}`);
    }
  });

  test('getSessionEncryptionKeyStatus', () => {
    assert.strictEqual(getSessionEncryptionKeyStatus({}), 'unconfigured');
    assert.strictEqual(getSessionEncryptionKeyStatus({ SESSION_ENCRYPTION_KEY: 'a'.repeat(31) }), 'weak');
    assert.strictEqual(getSessionEncryptionKeyStatus({ SESSION_ENCRYPTION_KEY: 'a'.repeat(32) }), 'ready');
  });
});
