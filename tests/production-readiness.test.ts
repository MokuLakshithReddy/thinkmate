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
        for (const prodRef of ['gtkvujspajcelzufpggr', 'ujbpyqubhxycgtaadkce']) {
          process.env.SUPABASE_PROJECT_REF = prodRef;
          process.env.SUPABASE_ACCESS_TOKEN = 'mock-access-token-123456';
          delete process.env.CONFIRM_PRODUCTION_MIGRATION;

          const { applyMigrations } = await import('../scripts/apply-tm-migrations');
          await assert.rejects(
            async () => {
              await applyMigrations();
            },
            /TARGET SAFETY ABORT/
          );
        }
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

  describe('P1 AI Reliability — Health Release Readiness', () => {
    it('requires real AI verification when release_readiness is requested and fails closed if unconfigured', async () => {
      const { NextRequest } = await import('next/server');
      const { GET: healthGet } = await import('../src/app/api/health/route');

      const origKey = process.env.GEMINI_API_KEY;
      const origGoogleKey = process.env.GOOGLE_API_KEY;
      try {
        delete process.env.GEMINI_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        const req = new NextRequest('http://localhost:3000/api/health?release_readiness=true');
        const res = await healthGet(req);
        const data = await res.json();
        assert.strictEqual(res.status, 503);
        assert.strictEqual(data.dependencies.aiProvider.status, 'unconfigured');
        assert.strictEqual(data.releaseReadiness, 'degraded');
      } finally {
        if (origKey) process.env.GEMINI_API_KEY = origKey;
        if (origGoogleKey) process.env.GOOGLE_API_KEY = origGoogleKey;
      }
    });

    it('rejects AI responses when probe encounters execution or degraded status during release readiness', async () => {
      const { NextRequest } = await import('next/server');
      const { GET: healthGet } = await import('../src/app/api/health/route');

      const origKey = process.env.GEMINI_API_KEY;
      const origGoogleKey = process.env.GOOGLE_API_KEY;
      try {
        process.env.GEMINI_API_KEY = 'invalid-probe-key-123';
        delete process.env.GOOGLE_API_KEY;
        const req = new NextRequest('http://localhost:3000/api/health?release_readiness=true');
        const res = await healthGet(req);
        const data = await res.json();
        assert.strictEqual(res.status, 503);
        assert.strictEqual(data.dependencies.aiProvider.status, 'degraded');
        assert.strictEqual(data.releaseReadiness, 'degraded');
        assert.strictEqual(data.dependencies.aiProvider.liveVerified, false);
      } finally {
        if (origKey) process.env.GEMINI_API_KEY = origKey;
        else delete process.env.GEMINI_API_KEY;
        if (origGoogleKey) process.env.GOOGLE_API_KEY = origGoogleKey;
        else delete process.env.GOOGLE_API_KEY;
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
          chosen_idea: 'Idea-HybridCache',
        },
      ];
      assert.deepStrictEqual(validateSessions(validRows), []);
    });

    it('rejects completed sessions that are missing chosen_idea milestone', () => {
      const missingIdeaRows: PilotSessionRow[] = [
        {
          session_id: 'S003',
          participant: 'P3',
          condition: 'thinkmate',
          brief: 'Z',
          order: '1',
          minutes_to_frame: '15',
          completed: 'y',
          abandoned: 'n',
          would_use: 'y',
          named_situation: 'y',
          chosen_idea: '',
        },
      ];
      const errors = validateSessions(missingIdeaRows);
      assert.ok(errors.some((e) => e.includes('missing required chosen_idea milestone')));
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
          chosen_idea: 'Idea-Test',
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

    it('runAnalysis successfully verifies synthetic benchmark gates and detects failures', async () => {
      const origSynthetic = process.env.PILOT_SYNTHETIC;
      try {
        process.env.PILOT_SYNTHETIC = 'true';
        const { runAnalysis } = await import('../scripts/analyze');
        const res = runAnalysis();
        assert.strictEqual(res.status, 'passed');
        assert.strictEqual(res.failedCount, 0);
        assert.strictEqual(res.gates.length, 5);
        assert.ok(res.gates.every((g) => g.pass));
      } finally {
        if (origSynthetic) process.env.PILOT_SYNTHETIC = origSynthetic;
        else delete process.env.PILOT_SYNTHETIC;
      }
    });
  });

  describe('P1 & P2 Critical Source Safety — Atomic Persistence, Context Reads, Audit Events', () => {
    it('loadState throws explicit error when child queries fail, preventing silent context omission', async () => {
      const { loadState } = await import('../src/lib/thinkmate/state');
      const wsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => {
          if (table === 'tm_workspaces') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () => Promise.resolve({ data: { id: wsId, title: 'Test WS' }, error: null }),
                }),
              }),
            };
          }
          if (table === 'tm_messages') {
            return {
              select: () => ({
                eq: () => ({
                  order: () => Promise.resolve({ data: null, error: { message: 'connection reset by peer' } }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => {
                const res = Promise.resolve({ data: [], error: null });
                return Object.assign(res, {
                  order: () => Promise.resolve({ data: [], error: null }),
                });
              },
            }),
          };
        },
      } as any;

      await assert.rejects(
        async () => {
          await loadState(mockSb, wsId);
        },
        /Failed to load messages for workspace a0000000-0000-0000-0000-000000000001: connection reset by peer/
      );
    });

    it('logEvent enforces mandatory audit persistence and rejects on database error', async () => {
      const { logEvent } = await import('../src/lib/thinkmate/state');
      const wsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => {
          assert.strictEqual(table, 'tm_events');
          return {
            insert: () => Promise.resolve({ error: { message: 'disk quota exceeded' } }),
          };
        },
      } as any;

      await assert.rejects(
        async () => {
          await logEvent(mockSb, wsId, 'turn_complete', { ok: true });
        },
        /Failed to log audit event 'turn_complete' for workspace a0000000-0000-0000-0000-000000000001: disk quota exceeded/
      );
    });

    it('logEvent suppresses rejection when required is explicitly false', async () => {
      const { logEvent } = await import('../src/lib/thinkmate/state');
      const wsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: () => ({
          insert: () => Promise.resolve({ error: { message: 'table locked' } }),
        }),
      } as any;

      // Should resolve without throwing
      await logEvent(mockSb, wsId, 'model_error', { err: 'timeout' }, { required: false });
    });

    it('applyModelOutput delegates to atomic RPC tm_apply_turn_tx when available', async () => {
      const { applyModelOutput } = await import('../src/lib/thinkmate/state');
      const wsId = 'a0000000-0000-0000-0000-000000000001';
      let rpcCalledWith: any = null;

      const mockSb = {
        rpc: async (fnName: string, params: any) => {
          rpcCalledWith = { fnName, params };
          return { data: { success: true }, error: null };
        },
        from: () => ({
          select: () => ({
            eq: () => {
              const res = Promise.resolve({ data: [], error: null });
              return Object.assign(res, {
                maybeSingle: () => Promise.resolve({ data: { id: wsId, title: 'Test WS' }, error: null }),
                order: () => Promise.resolve({ data: [], error: null }),
              });
            },
          }),
        }),
      } as any;

      const out = {
        reply: 'Consider using read-replicas.',
        guidance_mode: 'hint' as const,
        proposed_problem_frame: 'High read volume',
        proposed_items: [{ kind: 'idea' as const, text: 'Deploy read replicas', origin: 'ai' as const }],
      };

      await applyModelOutput(mockSb, wsId, 'How can we scale reads?', out, 120, 'ideate', 42, 'client-123', 'user-1');

      assert.ok(rpcCalledWith);
      assert.strictEqual(rpcCalledWith.fnName, 'tm_apply_turn_tx');
      assert.strictEqual(rpcCalledWith.params.p_workspace_id, wsId);
      assert.strictEqual(rpcCalledWith.params.p_client_msg_id, 'client-123');
      assert.strictEqual(rpcCalledWith.params.p_user_message, 'How can we scale reads?');
      assert.strictEqual(rpcCalledWith.params.p_assistant_reply, 'Consider using read-replicas.');
    });

    it('applyModelOutput aborts cleanly with error when atomic RPC encounters database failure', async () => {
      const { applyModelOutput } = await import('../src/lib/thinkmate/state');
      const wsId = 'a0000000-0000-0000-0000-000000000001';

      const mockSb = {
        rpc: async () => {
          return { data: null, error: { message: 'deadlock detected between transactions', code: '40P01' } };
        },
      } as any;

      const out = {
        reply: 'Consider using read-replicas.',
        guidance_mode: 'hint' as const,
        proposed_problem_frame: null,
        proposed_items: [],
      };

      await assert.rejects(
        async () => {
          await applyModelOutput(mockSb, wsId, 'Scaling query', out, 100, 'ideate');
        },
        /Failed to apply turn atomically: deadlock detected between transactions/
      );
    });
  });
});

