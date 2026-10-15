import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SupabaseThinkingRepository, computeRequestHash } from './repository';
import { ThinkingSession } from '@/types';
import { SupabaseClient } from '@supabase/supabase-js';

function createMockClient(data: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data,
            error: null,
          }),
          order: () => ({
            data: data ? [data] : [],
            error: null,
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data,
            error: null,
          }),
        }),
      }),
      update: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              single: async () => ({
                data,
                error: null,
              }),
            }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: async () => ({
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('Persistence, Security & Mandatory Ownership Verification', () => {
  test('IDOR Protection: throws when accessing session belonging to another user', async () => {
    const foreignSession: ThinkingSession = {
      id: '00000000-0000-0000-0000-000000000001',
      userId: 'user-alice-1234',
      title: 'Alice Private Dilemma',
      problemStatement: 'Confidential strategic decision',
      currentMode: 'understand',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockClient = createMockClient({
      id: foreignSession.id,
      user_id: foreignSession.userId,
      title: foreignSession.title,
      problem_statement: foreignSession.problemStatement,
      current_mode: foreignSession.currentMode,
      status: foreignSession.status,
    });

    const repo = new SupabaseThinkingRepository(mockClient);

    // Alice accessing her own session succeeds
    const aliceAccess = await repo.getSession(foreignSession.id, 'user-alice-1234');
    assert.strictEqual(aliceAccess?.id, foreignSession.id);

    // Eve trying to access Alice's session must throw unauthorized error
    await assert.rejects(
      async () => {
        await repo.getSession(foreignSession.id, 'user-eve-9999');
      },
      {
        name: 'Error',
        message: 'Unauthorized session access: ownership verification failed',
      }
    );
  });

  test('Mandatory Ownership: throws immediately when userId is missing', async () => {
    const mockClient = createMockClient();
    const repo = new SupabaseThinkingRepository(mockClient);

    await assert.rejects(
      async () => {
        await repo.getSessions('');
      },
      {
        name: 'Error',
        message: 'Mandatory authorization failure: userId is required to fetch sessions',
      }
    );

    await assert.rejects(
      async () => {
        await repo.getSession('some-id', '');
      },
      {
        name: 'Error',
        message: 'Mandatory authorization failure: userId is required to access session',
      }
    );
  });

  test('Session update enforces ownership validation before applying modifications', async () => {
    const mockClient = createMockClient();
    const repo = new SupabaseThinkingRepository(mockClient);

    (repo as unknown as { getSession: unknown }).getSession = async (
      id: string,
      userId: string
    ) => {
      if (userId === 'attacker-user') {
        throw new Error('Session not found or unauthorized');
      }
      return { id, userId: 'owner-user', title: 'Original' };
    };

    await assert.rejects(
      async () => {
        await repo.updateSession('sess-1', { title: 'Hijacked' }, 'attacker-user');
      },
      {
        message: 'Session not found or unauthorized',
      }
    );
  });

  test('Messages and insights retrieval rejects unauthorized access to foreign sessions', async () => {
    const mockClient = createMockClient();
    const repo = new SupabaseThinkingRepository(mockClient);

    (repo as unknown as { getSession: unknown }).getSession = async (
      id: string,
      userId: string
    ) => {
      if (userId === 'foreign-user') {
        throw new Error('Session not found or unauthorized');
      }
      return { id, userId: 'owner-user', title: 'Private' };
    };

    await assert.rejects(
      async () => {
        await repo.getMessages('sess-private', 'foreign-user');
      },
      {
        message: 'Session not found or unauthorized',
      }
    );

    await assert.rejects(
      async () => {
        await repo.getInsights('sess-private', 'foreign-user');
      },
      {
        message: 'Session not found or unauthorized',
      }
    );
  });

  test('Cross-User Insight Overwrite: rejects attempting to overwrite insight belonging to another user', async () => {
    const mockClient = {
      from: (table: string) => {
        if (table === 'session_insights') {
          return {
            select: () => ({
              eq: (col: string, val: string) => ({
                maybeSingle: async () => {
                  // Simulates finding the existing insight belonging to Alice's session
                  if (val === '00000000-0000-0000-0000-000000000099') {
                    return {
                      data: {
                        id: '00000000-0000-0000-0000-000000000099',
                        session_id: 'alice-session-uuid-1',
                      },
                      error: null,
                    };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    // Mock getSession to authorize Eve only for eve-session, not alice-session
    (repo as unknown as { getSession: unknown }).getSession = async (
      sessionId: string,
      userId: string
    ) => {
      if (userId === 'user-eve' && sessionId === 'eve-session-uuid-2') {
        return { id: 'eve-session-uuid-2', userId: 'user-eve', title: 'Eve Session' };
      }
      return null;
    };

    // Eve passes Alice's insight ID while referencing Eve's session
    await assert.rejects(
      async () => {
        await repo.upsertInsight(
          {
            id: '00000000-0000-0000-0000-000000000099',
            sessionId: 'eve-session-uuid-2',
            category: 'goal',
            title: 'Hijacked Goal',
            content: 'Malicious modification',
            status: 'accepted',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          'user-eve'
        );
      },
      {
        name: 'Error',
        message: 'Security violation: Cannot reassign insight belonging to another session',
      }
    );
  });

  test('updateSession persists problemStatement and currentStage', async () => {
    let capturedPayload: Record<string, unknown> = {};
    const mockClient = {
      from: (table: string) => {
        if (table === 'thinking_sessions') {
          return {
            update: (payload: Record<string, unknown>) => {
              capturedPayload = payload;
              return {
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      single: async () => ({
                        data: {
                          id: 'sess-123',
                          user_id: 'user-123',
                          title: 'Updated Title',
                          problem_statement: payload.problem_statement,
                          current_mode: 'explore',
                          current_stage: payload.current_stage,
                          status: 'active',
                          created_at: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              };
            },
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    (repo as unknown as { getSession: unknown }).getSession = async () => ({
      id: 'sess-123',
      userId: 'user-123',
      title: 'Initial',
      problemStatement: 'Initial problem',
      currentMode: 'understand',
      currentStage: 'welcome',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = await repo.updateSession(
      'sess-123',
      {
        problemStatement: 'New authentic problem dilemma',
        currentStage: 'explore_perspectives',
        currentMode: 'explore',
      },
      'user-123'
    );

    assert.equal(capturedPayload.problem_statement, 'New authentic problem dilemma');
    assert.equal(capturedPayload.current_stage, 'explore_perspectives');
    assert.equal(updated.problemStatement, 'New authentic problem dilemma');
    assert.equal(updated.currentStage, 'explore_perspectives');
  });

  test('recordWorkflowStep commits workflow transition and compensates on failure', async () => {
    const deletedMessageIds: string[] = [];
    const mockClient = {
      from: (table: string) => {
        if (table === 'session_messages') {
          return {
            insert: async (row: { id: string }) => {
              return { data: row, error: null };
            },
            delete: () => ({
              eq: async (col: string, val: string) => {
                if (col === 'id') deletedMessageIds.push(val);
                return { error: null };
              },
            }),
          };
        }
        if (table === 'thinking_sessions') {
          return {
            update: () => ({
              eq: () => ({
                eq: async () => {
                  // Simulate database update failure
                  return { error: { message: 'Database connection dropped' } };
                },
              }),
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    (repo as unknown as { getSession: unknown }).getSession = async () => ({
      id: 'sess-abc',
      userId: 'user-abc',
      title: 'Test',
      problemStatement: 'Problem',
      currentMode: 'understand',
      currentStage: 'describe_problem',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await assert.rejects(
      async () => {
        await repo.recordWorkflowStep(
          {
            sessionId: 'sess-abc',
            userMessage: 'My input',
            assistantMessage: 'AI answer',
            nextStage: 'clarify_objective',
            nextMode: 'understand',
            expectedStage: 'describe_problem',
            expectedMode: 'understand',
          },
          'user-abc'
        );
      },
      {
        message: 'Failed to commit workflow state: Database connection dropped',
      }
    );

    // Assert that inserted messages were rolled back
    assert.equal(deletedMessageIds.length, 2);
  });

  test('recordWorkflowStep returns cached result idempotently for duplicate clientRequestId', async () => {
    const mockClient = {
      rpc: async () => ({
        data: [{
          session_id: 'sess-idem',
          user_message_id: 'msg-u1',
          assistant_message_id: 'msg-a1',
          next_stage: 'clarify_objective',
          next_mode: 'understand',
        }],
        error: null,
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    (repo as unknown as { getSession: unknown }).getSession = async () => ({
      id: 'sess-idem',
      userId: 'user-idem',
      title: 'Idempotency Test',
      problemStatement: 'Problem',
      currentMode: 'understand',
      currentStage: 'describe_problem',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const clientRequestId = `req-test-${Date.now()}`;
    const firstCall = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-idem',
        userMessage: 'Test prompt',
        assistantMessage: 'Test response',
        nextStage: 'clarify_objective',
        nextMode: 'understand',
        expectedStage: 'describe_problem',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-idem'
    );

    assert.strictEqual(firstCall.sessionId, 'sess-idem');

    // Second call with same clientRequestId and payload must return cached result
    const secondCall = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-idem',
        userMessage: 'Test prompt',
        assistantMessage: 'Test response',
        nextStage: 'clarify_objective',
        nextMode: 'understand',
        expectedStage: 'describe_problem',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-idem'
    );

    assert.strictEqual(secondCall.sessionId, firstCall.sessionId);
    assert.strictEqual(secondCall.isIdempotentReplay, true);
  });

  test('deleteAllUserSessions deletes all sessions for the authenticated user and rejects unauthorized callers', async () => {
    let deletedUserId: string | null = null;
    const mockClient = {
      from: (table: string) => {
        if (table === 'thinking_sessions') {
          return {
            select: () => ({
              eq: async () => ({
                data: [{ id: 'sess-1' }, { id: 'sess-2' }],
                error: null,
              }),
            }),
            delete: () => ({
              eq: async (_col: string, val: string) => {
                deletedUserId = val;
                return { error: null };
              },
            }),
          };
        }
        return {};
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    await assert.rejects(
      async () => {
        await repo.deleteAllUserSessions('');
      },
      {
        message: 'Mandatory authorization failure: userId is required to delete all sessions',
      }
    );

    const count = await repo.deleteAllUserSessions('user-target-123');
    assert.strictEqual(count, 2);
    assert.strictEqual(deletedUserId, 'user-target-123');
  });

  test('recordWorkflowStep fails immediately if RPC rejects with identity or authorization failure', async () => {
    const mockClient = {
      rpc: async () => ({
        data: null,
        error: { message: 'Forbidden: caller auth.uid does not match target p_user_id' },
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    (repo as unknown as { getSession: unknown }).getSession = async () => null;

    await assert.rejects(
      async () => {
        await repo.recordWorkflowStep(
          {
            sessionId: '00000000-0000-0000-0000-000000000001',
            userMessage: 'test',
            assistantMessage: 'test',
            nextStage: 'describe_problem',
            nextMode: 'understand',
            expectedStage: 'describe_problem',
            expectedMode: 'understand',
          },
          '00000000-0000-0000-0000-000000000002'
        );
      },
      {
        message: 'Session not found or unauthorized',
      }
    );
  });

  test('two simultaneous transitions against the same initial stage detects optimistic conflict', async () => {
    let callCount = 0;
    // Simulate database where first call advances stage from describe_problem to clarify_objective,
    // and second concurrent call detects that stage is no longer describe_problem.
    const mockClient = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        callCount++;
        if (callCount === 1) {
          // First transition succeeds
          return {
            data: [{
              session_id: args.p_session_id,
              assistant_message_id: 'ast-1',
              next_stage: 'clarify_objective',
              next_mode: 'understand',
            }],
            error: null,
          };
        } else {
          // Second simultaneous transition arrives with stale expectedStage
          return {
            data: null,
            error: {
              message: 'CONFLICT: expected stage "describe_problem" but session is at "clarify_objective". Reload the session.',
            },
          };
        }
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    const [firstCall, secondCall] = await Promise.all([
      repo.recordWorkflowStep(
        {
          sessionId: 'sess-concurrent-1',
          userMessage: 'First concurrent thought',
          assistantMessage: 'First response',
          nextStage: 'clarify_objective',
          nextMode: 'understand',
          expectedStage: 'describe_problem',
          expectedMode: 'understand',
        },
        'user-concurrent'
      ),
      repo.recordWorkflowStep(
        {
          sessionId: 'sess-concurrent-1',
          userMessage: 'Second concurrent thought',
          assistantMessage: 'Second response',
          nextStage: 'clarify_objective',
          nextMode: 'understand',
          expectedStage: 'describe_problem',
          expectedMode: 'understand',
        },
        'user-concurrent'
      ),
    ]);

    assert.strictEqual(firstCall.nextStage, 'clarify_objective');
    assert.strictEqual(firstCall.isConflict, undefined);

    // Second call must receive conflict flag mapping to HTTP 409
    assert.strictEqual(secondCall.isConflict, true, 'Second concurrent call must be flagged as conflict');
  });

  test('production runtime fails closed if transactional RPC is unavailable', async () => {
    const oldEnv = process.env.NODE_ENV;
    const oldFailClosed = process.env.FAIL_CLOSED_WORKFLOW;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.FAIL_CLOSED_WORKFLOW = 'true';

      // Mock client without RPC function
      const mockClientNoRpc = {
        from: () => ({}),
      } as unknown as SupabaseClient;

      const repo = new SupabaseThinkingRepository(mockClientNoRpc);

      await assert.rejects(
        async () => {
          await repo.recordWorkflowStep(
            {
              sessionId: 'sess-prod-fail',
              assistantMessage: 'AI msg',
              nextStage: 'clarify_objective',
              nextMode: 'understand',
              expectedStage: 'describe_problem',
              expectedMode: 'understand',
            },
            'user-prod'
          );
        },
        (err: Error) => {
          return err.message.includes('FATAL: Transactional RPC record_workflow_step_tx is not available');
        }
      );
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = oldEnv;
      if (oldFailClosed !== undefined) {
        process.env.FAIL_CLOSED_WORKFLOW = oldFailClosed;
      } else {
        delete process.env.FAIL_CLOSED_WORKFLOW;
      }
    }
  });

  test('atomic transitionMode detects concurrent mode mutation conflict', async () => {
    const mockClient = {
      rpc: async () => ({
        data: null,
        error: {
          message: 'CONFLICT: expected mode "understand" but session is currently at "explore". Reload session.',
        },
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    const result = await repo.transitionMode(
      {
        sessionId: 'sess-mode-conflict',
        expectedMode: 'understand',
        toMode: 'explore',
      },
      'user-mode'
    );

    assert.strictEqual(result.isConflict, true);
    assert.strictEqual(result.allowed, false);
  });

  test('atomic transitionMode to act is denied when no accepted decision exists', async () => {
    const mockClient = {
      rpc: async () => ({
        data: null,
        error: {
          message: 'Transition to Act mode denied: an accepted decision insight is required',
        },
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    const result = await repo.transitionMode(
      {
        sessionId: 'sess-act-denied',
        expectedMode: 'decide',
        toMode: 'act',
      },
      'user-mode'
    );

    assert.strictEqual(result.allowed, false);
  });

  test('idempotent replay returns complete client response matching original response field-by-field', async () => {
    let storedIdempotencyPayload: Record<string, unknown> | null = null;

    const mockClient = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'record_workflow_step_tx') {
          // If already stored, return the stored payload as idempotent replay
          if (storedIdempotencyPayload) {
            return {
              data: {
                ...storedIdempotencyPayload,
                isIdempotentReplay: true,
              },
              error: null,
            };
          }

          const responseData = {
            sessionId: args.p_session_id,
            userMessageId: 'user-msg-1',
            assistantMessageId: 'asst-msg-1',
            nextStage: args.p_next_stage,
            nextMode: args.p_next_mode,
            message: 'I have broken your problem into three key subproblems.',
            nextStep: 'break_subproblems',
            options: [
              { id: 'opt-1', label: 'Explore architecture trade-offs', category: 'action' },
              { id: 'opt-2', label: 'Clarify non-functional requirements', category: 'action' },
            ],
            progressPercent: 35,
            executionMode: 'gemini',
            modelName: 'gemini-2.5-flash',
            isIdempotentReplay: false,
          };

          storedIdempotencyPayload = responseData;

          return {
            data: responseData,
            error: null,
          };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    const clientRequestId = `req-field-match-${Date.now()}`;

    // First call: initial workflow step execution
    const firstResponse = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-full-shape-1',
        userMessage: 'Here is my design dilemma',
        assistantMessage: 'I have broken your problem into three key subproblems.',
        nextStage: 'break_subproblems',
        nextMode: 'explore',
        expectedStage: 'clarify_objective',
        expectedMode: 'understand',
        clientRequestId,
        clientResponse: {
          message: 'I have broken your problem into three key subproblems.',
          nextStep: 'break_subproblems',
          options: [
            { id: 'opt-1', label: 'Explore architecture trade-offs', category: 'action' },
            { id: 'opt-2', label: 'Clarify non-functional requirements', category: 'action' },
          ],
          progressPercent: 35,
          executionMode: 'gemini',
          modelName: 'gemini-2.5-flash',
        },
      },
      'user-full-shape'
    );

    // Verify first response has complete client-facing fields
    assert.strictEqual(firstResponse.message, 'I have broken your problem into three key subproblems.');
    assert.strictEqual(firstResponse.nextStep, 'break_subproblems');
    assert.strictEqual(firstResponse.options?.length, 2);
    assert.strictEqual(firstResponse.progressPercent, 35);
    assert.strictEqual(firstResponse.executionMode, 'gemini');
    assert.strictEqual(firstResponse.modelName, 'gemini-2.5-flash');

    // Second call: idempotent retry with the exact same clientRequestId
    const replayResponse = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-full-shape-1',
        userMessage: 'Here is my design dilemma',
        assistantMessage: 'I have broken your problem into three key subproblems.',
        nextStage: 'break_subproblems',
        nextMode: 'explore',
        expectedStage: 'clarify_objective',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-full-shape'
    );

    // Verify field-by-field equality between first response and replay response
    assert.strictEqual(replayResponse.message, firstResponse.message, 'message must match original');
    assert.strictEqual(replayResponse.nextStep, firstResponse.nextStep, 'nextStep must match original');
    assert.deepStrictEqual(replayResponse.options, firstResponse.options, 'options must match original');
    assert.strictEqual(replayResponse.progressPercent, firstResponse.progressPercent, 'progressPercent must match original');
    assert.strictEqual(replayResponse.executionMode, firstResponse.executionMode, 'executionMode must match original');
    assert.strictEqual(replayResponse.modelName, firstResponse.modelName, 'modelName must match original');
    assert.strictEqual(replayResponse.isIdempotentReplay, true, 'isIdempotentReplay must be true on replay');
  });

  test('idempotency check under lock succeeds on retry even after session stage has already advanced', async () => {
    // Simulates database row state: after 1st execution, session is at break_subproblems
    let sessionStage = 'clarify_objective';
    let storedPayload: Record<string, unknown> | null = null;
    let storedHash: string | null = null;

    const mockClient = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'record_workflow_step_tx') {
          // STEP 2: Under FOR UPDATE lock, check idempotency FIRST
          if (args.p_client_request_id && storedPayload) {
            if (args.p_request_hash !== storedHash) {
              return { data: null, error: { message: 'Idempotency key reuse violation' } };
            }
            return {
              data: {
                ...storedPayload,
                isIdempotentReplay: true,
              },
              error: null,
            };
          }

          // STEP 3: Concurrency check ONLY applies to non-idempotent (new) requests
          if (sessionStage !== args.p_expected_stage) {
            return {
              data: null,
              error: {
                message: `CONFLICT: expected stage "${args.p_expected_stage}" but session is at "${sessionStage}". Reload the session.`,
              },
            };
          }

          // Advance session stage
          sessionStage = args.p_next_stage as string;
          storedPayload = {
            sessionId: args.p_session_id,
            assistantMessageId: 'asst-msg-adv-1',
            nextStage: args.p_next_stage,
            nextMode: args.p_next_mode,
            message: 'Objective clarified.',
            nextStep: args.p_next_stage,
          };
          storedHash = args.p_request_hash as string;

          return { data: storedPayload, error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    const clientRequestId = `req-stale-stage-retry-${Date.now()}`;

    // 1st request: expectedStage = 'clarify_objective' -> advances session to 'break_subproblems'
    const firstCall = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-adv-1',
        assistantMessage: 'Objective clarified.',
        nextStage: 'break_subproblems',
        nextMode: 'explore',
        expectedStage: 'clarify_objective',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-adv-test'
    );
    assert.strictEqual(firstCall.nextStage, 'break_subproblems');
    assert.strictEqual(sessionStage, 'break_subproblems');

    // 2nd request (retry of 1st request): caller still sends original expectedStage = 'clarify_objective'.
    // Even though database session is now at 'break_subproblems',
    // the idempotency check under lock executes before the concurrency check and returns the saved response!
    const replayCall = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-adv-1',
        assistantMessage: 'Objective clarified.',
        nextStage: 'break_subproblems',
        nextMode: 'explore',
        expectedStage: 'clarify_objective',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-adv-test'
    );

    assert.strictEqual(replayCall.isConflict, undefined, 'Retry must not trigger conflict');
    assert.strictEqual(replayCall.isIdempotentReplay, true, 'Retry must return idempotent result');
    assert.strictEqual(replayCall.nextStage, 'break_subproblems');
  });

  test('in-memory cache enforces request-hash validation and rejects payload tampering for same clientRequestId', async () => {
    const mockClient = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        return {
          data: {
            sessionId: args.p_session_id,
            assistantMessageId: 'asst-msg-hash-test',
            nextStage: args.p_next_stage,
            nextMode: args.p_next_mode,
            message: 'Original answer',
            nextStep: args.p_next_stage,
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    const clientRequestId = `req-tamper-test-${Date.now()}`;

    // 1. Initial request cached in memory
    const initial = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-tamper-1',
        userMessage: 'Original valid prompt',
        assistantMessage: 'Original answer',
        nextStage: 'clarify_objective',
        nextMode: 'understand',
        expectedStage: 'describe_problem',
        expectedMode: 'understand',
        clientRequestId,
      },
      'user-tamper'
    );
    assert.strictEqual(initial.nextStage, 'clarify_objective');

    // 2. Attacker/Client reuses same clientRequestId with different userMessage content
    await assert.rejects(
      async () => {
        await repo.recordWorkflowStep(
          {
            sessionId: 'sess-tamper-1',
            userMessage: 'TAMPERED DIFFERENT PROMPT',
            assistantMessage: 'Original answer',
            nextStage: 'clarify_objective',
            nextMode: 'understand',
            expectedStage: 'describe_problem',
            expectedMode: 'understand',
            clientRequestId,
          },
          'user-tamper'
        );
      },
      (err: Error) => {
        return err.message.includes('Idempotency key reuse violation');
      },
      'Cache must reject payload hash mismatch instead of silently returning stale cached response'
    );
  });

  test('getIdempotencyRecord rejects legacy records with missing or empty request_hash when expectedRequestHash is supplied', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    response_payload: { message: 'Old unverified response', nextStep: 'explore' },
                    request_hash: '', // Legacy record with missing/empty hash
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    await assert.rejects(
      async () => {
        await repo.getIdempotencyRecord(
          'sess-old-hash',
          'user-1',
          'req-legacy-1',
          'expected-sha256-hash'
        );
      },
      (err: Error) => {
        return err.message.includes('Idempotency key reuse violation');
      },
      'Must reject records with empty request_hash when an expected hash is provided'
    );
  });

  test('getIdempotencyRecord throws on database query failure rather than silently treating as cache miss', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: null,
                  error: { message: 'Database connection terminated' },
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);

    await assert.rejects(
      async () => {
        await repo.getIdempotencyRecord(
          'sess-db-err',
          'user-1',
          'req-db-err',
          'expected-hash'
        );
      },
      (err: Error) => {
        return err.message.includes('Database failure looking up idempotency record');
      },
      'Must rethrow database errors rather than returning null'
    );
  });

  test('computeRequestHash produces collision-resistant SHA-256 and handles colons safely', () => {
    // Two distinct field distributions that would collide under naive colon concatenation "A:B:C"
    const hash1 = computeRequestHash({
      sessionId: 'sess-1',
      userMessage: 'A:B',
      selectedOptionId: 'C',
    });

    const hash2 = computeRequestHash({
      sessionId: 'sess-1',
      userMessage: 'A',
      selectedOptionId: 'B:C',
    });

    assert.notStrictEqual(hash1, hash2, 'Inputs with colons must not collide');
    assert.strictEqual(hash1.length, 64, 'Must be a 64-character SHA-256 hex string');
  });

  test('computeRequestHash includes userName and changes hash when userName differs', () => {
    const hashAlice = computeRequestHash({
      sessionId: 'sess-user-1',
      userMessage: 'Test prompt',
      userName: 'Alice',
    });

    const hashBob = computeRequestHash({
      sessionId: 'sess-user-1',
      userMessage: 'Test prompt',
      userName: 'Bob',
    });

    const hashEmptyUser = computeRequestHash({
      sessionId: 'sess-user-1',
      userMessage: 'Test prompt',
    });

    assert.notStrictEqual(hashAlice, hashBob, 'Different user names must yield different hashes');
    assert.notStrictEqual(hashAlice, hashEmptyUser, 'Provided userName must differ from omitted userName');
  });

  test('computeRequestHash produces distinct hash when mutating each semantically relevant field', () => {
    const baseline = {
      sessionId: 'sess-base-1',
      step: 'welcome',
      expectedStage: 'welcome' as const,
      expectedMode: 'understand' as const,
      userMessage: 'Base message',
      userName: 'Alice',
      selectedOptionId: 'opt-base-1',
      problemStatement: 'Base problem statement',
      clarifiedObjective: 'Base clarified objective',
      model: 'gemini-2.5-flash',
      nextStage: 'clarify_objective' as const,
      nextMode: 'understand' as const,
    };

    const baseHash = computeRequestHash(baseline);

    const mutations: Array<{ field: string; mutated: Parameters<typeof computeRequestHash>[0] }> = [
      { field: 'sessionId', mutated: { ...baseline, sessionId: 'sess-base-mutated' } },
      { field: 'step', mutated: { ...baseline, step: 'clarify_objective' } },
      { field: 'expectedMode', mutated: { ...baseline, expectedMode: 'explore' as const } },
      { field: 'userMessage', mutated: { ...baseline, userMessage: 'Mutated message' } },
      { field: 'userName', mutated: { ...baseline, userName: 'Bob' } },
      { field: 'selectedOptionId', mutated: { ...baseline, selectedOptionId: 'opt-mutated-2' } },
      { field: 'problemStatement', mutated: { ...baseline, problemStatement: 'Mutated statement' } },
      { field: 'clarifiedObjective', mutated: { ...baseline, clarifiedObjective: 'Mutated objective' } },
      { field: 'model', mutated: { ...baseline, model: 'gemini-2.5-pro' } },
      { field: 'nextStage', mutated: { ...baseline, nextStage: 'break_subproblems' as const } },
      { field: 'nextMode', mutated: { ...baseline, nextMode: 'explore' as const } },
    ];

    for (const { field, mutated } of mutations) {
      const mutatedHash = computeRequestHash(mutated);
      assert.notStrictEqual(
        mutatedHash,
        baseHash,
        `Mutating "${field}" must change the canonical SHA-256 request hash`
      );
    }
  });

  test('record_workflow_step_tx rejects legacy record with empty or missing hash when request_hash is provided', async () => {
    // Simulates the exact SQL logic in record_workflow_step_tx:
    // If an existing idempotency record is found under lock, but its stored request_hash is empty or NULL,
    // the transaction must reject with 'Idempotency key reuse violation' rather than returning unverified payload.
    const legacyRecords: Array<{ description: string; existingHash: string | null }> = [
      { description: 'empty string hash', existingHash: '' },
      { description: 'null hash', existingHash: null },
    ];

    for (const { description, existingHash } of legacyRecords) {
      const mockClient = {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          if (fn === 'record_workflow_step_tx') {
            const p_request_hash = args.p_request_hash as string | undefined;
            const v_existing_hash = existingHash;
            const v_existing_payload = { message: 'Legacy response', nextStep: 'explore' };

            if (args.p_client_request_id && v_existing_payload) {
              if (p_request_hash && p_request_hash !== '') {
                if (v_existing_hash === null || v_existing_hash === '' || p_request_hash !== v_existing_hash) {
                  return {
                    data: null,
                    error: {
                      message: `Idempotency key reuse violation: request_id "${args.p_client_request_id}" was previously used with different or unverified payload`,
                    },
                  };
                }
              }
              return { data: v_existing_payload, error: null };
            }
          }
          return { data: null, error: null };
        },
      } as unknown as SupabaseClient;

      const repo = new SupabaseThinkingRepository(mockClient);
      const clientRequestId = `req-legacy-rpc-${Date.now()}-${Math.random()}`;

      await assert.rejects(
        async () => {
          await repo.recordWorkflowStep(
            {
              sessionId: 'sess-legacy-1',
              userMessage: 'New prompt',
              assistantMessage: 'New answer',
              nextStage: 'clarify_objective',
              nextMode: 'understand',
              expectedStage: 'welcome',
              expectedMode: 'understand',
              clientRequestId,
            },
            'user-legacy-test'
          );
        },
        (err: Error) => {
          return err.message.includes('Idempotency key reuse violation') && err.message.includes('unverified payload');
        },
        `RPC must reject legacy record with ${description} when caller provides a verified payload hash`
      );
    }
  });

  test('record_workflow_step_tx rejects concurrent requests using same clientRequestId but different payloads', async () => {
    // Simulates two concurrent requests with same clientRequestId:
    // Request 1 commits with payload hash H1.
    // Request 2 arrives concurrently with payload hash H2.
    // RPC lock serializes them: Request 2 finds Request 1's record and rejects due to hash mismatch.
    let storedPayload: Record<string, unknown> | null = null;
    let storedHash: string | null = null;

    const mockClient = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'record_workflow_step_tx') {
          const p_request_hash = args.p_request_hash as string;
          if (args.p_client_request_id && storedPayload) {
            if (p_request_hash && p_request_hash !== '') {
              if (storedHash === null || storedHash === '' || p_request_hash !== storedHash) {
                return {
                  data: null,
                  error: {
                    message: `Idempotency key reuse violation: request_id "${args.p_client_request_id}" was previously used with different or unverified payload`,
                  },
                };
              }
            }
            return { data: { ...storedPayload, isIdempotentReplay: true }, error: null };
          }

          // First request sets the record
          storedPayload = {
            sessionId: args.p_session_id,
            assistantMessageId: 'asst-msg-tx-1',
            nextStage: args.p_next_stage,
            nextMode: args.p_next_mode,
            message: 'First request output',
            nextStep: args.p_next_stage,
          };
          storedHash = p_request_hash;

          return { data: storedPayload, error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;

    const repo = new SupabaseThinkingRepository(mockClient);
    const sharedRequestId = `req-concurrent-shared-${Date.now()}`;

    // Request 1 commits
    const req1 = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-conc-1',
        userMessage: 'Original question',
        assistantMessage: 'First request output',
        nextStage: 'clarify_objective',
        nextMode: 'understand',
        expectedStage: 'welcome',
        expectedMode: 'understand',
        clientRequestId: sharedRequestId,
      },
      'user-conc'
    );
    assert.strictEqual(req1.nextStage, 'clarify_objective');

    // Clear in-memory cache to force transaction RPC path
    SupabaseThinkingRepository.idempotencyCache.clear();

    // Request 2 uses same ID but different userMessage (producing different hash)
    await assert.rejects(
      async () => {
        await repo.recordWorkflowStep(
          {
            sessionId: 'sess-conc-1',
            userMessage: 'DIFFERENT concurrent question',
            assistantMessage: 'First request output',
            nextStage: 'clarify_objective',
            nextMode: 'understand',
            expectedStage: 'welcome',
            expectedMode: 'understand',
            clientRequestId: sharedRequestId,
          },
          'user-conc'
        );
      },
      (err: Error) => {
        return err.message.includes('Idempotency key reuse violation');
      },
      'RPC must reject concurrent request reusing ID with different payload'
    );
  });
});

describe('Service-Role Complete Cross-User Ownership & IDOR Audit', () => {
  interface DbState {
    sessions: Map<string, Record<string, unknown>>;
    messages: Map<string, Record<string, unknown>>;
    insights: Map<string, Record<string, unknown>>;
    idempotency: Map<string, Record<string, unknown>>;
  }

  function createStatefulClient(state: DbState): SupabaseClient {
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'record_workflow_step_tx') {
          const session = state.sessions.get(args.p_session_id as string);
          if (!session || session.user_id !== args.p_user_id) {
            return {
              data: null,
              error: { message: 'Forbidden: session not found or unauthorized' },
            };
          }
          return {
            data: {
              sessionId: args.p_session_id,
              assistantMessageId: 'asst-msg-tx',
              nextStage: args.p_next_stage,
              nextMode: args.p_next_mode,
            },
            error: null,
          };
        }
        if (fn === 'transition_workflow_mode_tx') {
          const session = state.sessions.get(args.p_session_id as string);
          if (!session || session.user_id !== args.p_user_id) {
            return {
              data: null,
              error: { message: 'Forbidden: session not found or unauthorized' },
            };
          }
          return {
            data: {
              sessionId: args.p_session_id,
              fromMode: args.p_expected_mode,
              toMode: args.p_to_mode,
              stage: 'describe_problem',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      from: (table: string) => {
        return {
          select: () => {
            const filters: Array<{ col: string; val: unknown }> = [];
            const queryObj = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
                return queryObj;
              },
              order: () => {
                let rows: Record<string, unknown>[] = [];
                if (table === 'thinking_sessions') {
                  rows = Array.from(state.sessions.values());
                } else if (table === 'session_messages') {
                  rows = Array.from(state.messages.values());
                } else if (table === 'session_insights') {
                  rows = Array.from(state.insights.values());
                }
                const filtered = rows.filter((r) =>
                  filters.every((f) => r[f.col] === f.val)
                );
                return { data: filtered, error: null };
              },
              maybeSingle: async () => {
                let rows: Record<string, unknown>[] = [];
                if (table === 'thinking_sessions') {
                  rows = Array.from(state.sessions.values());
                } else if (table === 'session_insights') {
                  rows = Array.from(state.insights.values());
                } else if (table === 'workflow_idempotency_keys') {
                  rows = Array.from(state.idempotency.values());
                }
                const found = rows.find((r) =>
                  filters.every((f) => r[f.col] === f.val)
                );
                return { data: found || null, error: null };
              },
            };
            return queryObj;
          },
          insert: (payload: Record<string, unknown>) => {
            const rowId = (payload.id as string) || `auto-${Date.now()}-${Math.random()}`;
            const rowWithId = { ...payload, id: rowId };
            if (table === 'thinking_sessions') {
              state.sessions.set(rowId, rowWithId);
            } else if (table === 'session_messages') {
              state.messages.set(rowId, rowWithId);
            } else if (table === 'session_insights') {
              state.insights.set(rowId, rowWithId);
            }
            return {
              select: () => ({
                single: async () => ({ data: rowWithId, error: null }),
              }),
              then: (resolve: (val: { data: unknown; error: null }) => void) =>
                resolve({ data: rowWithId, error: null }),
            };
          },
          update: (payload: Record<string, unknown>) => {
            const filters: Array<{ col: string; val: unknown }> = [];
            const queryObj = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
                return queryObj;
              },
              select: () => ({
                single: async () => {
                  let rows: Record<string, unknown>[] = [];
                  if (table === 'thinking_sessions') rows = Array.from(state.sessions.values());
                  if (table === 'session_insights') rows = Array.from(state.insights.values());
                  const found = rows.find((r) => filters.every((f) => r[f.col] === f.val));
                  if (found) {
                    Object.assign(found, payload);
                    return { data: found, error: null };
                  }
                  return { data: null, error: { message: 'Row not found for update' } };
                },
              }),
              then: (resolve: (val: { error: null }) => void) => {
                let rows: Record<string, unknown>[] = [];
                if (table === 'thinking_sessions') rows = Array.from(state.sessions.values());
                if (table === 'session_insights') rows = Array.from(state.insights.values());
                const found = rows.find((r) => filters.every((f) => r[f.col] === f.val));
                if (found) {
                  Object.assign(found, payload);
                }
                resolve({ error: null });
              },
            };
            return queryObj;
          },
          delete: () => {
            const filters: Array<{ col: string; val: unknown }> = [];
            const queryObj = {
              eq: (col: string, val: unknown) => {
                filters.push({ col, val });
                return queryObj;
              },
              then: (resolve: (val: { error: null }) => void) => {
                const checkAndDel = (map: Map<string, Record<string, unknown>>) => {
                  for (const [id, row] of Array.from(map.entries())) {
                    if (filters.every((f) => row[f.col] === f.val)) {
                      map.delete(id);
                    }
                  }
                };
                if (table === 'thinking_sessions') checkAndDel(state.sessions);
                if (table === 'session_messages') checkAndDel(state.messages);
                if (table === 'session_insights') checkAndDel(state.insights);
                resolve({ error: null });
              },
            };
            return queryObj;
          },
        };
      },
    } as unknown as SupabaseClient;
  }

  const VICTIM_USER = 'victim-user-0001';
  const ATTACKER_USER = 'attacker-user-9999';

  const VICTIM_SESSION_ID = '00000000-0000-0000-0000-000000000001';
  const VICTIM_MESSAGE_ID = '00000000-0000-0000-0000-000000000011';
  const VICTIM_INSIGHT_ID = '00000000-0000-0000-0000-000000000021';

  function initTestState(): DbState {
    const state: DbState = {
      sessions: new Map(),
      messages: new Map(),
      insights: new Map(),
      idempotency: new Map(),
    };

    state.sessions.set(VICTIM_SESSION_ID, {
      id: VICTIM_SESSION_ID,
      user_id: VICTIM_USER,
      title: 'Victim Confidential Dilemma',
      problem_statement: 'Private strategic strategy',
      current_mode: 'understand',
      current_stage: 'welcome',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    state.messages.set(VICTIM_MESSAGE_ID, {
      id: VICTIM_MESSAGE_ID,
      session_id: VICTIM_SESSION_ID,
      role: 'user',
      content: 'Victim secret thought',
      mode: 'understand',
      created_at: new Date().toISOString(),
    });

    state.insights.set(VICTIM_INSIGHT_ID, {
      id: VICTIM_INSIGHT_ID,
      session_id: VICTIM_SESSION_ID,
      category: 'goal',
      title: 'Victim Core Insight',
      content: 'Critical proprietary formula',
      status: 'accepted',
      metadata: { priority: 'high' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    state.idempotency.set(`${VICTIM_USER}:${VICTIM_SESSION_ID}:req-victim-init`, {
      user_id: VICTIM_USER,
      session_id: VICTIM_SESSION_ID,
      client_request_id: 'req-victim-init',
      request_hash: 'hash-victim-123',
      response_payload: {
        sessionId: VICTIM_SESSION_ID,
        assistantMessageId: 'asst-msg-secret',
        message: 'Victim secret AI response',
      },
    });

    return state;
  }

  test('Session Ownership: Attacker cannot read, list, update, or delete Victim session', async () => {
    const state = initTestState();
    const repo = new SupabaseThinkingRepository(createStatefulClient(state));

    // 1. Attacker listing sessions must NOT see victim session
    const attackerSessions = await repo.getSessions(ATTACKER_USER);
    assert.strictEqual(attackerSessions.length, 0, 'Attacker should not see any of victim sessions in getSessions');

    // 2. Attacker reading victim session by ID must throw Unauthorized
    await assert.rejects(
      async () => {
        await repo.getSession(VICTIM_SESSION_ID, ATTACKER_USER);
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );

    // 3. Attacker updating victim session must fail and leave victim session unchanged
    await assert.rejects(
      async () => {
        await repo.updateSession(
          VICTIM_SESSION_ID,
          { title: 'Attacker Hijacked Title', problemStatement: 'Pwned' },
          ATTACKER_USER
        );
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );
    const sessionInDb = state.sessions.get(VICTIM_SESSION_ID);
    assert.strictEqual(sessionInDb?.title, 'Victim Confidential Dilemma', 'Victim title must remain unchanged');
    assert.strictEqual(sessionInDb?.problem_statement, 'Private strategic strategy', 'Victim problem statement must remain unchanged');

    // 4. Attacker deleting victim session must fail and leave victim session intact in DB
    await assert.rejects(
      async () => {
        await repo.deleteSession(VICTIM_SESSION_ID, ATTACKER_USER);
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );
    assert.ok(state.sessions.has(VICTIM_SESSION_ID), 'Victim session must remain in DB after attacker delete attempt');

    // 5. Attacker calling deleteAllUserSessions must not delete victim sessions
    const deletedCount = await repo.deleteAllUserSessions(ATTACKER_USER);
    assert.strictEqual(deletedCount, 0);
    assert.ok(state.sessions.has(VICTIM_SESSION_ID), 'Victim session must remain intact after deleteAllUserSessions');
  });

  test('Message Ownership: Attacker cannot read or inject messages into Victim session', async () => {
    const state = initTestState();
    const repo = new SupabaseThinkingRepository(createStatefulClient(state));

    // 1. Attacker reading victim messages must fail
    await assert.rejects(
      async () => {
        await repo.getMessages(VICTIM_SESSION_ID, ATTACKER_USER);
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );

    // 2. Attacker inserting message into victim session must fail
    await assert.rejects(
      async () => {
        await repo.addMessage(
          {
            id: 'attacker-injected-msg-1',
            sessionId: VICTIM_SESSION_ID,
            role: 'user',
            content: 'Injected malicious prompt',
            mode: 'understand',
            createdAt: new Date().toISOString(),
          },
          ATTACKER_USER
        );
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );

    // Verify messages table has only victim's original message
    const allMessages = Array.from(state.messages.values());
    assert.strictEqual(allMessages.length, 1);
    assert.strictEqual(allMessages[0].id, VICTIM_MESSAGE_ID);
    assert.strictEqual(allMessages[0].content, 'Victim secret thought');
  });

  test('Insight Ownership: Attacker cannot read, insert, overwrite, reassign, or delete Victim insights', async () => {
    const state = initTestState();
    const repo = new SupabaseThinkingRepository(createStatefulClient(state));

    // 1. Attacker reading victim insights must fail
    await assert.rejects(
      async () => {
        await repo.getInsights(VICTIM_SESSION_ID, ATTACKER_USER);
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );

    // 2. Attacker inserting a new insight targeting victim's session must fail
    await assert.rejects(
      async () => {
        await repo.upsertInsight(
          {
            id: '00000000-0000-0000-0000-000000000099',
            sessionId: VICTIM_SESSION_ID,
            category: 'uncertainty',
            title: 'Injected Risk',
            content: 'Fake vulnerability',
            status: 'under_review',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ATTACKER_USER
        );
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );

    // 3. Attacker trying to overwrite victim's existing insight must fail
    await assert.rejects(
      async () => {
        await repo.upsertInsight(
          {
            id: VICTIM_INSIGHT_ID,
            sessionId: VICTIM_SESSION_ID,
            category: 'goal',
            title: 'Defaced Insight Title',
            content: 'Wiped content',
            status: 'rejected',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ATTACKER_USER
        );
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );
    const insightInDb = state.insights.get(VICTIM_INSIGHT_ID);
    assert.strictEqual(insightInDb?.title, 'Victim Core Insight', 'Victim insight title must remain unaltered');
    assert.strictEqual(insightInDb?.content, 'Critical proprietary formula', 'Victim insight content must remain unaltered');

    // 4. Cross-Session IDOR Reassignment: Attacker creates an attacker session, then tries to update insight passing victim's insight ID
    const attackerSessionId = '00000000-0000-0000-0000-000000000088';
    state.sessions.set(attackerSessionId, {
      id: attackerSessionId,
      user_id: ATTACKER_USER,
      title: 'Attacker Private Session',
      problem_statement: 'Attack setup',
      current_mode: 'understand',
      current_stage: 'welcome',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await assert.rejects(
      async () => {
        await repo.upsertInsight(
          {
            id: VICTIM_INSIGHT_ID,
            sessionId: attackerSessionId, // trying to steal or reassign victim's insight to attacker session
            category: 'option',
            title: 'Stolen Insight',
            content: 'Hijacked',
            status: 'accepted',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ATTACKER_USER
        );
      },
      { message: 'Security violation: Cannot reassign insight belonging to another session' }
    );
    // Verify victim's insight is still bound to VICTIM_SESSION_ID
    assert.strictEqual(state.insights.get(VICTIM_INSIGHT_ID)?.session_id, VICTIM_SESSION_ID);

    // 5. Attacker deleting victim's insight must fail
    await assert.rejects(
      async () => {
        await repo.deleteInsight(VICTIM_INSIGHT_ID, ATTACKER_USER);
      },
      { message: 'Unauthorized session access: ownership verification failed' }
    );
    assert.ok(state.insights.has(VICTIM_INSIGHT_ID), 'Victim insight must still exist in DB');
  });

  test('Workflow & Transition Ownership: Attacker cannot transition mode or record workflow step on Victim session', async () => {
    const state = initTestState();
    const repo = new SupabaseThinkingRepository(createStatefulClient(state));

    // 1. Attacker calling transitionMode on victim session must fail
    await assert.rejects(
      async () => {
        await repo.transitionMode(
          {
            sessionId: VICTIM_SESSION_ID,
            expectedMode: 'understand',
            toMode: 'explore',
          },
          ATTACKER_USER
        );
      },
      { message: 'Session not found or unauthorized' }
    );
    assert.strictEqual(state.sessions.get(VICTIM_SESSION_ID)?.current_mode, 'understand');

    // 2. Attacker calling recordWorkflowStep on victim session must fail
    await assert.rejects(
      async () => {
        await repo.recordWorkflowStep(
          {
            sessionId: VICTIM_SESSION_ID,
            userMessage: 'Attacker step prompt',
            assistantMessage: 'Attacker step answer',
            nextStage: 'clarify_objective',
            nextMode: 'understand',
            expectedStage: 'welcome',
            expectedMode: 'understand',
          },
          ATTACKER_USER
        );
      },
      { message: 'Session not found or unauthorized' }
    );
    assert.strictEqual(state.sessions.get(VICTIM_SESSION_ID)?.current_stage, 'welcome');
  });

  test('Idempotency Scoping: Attacker cannot read or leak Victim idempotency record', async () => {
    const state = initTestState();
    const repo = new SupabaseThinkingRepository(createStatefulClient(state));

    // Clear LRU cache before checking
    SupabaseThinkingRepository.idempotencyCache.clear();

    // Attacker queries victim's idempotency key
    const attackerLookup = await repo.getIdempotencyRecord(
      VICTIM_SESSION_ID,
      ATTACKER_USER,
      'req-victim-init',
      'hash-victim-123'
    );
    assert.strictEqual(attackerLookup, null, 'Attacker must not retrieve victim idempotency record');

    // Verify cache isolation: seed cache under victim user, attacker lookup must still return null
    SupabaseThinkingRepository.idempotencyCache.set(
      `${VICTIM_USER}:${VICTIM_SESSION_ID}:req-victim-init`,
      {
        result: {
          sessionId: VICTIM_SESSION_ID,
          assistantMessageId: 'asst-msg-secret',
          nextStage: 'clarify_objective',
          nextMode: 'understand',
        },
        requestHash: 'hash-victim-123',
      }
    );

    const attackerCacheLookup = await repo.getIdempotencyRecord(
      VICTIM_SESSION_ID,
      ATTACKER_USER,
      'req-victim-init',
      'hash-victim-123'
    );
    assert.strictEqual(attackerCacheLookup, null, 'Cache key isolation must prevent attacker retrieving victim cached entry');
  });
});

