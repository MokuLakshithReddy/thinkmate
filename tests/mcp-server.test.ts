import { describe, it } from 'node:test';
import assert from 'node:assert';
import { app, buildServer, isOriginAllowed, validateMcpConfig } from '../mcp-server/index';
import type { Server } from 'node:http';

describe('Layer 5: MCP Server Security and Protocol Tests', () => {
  describe('Origin Policy Matrix & Security Safeguards', () => {
    it('allows requests without an Origin header (Claude Desktop, Cursor, CLI clients)', () => {
      assert.strictEqual(isOriginAllowed(undefined, [], true), true);
      assert.strictEqual(isOriginAllowed(undefined, ['https://app.thinkmate.dev'], true), true);
      assert.strictEqual(isOriginAllowed(undefined, [], false), true);
    });

    it('enforces explicit allowlist when configured', () => {
      const allowed = ['https://app.thinkmate.dev', 'https://staging.thinkmate.dev'];
      assert.strictEqual(isOriginAllowed('https://app.thinkmate.dev', allowed, true), true);
      assert.strictEqual(isOriginAllowed('https://staging.thinkmate.dev', allowed, true), true);
      assert.strictEqual(isOriginAllowed('https://malicious-site.com', allowed, true), false);
    });

    it('fails closed in production when no allowlist is configured', () => {
      assert.strictEqual(isOriginAllowed('https://app.thinkmate.dev', [], true), false);
      assert.strictEqual(isOriginAllowed('https://evil.com', [], true), false);
    });

    it('permits localhost origins in development mode when allowlist is empty', () => {
      assert.strictEqual(isOriginAllowed('http://localhost:3000', [], false), true);
      assert.strictEqual(isOriginAllowed('http://127.0.0.1:3000', [], false), true);
      assert.strictEqual(isOriginAllowed('https://untrusted-web-app.com', [], false), false);
    });
  });

  describe('Configuration Validation', () => {
    it('detects missing database and anon key configurations', () => {
      const emptyEnv = {} as any;
      const res = validateMcpConfig(emptyEnv);
      assert.strictEqual(res.valid, false);
      assert.ok(res.issues.some((i) => i.includes('NEXT_PUBLIC_SUPABASE_URL')));
      assert.ok(res.issues.some((i) => i.includes('NEXT_PUBLIC_SUPABASE_ANON_KEY')));
    });

    it('requires ALLOWED_ORIGINS in production mode', () => {
      const prodEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-123',
        NODE_ENV: 'production',
      } as any;
      const res = validateMcpConfig(prodEnv);
      assert.strictEqual(res.valid, false);
      assert.ok(res.issues.some((i) => i.includes('ALLOWED_ORIGINS')));
    });

    it('passes when all required variables are present in production', () => {
      const validProdEnv = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://demo.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-123',
        ALLOWED_ORIGINS: 'https://app.thinkmate.dev',
        NODE_ENV: 'production',
      } as any;
      const res = validateMcpConfig(validProdEnv);
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.issues.length, 0);
    });
  });

  describe('HTTP Transport & Middleware', () => {
    it('rejects requests with missing token (HTTP 401)', async () => {
      const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });

        assert.strictEqual(res.status, 401);
        const json = await res.json();
        assert.strictEqual(json.error, 'missing_token');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('rejects HTTP GET on /mcp (HTTP 405 Method Not Allowed)', async () => {
      const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`);
        assert.strictEqual(res.status, 405);
        const json = await res.json();
        assert.strictEqual(json.error, 'method_not_allowed');
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('returns sanitized internal error with correlation ID on unhandled exception in /mcp', async () => {
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://[::1]:namedport'; // triggers malformed URL exception in URL parsing
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';

      const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      const port = (server.address() as any).port;

      try {
        const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-bearer-token',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });

        assert.strictEqual(res.status, 500);
        const json = await res.json();
        assert.strictEqual(json.jsonrpc, '2.0');
        assert.strictEqual(json.error.code, -32603);
        assert.ok(json.error.message.includes('Internal server error (ref: '));
        assert.strictEqual(json.error.message.includes('namedport'), false);
      } finally {
        if (origUrl !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
        else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (origAnon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = origAnon;
        else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('MCP Tool Registration & Discovery', () => {
    it('registers all 6 required tools including execute_thinking_turn', () => {
      const mockSb = {
        from: () => ({
          select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const tools = (server as any)._registeredTools;
      const toolNames = Object.keys(tools);

      assert.ok(toolNames.includes('list_thinking_workspaces'));
      assert.ok(toolNames.includes('create_thinking_workspace'));
      assert.ok(toolNames.includes('get_thinking_context'));
      assert.ok(toolNames.includes('propose_thinking_update'));
      assert.ok(toolNames.includes('list_open_questions'));
      assert.ok(toolNames.includes('execute_thinking_turn'));
    });
  });

  describe('Database Failure Safety in MCP Tools', () => {
    it('list_thinking_workspaces returns sanitized public error code on database query failure', async () => {
      const mockSb = {
        from: () => ({
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
            }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['list_thinking_workspaces'].handler;
      const result = await handler({});

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('list_workspaces_failed'));
      assert.ok(result.content[0].text.includes('(ref: '));
      assert.strictEqual(result.content[0].text.includes('connection refused'), false);
    });

    it('create_thinking_workspace returns sanitized public error code when workspace insert fails', async () => {
      const mockSb = {
        from: () => ({
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: { message: 'disk full' } }),
            }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['create_thinking_workspace'].handler;
      const result = await handler({ title: 'Cache Latency' });

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('create_workspace_failed'));
      assert.ok(result.content[0].text.includes('(ref: '));
      assert.strictEqual(result.content[0].text.includes('disk full'), false);
    });

    it('propose_thinking_update returns sanitized public error code when problem frame update fails', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: validWsId }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: { message: 'foreign key constraint violation' } }),
          }),
          insert: () => Promise.resolve({ error: null }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['propose_thinking_update'].handler;
      const result = await handler({
        workspace_id: validWsId,
        problem_frame: 'Updated problem frame for validation',
        items: [],
      });

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('propose_update_failed'));
      assert.ok(result.content[0].text.includes('(ref: '));
      assert.strictEqual(result.content[0].text.includes('foreign key constraint violation'), false);
    });

    it('propose_thinking_update returns sanitized public error code when item insert fails', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => {
          if (table === 'tm_items') {
            return {
              insert: () => ({
                select: () => Promise.resolve({ data: null, error: { message: 'unique violation' } }),
              }),
              delete: () => ({
                eq: () => Promise.resolve({ error: null }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: validWsId }, error: null }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            insert: () => Promise.resolve({ error: null }),
            delete: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        },
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['propose_thinking_update'].handler;
      const result = await handler({
        workspace_id: validWsId,
        problem_frame: undefined,
        items: [{ kind: 'idea', text: 'Use bloom filter' }],
      });

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('propose_update_failed'));
      assert.ok(result.content[0].text.includes('(ref: '));
      assert.strictEqual(result.content[0].text.includes('unique violation'), false);
    });

    it('propose_thinking_update reports sanitized public error code when event logging fails', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => {
          if (table === 'tm_events') {
            return {
              insert: () => Promise.resolve({ error: { message: 'audit table readonly' } }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: { id: validWsId }, error: null }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
            insert: () => Promise.resolve({ error: null }),
            delete: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        },
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['propose_thinking_update'].handler;
      const result = await handler({
        workspace_id: validWsId,
        problem_frame: 'Valid problem frame description',
        items: [],
      });

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('propose_update_failed'));
      assert.ok(result.content[0].text.includes('(ref: '));
      assert.strictEqual(result.content[0].text.includes('audit table readonly'), false);
    });

    it('propose_thinking_update reports success only when all writes succeed', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const makeInsert = () => {
        const p = Promise.resolve({ error: null, data: [{ id: 'item-1' }] });
        return Object.assign(p, {
          select: () => Promise.resolve({ data: [{ id: 'item-1' }], error: null }),
        });
      };
      const mockSb = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: validWsId }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
          insert: makeInsert,
          delete: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['propose_thinking_update'].handler;
      const result = await handler({
        workspace_id: validWsId,
        problem_frame: 'Valid problem frame description',
        items: [{ kind: 'claim', text: 'Network saturates during peak hours' }],
      });

      assert.strictEqual(result.isError, undefined);
      assert.ok(result.content[0].text.includes('Proposed. Nothing is confirmed until the user reviews it'));
    });
  });

  describe('execute_thinking_turn Reasoning Tool', () => {
    it('fails closed in production when tm_reserve_turn_quota fails, without bypassing via fallback', async () => {
      const origEnv = process.env.NODE_ENV;
      const origFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
      (process.env as any).NODE_ENV = 'production';
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false';
      let fallbackCalled = false;
      try {
        const validWsId = 'a0000000-0000-0000-0000-000000000001';
        const mockSb = {
          rpc: async (fn: string) => {
            if (fn === 'tm_reserve_turn_quota_for_plan' || fn === 'tm_reserve_turn_quota') {
              return { data: null, error: { message: 'RPC service unavailable' } };
            }
            if (fn === 'tm_turns_last_day') {
              fallbackCalled = true;
              return { data: 5, error: null };
            }
            return { data: null, error: null };
          },
        } as any;

        const server = buildServer(mockSb, 'prod-user-1');
        const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;
        const result = await handler({
          workspace_id: validWsId,
          message: 'Can you help?',
        });

        assert.strictEqual(result.isError, true);
        assert.ok(result.content[0].text.includes('quota_service_unavailable'));
        assert.strictEqual(fallbackCalled, false, 'Production must never fall back to tm_turns_last_day on reservation failure');
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origFailClosed !== undefined) process.env.RATE_LIMIT_FAIL_CLOSED = origFailClosed;
        else delete process.env.RATE_LIMIT_FAIL_CLOSED;
      }
    });

    it('falls back to tm_turns_last_day in non-production only when tm_reserve_turn_quota is confirmed missing', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      let fallbackCalls = 0;
      const mockSbMissing = {
        rpc: async (fn: string) => {
          if (fn === 'tm_reserve_turn_quota_for_plan' || fn === 'tm_reserve_turn_quota') {
            return { data: null, error: { code: 'PGRST202', message: 'Could not find the function tm_reserve_turn_quota' } };
          }
          if (fn === 'tm_turns_last_day') {
            fallbackCalls++;
            return { data: 300, error: null };
          }
          return { data: null, error: null };
        },
      } as any;

      const serverMissing = buildServer(mockSbMissing, 'dev-user-missing');
      const handlerMissing = (serverMissing as any)._registeredTools['execute_thinking_turn'].handler;
      const resultMissing = await handlerMissing({ workspace_id: validWsId, message: 'Test missing' });
      assert.strictEqual(resultMissing.isError, true);
      assert.ok(resultMissing.content[0].text.includes('daily_cap'));
      assert.strictEqual(fallbackCalls, 1);

      // Other non-missing errors in non-production must NOT fall back
      const mockSbOtherErr = {
        rpc: async (fn: string) => {
          if (fn === 'tm_reserve_turn_quota_for_plan' || fn === 'tm_reserve_turn_quota') {
            return { data: null, error: { message: 'deadlock detected' } };
          }
          if (fn === 'tm_turns_last_day') {
            fallbackCalls++;
            return { data: 0, error: null };
          }
          return { data: null, error: null };
        },
      } as any;

      const serverOther = buildServer(mockSbOtherErr, 'dev-user-other');
      const handlerOther = (serverOther as any)._registeredTools['execute_thinking_turn'].handler;
      const resultOther = await handlerOther({ workspace_id: validWsId, message: 'Test other err' });
      assert.strictEqual(resultOther.isError, true);
      assert.ok(resultOther.content[0].text.includes('quota_service_unavailable'));
      assert.strictEqual(fallbackCalls, 1, 'Non-missing RPC errors must not trigger fallback');
    });

    it('returns stable error codes in production without leaking safeErr internals on model failure', async () => {
      const origEnv = process.env.NODE_ENV;
      const origFailClosed = process.env.RATE_LIMIT_FAIL_CLOSED;
      (process.env as any).NODE_ENV = 'production';
      process.env.RATE_LIMIT_FAIL_CLOSED = 'false';
      try {
        const validWsId = 'a0000000-0000-0000-0000-000000000001';
        const mockWs = { id: validWsId, title: 'Test', stage: 'orient', problem_frame_confirmed: true };
        const mockSb = {
          rpc: async () => ({ data: { allowed: true }, error: null }),
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: mockWs, error: null }),
                order: () => Promise.resolve({ data: [], error: null }),
              }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
            insert: () => Promise.resolve({ error: null }),
          }),
        } as any;

        const failingRunner = async () => {
          throw new Error('Google Gemini internal quota exceeded [sensitive-raw-api-key]');
        };

        const server = buildServer(mockSb, 'prod-user-2', failingRunner as any);
        const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;
        const result = await handler({
          workspace_id: validWsId,
          message: 'Can you help?',
        });

        assert.strictEqual(result.isError, true);
        assert.ok(result.content[0].text.includes('model_failed'));
        assert.ok(result.content[0].text.includes('(ref: '));
        assert.strictEqual(result.content[0].text.includes('sensitive-raw-api-key'), false);
      } finally {
        (process.env as any).NODE_ENV = origEnv;
        if (origFailClosed !== undefined) process.env.RATE_LIMIT_FAIL_CLOSED = origFailClosed;
        else delete process.env.RATE_LIMIT_FAIL_CLOSED;
      }
    });

    it('returns tool error when workspace is not found', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;
      const result = await handler({
        workspace_id: validWsId,
        message: 'How should we handle caching?',
      });

      assert.strictEqual(result.isError, true);
      assert.ok(result.content[0].text.includes('Workspace not found or access denied.'));
    });

    it('replays response idempotently for duplicate client_msg_id', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const clientMsgId = 'b0000000-0000-0000-0000-000000000002';
      const mockWs = { id: validWsId, title: 'Cache Strategy', stage: 'orient', problem_frame_confirmed: true };
      const mockMessages = [
        { id: 'm1', seq: 1, role: 'user', content: 'What about Redis?', client_msg_id: clientMsgId },
        { id: 'm2', seq: 2, role: 'assistant', content: 'Redis provides sub-millisecond lookups.' },
      ];

      const mockSb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockWs, error: null }),
              order: () => Promise.resolve({ data: table === 'tm_messages' ? mockMessages : [], error: null }),
            }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;
      const result = await handler({
        workspace_id: validWsId,
        message: 'What about Redis?',
        client_msg_id: clientMsgId,
      });

      assert.strictEqual(result.isError, undefined);
      assert.ok(result.content[0].text.includes('[IDEMPOTENT REPLAY]'));
      assert.ok(result.content[0].text.includes('Redis provides sub-millisecond lookups.'));
    });

    it('replays the specific assistant response paired to client_msg_id even when later turns completed', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const clientMsgId = 'b0000000-0000-0000-0000-000000000002';
      const mockWs = { id: validWsId, title: 'Cache Strategy', stage: 'orient', problem_frame_confirmed: true };
      const mockMessages = [
        { id: 'm1', seq: 1, role: 'user', content: 'What about Redis?', client_msg_id: clientMsgId },
        { id: 'm2', seq: 2, role: 'assistant', content: 'Specific Redis response.' },
        { id: 'm3', seq: 3, role: 'user', content: 'What about Memcached?' },
        { id: 'm4', seq: 4, role: 'assistant', content: 'Latest Memcached response.' },
      ];

      const mockSb = {
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockWs, error: null }),
              order: () => Promise.resolve({ data: table === 'tm_messages' ? mockMessages : [], error: null }),
            }),
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      } as any;

      const server = buildServer(mockSb, 'user-123');
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;
      const result = await handler({
        workspace_id: validWsId,
        message: 'What about Redis?',
        client_msg_id: clientMsgId,
      });

      assert.strictEqual(result.isError, undefined);
      assert.ok(result.content[0].text.includes('[IDEMPOTENT REPLAY]'));
      assert.ok(result.content[0].text.includes('Specific Redis response.'));
      assert.strictEqual(result.content[0].text.includes('Latest Memcached response.'), false);
    });

    it('handles concurrent duplicate requests safely, returning the original stored response to both', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const clientMsgId = 'c0000000-0000-0000-0000-000000000003';
      const mockWs = { id: validWsId, title: 'Concurrency Test', stage: 'orient', problem_frame_confirmed: true };

      let rpcCallCount = 0;
      const seenMsgIds = new Set<string>();

      const mockSb = {
        rpc: async (fnName: string, params: any) => {
          assert.strictEqual(fnName, 'tm_apply_turn_tx');
          rpcCallCount++;
          if (seenMsgIds.has(params.p_client_msg_id)) {
            // Concurrent duplicate: return original stored assistant reply
            return {
              data: {
                idempotent_replay: true,
                assistant_reply: 'Canonical stored response from request 1.',
                user_message_id: 'u1',
                assistant_message_id: 'a1',
              },
              error: null,
            };
          }
          seenMsgIds.add(params.p_client_msg_id);
          return {
            data: {
              idempotent_replay: false,
              assistant_reply: 'Canonical stored response from request 1.',
              user_message_id: 'u1',
              assistant_message_id: 'a1',
            },
            error: null,
          };
        },
        from: (table: string) => ({
          select: () => ({
            eq: () => {
              const res = Promise.resolve({ data: table === 'tm_workspaces' ? mockWs : [], error: null });
              return Object.assign(res, {
                maybeSingle: () => Promise.resolve({ data: mockWs, error: null }),
                order: () => Promise.resolve({ data: [], error: null }),
              });
            },
          }),
        }),
      } as any;

      let turnCallCount = 0;
      const mockRunner = async () => {
        turnCallCount++;
        return {
          output: {
            reply: `Divergent local generation #${turnCallCount}`,
            guidance_mode: 'hint' as const,
            proposed_problem_frame: null,
            proposed_items: [],
          },
          tokens: 40,
        };
      };

      const server = buildServer(mockSb, 'user-123', mockRunner as any);
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;

      // Simulate 2 concurrent requests with identical client_msg_id
      const [res1, res2] = await Promise.all([
        handler({
          workspace_id: validWsId,
          message: 'How do we handle replication lag?',
          client_msg_id: clientMsgId,
        }),
        handler({
          workspace_id: validWsId,
          message: 'How do we handle replication lag?',
          client_msg_id: clientMsgId,
        }),
      ]);

      assert.strictEqual(res1.isError, undefined);
      assert.strictEqual(res2.isError, undefined);
      assert.strictEqual(rpcCallCount, 2);

      // Both requests must return the canonical response from request 1
      assert.ok(res1.content[0].text.includes('Canonical stored response from request 1.'));
      assert.ok(res2.content[0].text.includes('Canonical stored response from request 1.'));

      // The second concurrent request is identified as an idempotent replay
      assert.ok(res2.content[0].text.includes('[IDEMPOTENT REPLAY]'));
    });

    it('enforces atomic quota reservation under concurrency at the daily limit boundary across different workspaces', async () => {
      const validWsIdA = 'a0000000-0000-0000-0000-000000000001';
      const validWsIdB = 'a0000000-0000-0000-0000-000000000002';
      const mockWsA = { id: validWsIdA, title: 'Workspace A', stage: 'orient', problem_frame_confirmed: true };
      const mockWsB = { id: validWsIdB, title: 'Workspace B', stage: 'orient', problem_frame_confirmed: true };

      // Simulate user-level quota serialization where only 1 slot remains before hitting the daily quota
      let currentCount = 299;
      const mockSb = {
        rpc: async (fnName: string, params: any) => {
          if (fnName === 'tm_reserve_turn_quota_for_plan' || fnName === 'tm_reserve_turn_quota') {
            const limit = params?.p_daily_limit ?? 300;
            if (currentCount >= limit) {
              return { data: { allowed: false, used: currentCount, limit }, error: null };
            }
            currentCount++;
            return { data: { allowed: true, reservation_id: 'res-1', used: currentCount, limit }, error: null };
          }
          if (fnName === 'tm_apply_turn_tx') {
            return {
              data: {
                idempotent_replay: false,
                assistant_reply: 'Processed successfully.',
                user_message_id: 'u1',
                assistant_message_id: 'a1',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        from: (table: string) => ({
          select: () => ({
            eq: (_col: string, val: string) => {
              const ws = val === validWsIdA ? mockWsA : mockWsB;
              const res = Promise.resolve({ data: table === 'tm_workspaces' ? ws : [], error: null });
              return Object.assign(res, {
                maybeSingle: () => Promise.resolve({ data: ws, error: null }),
                order: () => Promise.resolve({ data: [], error: null }),
              });
            },
          }),
        }),
      } as any;

      const mockRunner = async () => ({
        output: {
          reply: 'Success within quota.',
          guidance_mode: 'hint' as const,
          proposed_problem_frame: null,
          proposed_items: [],
        },
        tokens: 30,
      });

      const server = buildServer(mockSb, 'quota-boundary-user', mockRunner as any);
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;

      // Launch 2 concurrent turns against two DIFFERENT workspaces of the same user when only 1 slot is remaining
      const [res1, res2] = await Promise.all([
        handler({ workspace_id: validWsIdA, message: 'Turn in Workspace A' }),
        handler({ workspace_id: validWsIdB, message: 'Turn in Workspace B' }),
      ]);

      const successes = [res1, res2].filter((r) => !r.isError);
      const rejections = [res1, res2].filter((r) => r.isError && r.content[0].text.includes('daily_cap'));

      // Even across different workspaces, user-level quota serialization strictly allows only 1 request
      assert.strictEqual(successes.length, 1);
      assert.strictEqual(rejections.length, 1);
    });

    it('enforces user-scoped distributed rate limiting on execute_thinking_turn', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockWs = { id: validWsId, title: 'Burst Test', stage: 'orient', problem_frame_confirmed: true };
      const mockSb = {
        rpc: async () => ({
          data: {
            allowed: true,
            idempotent_replay: false,
            assistant_reply: 'ok',
            user_message_id: 'u',
            assistant_message_id: 'a',
          },
          error: null,
        }),
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: mockWs, error: null }),
              order: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        }),
      } as any;

      const mockRunner = async () => ({
        output: {
          reply: 'ok',
          guidance_mode: 'hint' as const,
          proposed_problem_frame: null,
          proposed_items: [],
        },
        tokens: 10,
      });

      const server = buildServer(mockSb, 'burst-user-id', mockRunner as any);
      const handler = (server as any)._registeredTools['execute_thinking_turn'].handler;

      // Consume user turns up to limit (20 per min)
      const results = [];
      for (let i = 0; i < 21; i++) {
        results.push(await handler({ workspace_id: validWsId, message: `Burst test msg ${i}` }));
      }

      // The 21st request should be rejected by user-scoped distributed limiter
      const last = results[20];
      assert.strictEqual(last.isError, true);
      assert.ok(last.content[0].text.includes('rate_limit_exceeded'));
    });
  });

  describe('MCP Startup Configuration Validation', () => {
    it('startMcpServer executes validation and aborts before listening on invalid configuration', async () => {
      const { startMcpServer } = await import('../mcp-server/index');
      const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const origExit = process.exit;
      let exitCode: number | null = null;
      try {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        (process as any).exit = (code: number) => {
          exitCode = code;
          throw new Error(`process.exit called with ${code}`);
        };

        assert.throws(
          () => {
            startMcpServer(9999);
          },
          /process.exit called with 1/
        );
        assert.strictEqual(exitCode, 1);
      } finally {
        process.exit = origExit;
        if (origUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
      }
    });
  });
});

