import { describe, it } from 'node:test';
import assert from 'node:assert';
import { app } from '../mcp-server/index';
import type { Server } from 'node:http';

describe('Layer 5: MCP Server Security and Protocol Tests', () => {
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
