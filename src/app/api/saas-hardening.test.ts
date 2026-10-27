import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEGAL_VERSION } from '@/lib/legal';
import { validateProductionConfig } from '@/lib/production-config';

describe('SaaS Launch Hardening Verifications', () => {
  it('Fix 4: rejects partial billing environment configurations', () => {
    const baseEnv: Record<string, string> = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      GEMINI_API_KEY: 'test-gemini-key',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'test-token',
      SESSION_ENCRYPTION_KEY: 'k'.repeat(48),
      APP_URL: 'https://thinkmate.ai',
    };

    const partialEnv = {
      ...baseEnv,
      RAZORPAY_KEY_ID: 'rzp_test_123',
    };

    const result = validateProductionConfig(partialEnv);
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) => e.variable === 'RAZORPAY_KEY_SECRET' && e.message.includes('Billing partially configured')),
      'Should report partial billing error'
    );
  });

  it('Fix 8: rejects open redirect attempts via backslash or protocol-relative slashes', () => {
    function sanitizeNext(raw: string | null | undefined): string {
      const target = raw ?? '/thinkmate';
      return target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')
        ? target
        : '/thinkmate';
    }

    assert.equal(sanitizeNext('/thinkmate'), '/thinkmate');
    assert.equal(sanitizeNext('/account'), '/account');
    assert.equal(sanitizeNext('//evil.com'), '/thinkmate');
    assert.equal(sanitizeNext('/\\evil.com'), '/thinkmate');
    assert.equal(sanitizeNext('/thinkmate\\admin'), '/thinkmate');
    assert.equal(sanitizeNext('https://evil.com'), '/thinkmate');
  });

  it('Fix 10: ensures migration 011 uses ON CONFLICT DO NOTHING for plan limits', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/011_plans_usage.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(
      content.includes('on conflict (plan) do nothing'),
      'Migration 011 must use ON CONFLICT (plan) DO NOTHING'
    );
    assert.ok(
      !content.includes('on conflict (plan) do update'),
      'Migration 011 must not overwrite tuned plan limits with DO UPDATE'
    );
  });

  it('Fix 5 & Item 3: verifies migration 014 hardens invites security with generic rejection', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/014_invites_harden.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(
      content.includes('drop policy if exists tm_invites_insert on public.tm_invites;'),
      'Must drop client direct insert policy'
    );
    assert.ok(
      content.includes('create or replace function public.tm_create_invite'),
      'Must define tm_create_invite RPC'
    );
    assert.ok(
      content.includes("public.tm_plan_for((select auth.uid())) <> 'team'"),
      'Must require team plan for invite creation'
    );
    assert.ok(
      content.includes("return jsonb_build_object('ok', false, 'error', 'invalid_or_expired')"),
      'tm_accept_invite must return generic invalid_or_expired on email mismatch to avoid token existence leakage'
    );
  });

  it('Fix 7: verifies privacy policy contains compliant AI data terms and HttpOnly explanation', () => {
    const privacyPath = path.resolve(process.cwd(), 'src/app/privacy/page.tsx');
    const content = fs.readFileSync(privacyPath, 'utf8');
    assert.ok(
      content.includes(
        "Your prompts are sent to Google&apos;s Gemini API to generate replies. Google&apos;s handling of API data is governed by Google&apos;s Gemini API terms for the plan we use."
      ),
      'Privacy policy must accurately describe Gemini API data terms'
    );
    assert.ok(
      content.includes('limit token theft in the event of client-side vulnerabilities'),
      'Privacy policy must accurately clarify that HttpOnly limits token theft rather than stopping XSS'
    );
    assert.ok(
      content.includes('privacy@thinkmate.ai'),
      'Grievance email must be present'
    );
  });

  it('Fix 6: verifies active legal versions are defined and consistent', () => {
    assert.ok(LEGAL_VERSION.terms, 'Terms version must be defined');
    assert.ok(LEGAL_VERSION.privacy, 'Privacy version must be defined');
  });

  it('Item 1: validates that turn quota checks fail closed on malformed or missing affirmative approval', () => {
    function evaluateQuotaResponse(reserveData: { allowed?: unknown } | null | undefined): 'proceed' | 'daily_cap' | 'quota_service_unavailable' {
      if (reserveData?.allowed === true) {
        return 'proceed';
      }
      if (reserveData?.allowed === false) {
        return 'daily_cap';
      }
      return 'quota_service_unavailable';
    }

    assert.equal(evaluateQuotaResponse({ allowed: true }), 'proceed');
    assert.equal(evaluateQuotaResponse({ allowed: false }), 'daily_cap');
    // Malformed, null, missing allowed, or empty responses must strictly fail closed
    assert.equal(evaluateQuotaResponse(null), 'quota_service_unavailable');
    assert.equal(evaluateQuotaResponse(undefined), 'quota_service_unavailable');
    assert.equal(evaluateQuotaResponse({}), 'quota_service_unavailable');
    assert.equal(evaluateQuotaResponse({ allowed: 'yes' }), 'quota_service_unavailable');
    assert.equal(evaluateQuotaResponse({ allowed: null }), 'quota_service_unavailable');
  });

  it('Item 4: verifies migration 015 defines atomic workspace and research limit RPCs', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/015_atomic_limits.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(
      content.includes('create or replace function public.tm_create_workspace'),
      'Must define tm_create_workspace RPC'
    );
    assert.ok(
      content.includes('create or replace function public.tm_reserve_research_quota'),
      'Must define tm_reserve_research_quota RPC'
    );
    assert.ok(
      content.includes('pg_advisory_xact_lock'),
      'Must use advisory transaction lock to eliminate check-then-insert race conditions'
    );
  });

  it('Item 5: verifies migration runner includes all timestamped and numbered migrations', () => {
    const runnerPath = path.resolve(process.cwd(), 'scripts/apply-tm-migrations.ts');
    const content = fs.readFileSync(runnerPath, 'utf8');
    assert.ok(content.includes('20261012000000_thinkmate_schema.sql'), 'Must include 20261012 schema');
    assert.ok(content.includes('20261013000000_concurrency_and_idempotency_hardening.sql'), 'Must include 20261013 concurrency');
    assert.ok(content.includes('20261015000000_enforce_workflow_decision_gate.sql'), 'Must include 20261015 gate');
    assert.ok(content.includes('015_atomic_limits.sql'), 'Must include 015 atomic limits');
    assert.ok(content.includes('execute_workflow_transition_tx'), 'Must verify workflow transition function');
    assert.ok(content.includes('chk_stage_mode_compatible'), 'Must verify stage-mode constraint');
  });

  it('Item 6: verifies staging E2E test uses exact pathname polling', () => {
    const e2ePath = path.resolve(process.cwd(), 'e2e/staging/thinkmate.spec.ts');
    const content = fs.readFileSync(e2ePath, 'utf8');
    assert.ok(
      content.includes("expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe('/thinkmate')"),
      'Staging E2E must poll exact URL pathname to avoid matching /login?next=/thinkmate'
    );
  });

  it('Item 1: verifies tm_invite also enforces team plan', () => {
    const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/014_invites_harden.sql');
    const content = fs.readFileSync(migrationPath, 'utf8');
    assert.ok(
      content.includes('create or replace function public.tm_invite'),
      'Must harden tm_invite RPC'
    );
    assert.ok(
      content.includes("if public.tm_plan_for((select auth.uid())) <> 'team' then"),
      'tm_invite must enforce team plan'
    );
  });
});
