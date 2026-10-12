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
});
