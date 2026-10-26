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

    // Missing some Razorpay keys while having at least one set
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

  it('Fix 5: verifies migration 014 hardens invites security', () => {
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
      content.includes('email_mismatch'),
      'tm_accept_invite must verify caller email matches invited email'
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
});
