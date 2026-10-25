import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateSessions, validateScores, PilotSessionRow, PilotScoreRow } from '../scripts/analyze';

describe('Production Readiness & Operational Safeguards', () => {
  describe('P0 Database Safety — Migration Target Validation', () => {
    it('rejects missing SUPABASE_PROJECT_REF', async () => {
      const origRef = process.env.SUPABASE_PROJECT_REF;
      try {
        delete process.env.SUPABASE_PROJECT_REF;
        const { applyMigrations } = await import('../scripts/apply-tm-migrations');
        await assert.rejects(
          async () => {
            await applyMigrations();
          },
          /SUPABASE_PROJECT_REF is required/
        );
      } finally {
        if (origRef) process.env.SUPABASE_PROJECT_REF = origRef;
      }
    });

    it('rejects invalid SUPABASE_PROJECT_REF format', async () => {
      const origRef = process.env.SUPABASE_PROJECT_REF;
      try {
        process.env.SUPABASE_PROJECT_REF = 'invalid-ref!';
        const { applyMigrations } = await import('../scripts/apply-tm-migrations');
        await assert.rejects(
          async () => {
            await applyMigrations();
          },
          /Invalid SUPABASE_PROJECT_REF/
        );
      } finally {
        if (origRef) process.env.SUPABASE_PROJECT_REF = origRef;
        else delete process.env.SUPABASE_PROJECT_REF;
      }
    });

    it('blocks production migration when CONFIRM_PRODUCTION_MIGRATION is not true', async () => {
      const origRef = process.env.SUPABASE_PROJECT_REF;
      const origConfirm = process.env.CONFIRM_PRODUCTION_MIGRATION;
      const origToken = process.env.SUPABASE_ACCESS_TOKEN;
      try {
        process.env.SUPABASE_PROJECT_REF = 'gtkvujspajcelzufpggr'; // Known production ref
        process.env.SUPABASE_ACCESS_TOKEN = 'mock-access-token-123456';
        delete process.env.CONFIRM_PRODUCTION_MIGRATION;

        const { applyMigrations } = await import('../scripts/apply-tm-migrations');
        await assert.rejects(
          async () => {
            await applyMigrations();
          },
          /TARGET SAFETY ABORT/
        );
      } finally {
        if (origRef) process.env.SUPABASE_PROJECT_REF = origRef;
        else delete process.env.SUPABASE_PROJECT_REF;
        if (origConfirm) process.env.CONFIRM_PRODUCTION_MIGRATION = origConfirm;
        else delete process.env.CONFIRM_PRODUCTION_MIGRATION;
        if (origToken) process.env.SUPABASE_ACCESS_TOKEN = origToken;
        else delete process.env.SUPABASE_ACCESS_TOKEN;
      }
    });
  });

  describe('P0 Security — RLS Test Credentials Validation', () => {
    it('immediately throws when required test credentials are missing', async () => {
      const origEmailA = process.env.TEST_A_EMAIL;
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      try {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
        delete process.env.TEST_A_EMAIL;
        const { runRlsTests } = await import('../scripts/rls-test');
        await assert.rejects(
          async () => {
            await runRlsTests();
          },
          /Missing required environment variable: TEST_A_EMAIL/
        );
      } finally {
        if (origEmailA) process.env.TEST_A_EMAIL = origEmailA;
        if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
        else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (origKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
        else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
    });

    it('rejects identity collision when TEST_A_EMAIL equals TEST_B_EMAIL', async () => {
      const origEmailA = process.env.TEST_A_EMAIL;
      const origPassA = process.env.TEST_A_PASS;
      const origEmailB = process.env.TEST_B_EMAIL;
      const origPassB = process.env.TEST_B_PASS;
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      try {
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
        process.env.TEST_A_EMAIL = 'same@thinkmate.dev';
        process.env.TEST_A_PASS = 'Secret123!';
        process.env.TEST_B_EMAIL = 'same@thinkmate.dev';
        process.env.TEST_B_PASS = 'Secret123!';

        const { runRlsTests } = await import('../scripts/rls-test');
        await assert.rejects(
          async () => {
            await runRlsTests();
          },
          /TEST_A_EMAIL and TEST_B_EMAIL must represent distinct test identities/
        );
      } finally {
        if (origEmailA) process.env.TEST_A_EMAIL = origEmailA;
        else delete process.env.TEST_A_EMAIL;
        if (origPassA) process.env.TEST_A_PASS = origPassA;
        else delete process.env.TEST_A_PASS;
        if (origEmailB) process.env.TEST_B_EMAIL = origEmailB;
        else delete process.env.TEST_B_EMAIL;
        if (origPassB) process.env.TEST_B_PASS = origPassB;
        else delete process.env.TEST_B_PASS;
        if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
        else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (origKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origKey;
        else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
    });
  });

  describe('P2 Pilot Analysis — Protocol & Milestone Integrity', () => {
    it('validates required fields and milestone bounds in session rows', () => {
      const validRows: PilotSessionRow[] = [
        {
          session_id: 'S001',
          participant: 'P1',
          condition: 'thinkmate',
          brief: 'X',
          order: '1',
          minutes_to_frame: '12',
          completed: 'y',
          abandoned: 'n',
          would_use: 'y',
          named_situation: 'y',
        },
      ];
      assert.deepStrictEqual(validateSessions(validRows), []);
    });

    it('rejects invalid or out-of-bounds minutes_to_frame (> 45 min)', () => {
      const invalidRows: PilotSessionRow[] = [
        {
          session_id: 'S002',
          participant: 'P2',
          condition: 'thinkmate',
          brief: 'Y',
          order: '2',
          minutes_to_frame: '55', // Out of bounds
          completed: 'y',
          abandoned: 'n',
          would_use: 'y',
          named_situation: 'y',
        },
      ];
      const errors = validateSessions(invalidRows);
      assert.ok(errors.some((e) => e.includes('Must be between 1 and 45')));
    });

    it('rejects scores outside the 1 to 4 anchor rubric', () => {
      const invalidScores: PilotScoreRow[] = [
        {
          session_id: 'S001',
          scorer: 'scorer1',
          p: '5', // Invalid: rubric is 1-4
          e: '3',
          i: '2',
          d: '0', // Invalid: rubric is 1-4
        },
      ];
      const errors = validateScores(invalidScores);
      assert.strictEqual(errors.length, 2);
      assert.ok(errors.some((e) => e.includes('"p" has invalid value "5"')));
      assert.ok(errors.some((e) => e.includes('"d" has invalid value "0"')));
    });
  });
});
