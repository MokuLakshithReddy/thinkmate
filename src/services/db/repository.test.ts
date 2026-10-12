import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SupabaseThinkingRepository } from './repository';
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
        clientRequestId,
      },
      'user-idem'
    );

    assert.strictEqual(firstCall.sessionId, 'sess-idem');

    // Second call with same clientRequestId must return cached result
    const secondCall = await repo.recordWorkflowStep(
      {
        sessionId: 'sess-idem',
        userMessage: 'Test prompt duplicate',
        assistantMessage: 'Test response duplicate',
        nextStage: 'clarify_objective',
        nextMode: 'understand',
        clientRequestId,
      },
      'user-idem'
    );

    assert.deepStrictEqual(firstCall, secondCall);
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
});
