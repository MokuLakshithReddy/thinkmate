import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SupabaseThinkingRepository } from './repository';
import { ThinkingSession } from '@/types';

describe('Persistence, Security & Ownership Verification', () => {
  test('IDOR Protection: throws when accessing session belonging to another user', async () => {
    const repo = new SupabaseThinkingRepository();

    // Mock getSession call simulating foreign user
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

    // Override client get method for hermetic test
    (repo as unknown as { client: unknown }).client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: foreignSession.id,
                user_id: foreignSession.userId,
                title: foreignSession.title,
                problem_statement: foreignSession.problemStatement,
                current_mode: foreignSession.currentMode,
                status: foreignSession.status,
              },
              error: null,
            }),
          }),
        }),
      }),
    };

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

  test('Session update enforces ownership validation before applying modifications', async () => {
    const repo = new SupabaseThinkingRepository();

    (repo as unknown as { getSession: unknown }).getSession = async (
      id: string,
      userId?: string
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
    const repo = new SupabaseThinkingRepository();

    (repo as unknown as { getSession: unknown }).getSession = async (
      id: string,
      userId?: string
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
