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
    it('list_thinking_workspaces returns tool error on database query failure', async () => {
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
      assert.ok(result.content[0].text.includes('Failed to list workspaces: connection refused'));
    });

    it('create_thinking_workspace returns tool error when workspace insert fails', async () => {
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
      assert.ok(result.content[0].text.includes('Could not create the workspace: disk full'));
    });

    it('propose_thinking_update returns tool error when problem frame update fails', async () => {
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
      assert.ok(result.content[0].text.includes('Failed to update problem frame: foreign key constraint violation'));
    });

    it('propose_thinking_update returns tool error when item insert fails', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
      const mockSb = {
        from: (table: string) => {
          if (table === 'tm_items') {
            return {
              insert: () => Promise.resolve({ error: { message: 'unique violation' } }),
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
      assert.ok(result.content[0].text.includes('Failed to insert proposed items: unique violation'));
    });

    it('propose_thinking_update reports failure when event logging fails', async () => {
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
      assert.ok(result.content[0].text.includes('Failed to log audit event: audit table readonly'));
    });

    it('propose_thinking_update reports success only when all writes succeed', async () => {
      const validWsId = 'a0000000-0000-0000-0000-000000000001';
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
          insert: () => Promise.resolve({ error: null }),
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
  });
});
