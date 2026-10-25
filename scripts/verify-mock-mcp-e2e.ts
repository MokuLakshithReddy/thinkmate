const SUPABASE_URL = (process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ffjgbefnubyjzrlvpdkl.supabase.co').trim();
const ANON_KEY = (process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_KEY = (process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!ANON_KEY || !SERVICE_KEY) {
  throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY');
}

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';

import { createClient } from '@supabase/supabase-js';
import { startMcpServer } from '../mcp-server/index';
import { loadState } from '../src/lib/thinkmate/state';
import type { Server } from 'http';

async function testMockedMcpEndToEnd() {
  console.log('=== Deterministic Mocked External MCP Client E2E Verification ===');

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Provision staging test user
  const nonce = Date.now();
  const email = `mock-mcp-user-${nonce}@thinkmate.dev`;
  const pass = `MockSecret_${nonce}!`;

  console.log('[Step 1] Provisioning real staging test user...');
  const { data: uData, error: uErr } = await adminClient.auth.admin.createUser({
    email,
    password: pass,
    email_confirm: true,
  });
  if (uErr) throw new Error(`User creation failed: ${uErr.message}`);
  const userId = uData.user.id;
  console.log(`✓ Staging user created: ${userId}`);

  // 2. Sign in to obtain real Bearer JWT
  console.log('[Step 2] Authenticating user to obtain JWT...');
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authErr } = await userClient.auth.signInWithPassword({
    email,
    password: pass,
  });
  if (authErr || !authData.session) throw new Error(`Login failed: ${authErr?.message}`);
  const jwt = authData.session.access_token;
  console.log(`✓ Bearer token acquired (length: ${jwt.length})`);

  let wsId: string | null = null;
  let server: Server | null = null;

  try {
    // 3. Create a test workspace on staging
    console.log('[Step 3] Creating test workspace on staging database...');
    const { data: wsData, error: wsErr } = await userClient
      .from('tm_workspaces')
      .insert({ owner_id: userId, title: `Mocked MCP E2E Workspace ${nonce}` })
      .select('id')
      .single();

    if (wsErr) throw new Error(`Workspace creation failed: ${wsErr.message}`);
    wsId = wsData.id;
    console.log(`✓ Test workspace created: ${wsId}`);

    // 4. Start MCP Server with explicitly mocked deterministic runner
    console.log('[Step 4] Starting ThinkMate MCP server on port 3339...');
    console.log('  AI Execution Mode: [EXPLICITLY MOCKED TEST RUNNER]');

    const deterministicMockOutput = {
      reply: `DETERMINISTIC_MOCK_REASONING_REPLY_${nonce}: Partition data by customer organization ID using consistent hashing.`,
      guidance_mode: 'hint' as const,
      proposed_problem_frame: `Consistent hashing multi-region architecture (${nonce})`,
      proposed_items: [
        {
          kind: 'idea' as const,
          text: `Consistent hashing ring partitioning for customer organizations (${nonce})`,
          origin: 'ai' as const,
        },
        {
          kind: 'claim' as const,
          text: `Hash rings minimize key remapping to K/N during cluster expansion (${nonce})`,
          origin: 'ai' as const,
        },
      ],
    };

    const mockRunner = async () => {
      return {
        output: deterministicMockOutput,
        tokens: 140,
      };
    };

    server = startMcpServer(3339, mockRunner as any);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('✓ MCP server is listening on port 3339 with mocked runner.');

    // 5. Connect as a real external MCP client over HTTP
    console.log('\n[Step 5] External MCP client executing execute_thinking_turn via HTTP POST /mcp...');
    const clientMsgId = crypto.randomUUID();
    const question = 'How should we partition user data across clusters?';

    const mcpPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'execute_thinking_turn',
        arguments: {
          workspace_id: wsId,
          message: question,
          client_msg_id: clientMsgId,
        },
      },
    };

    const mcpRes = await fetch('http://localhost:3339/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(mcpPayload),
    });

    if (!mcpRes.ok) {
      throw new Error(`MCP HTTP request failed with status ${mcpRes.status}: ${await mcpRes.text()}`);
    }

    const rawText = await mcpRes.text();
    let mcpJson: any;
    try {
      mcpJson = JSON.parse(rawText);
    } catch {
      const dataLine = rawText.split('\n').find((l) => l.startsWith('data: '));
      if (dataLine) {
        mcpJson = JSON.parse(dataLine.slice(6));
      } else {
        throw new Error(`Could not parse MCP response: ${rawText}`);
      }
    }

    if (mcpJson.error) {
      throw new Error(`MCP tool execution returned error: ${JSON.stringify(mcpJson.error)}`);
    }

    const contentText = mcpJson.result?.content?.[0]?.text;
    if (!contentText || !contentText.includes(deterministicMockOutput.reply)) {
      throw new Error(`MCP response does not contain expected mocked reply: ${contentText}`);
    }
    console.log('✓ External MCP request succeeded with deterministic mock output.');

    // 6. Direct Staging Database Verification
    console.log('\n[Step 6] Verifying deterministic mock persistence in staging database...');
    const { data: messages, error: mErr } = await adminClient
      .from('tm_messages')
      .select('seq, role, content')
      .eq('workspace_id', wsId)
      .order('seq');

    if (mErr) throw new Error(`Failed to load messages from staging: ${mErr.message}`);
    const persistedAssistant = messages.find((m) => m.role === 'assistant');
    if (!persistedAssistant || persistedAssistant.content !== deterministicMockOutput.reply) {
      throw new Error('Persisted assistant message does not match deterministic mock output!');
    }
    console.log('✓ Mock output verified in tm_messages.');

    const { data: items, error: iErr } = await adminClient
      .from('tm_items')
      .select('kind, text')
      .eq('workspace_id', wsId);

    if (iErr) throw new Error(`Failed to load items: ${iErr.message}`);
    if (items.length !== deterministicMockOutput.proposed_items.length) {
      throw new Error(`Expected ${deterministicMockOutput.proposed_items.length} items, found ${items.length}`);
    }
    console.log('✓ Proposed items verified in tm_items.');

    // 7. Verify loadState matches persisted state
    console.log('\n[Step 7] Verifying workspace reload via loadState()...');
    const state = await loadState(userClient, wsId!);
    if (!state) throw new Error('loadState returned null for persisted workspace!');
    console.log(`✓ Workspace reloaded cleanly: ${state.ws.title}`);

    // 8. Replaying the same request ID returns the original result
    console.log('\n[Step 8] Replaying the same client_msg_id to verify idempotent replay returns original result...');
    const replayRes = await fetch('http://localhost:3339/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(mcpPayload),
    });

    if (!replayRes.ok) {
      throw new Error(`Replay request failed with status ${replayRes.status}: ${await replayRes.text()}`);
    }

    const replayRawText = await replayRes.text();
    let replayJson: any;
    try {
      replayJson = JSON.parse(replayRawText);
    } catch {
      const dataLine = replayRawText.split('\n').find((l) => l.startsWith('data: '));
      if (dataLine) {
        replayJson = JSON.parse(dataLine.slice(6));
      } else {
        throw new Error(`Could not parse replay response: ${replayRawText}`);
      }
    }

    const replayContentText = replayJson.result?.content?.[0]?.text;
    if (!replayContentText || !replayContentText.includes(deterministicMockOutput.reply)) {
      throw new Error('Replayed request did not return original model reply!');
    }
    console.log('✓ Idempotent replay returned canonical original result.');

    // Verify tm_messages message count is still exactly 2 (no duplicate insertion)
    const { data: replayMessages } = await adminClient
      .from('tm_messages')
      .select('seq')
      .eq('workspace_id', wsId);
    if ((replayMessages?.length ?? 0) !== messages.length) {
      throw new Error(`Expected message count to remain ${messages.length}, but found ${replayMessages?.length}`);
    }
    console.log(`✓ Verified tm_messages message count remained exactly ${messages.length} after idempotent replay.`);

    console.log('\n=== DETERMINISTIC MOCKED MCP CLIENT EXECUTION FULLY VERIFIED ===');
  } finally {
    console.log('\n[Cleanup] Tearing down test workspace, server, and test user...');
    if (server) {
      server.close();
    }
    if (wsId) {
      await adminClient.from('tm_messages').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_items').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_events').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_workspaces').delete().eq('id', wsId);
    }
    await adminClient.auth.admin.deleteUser(userId);
    console.log('✓ Cleanup complete.');
  }
}

testMockedMcpEndToEnd().catch((err) => {
  console.error('MOCKED MCP E2E FAILED:', err);
  process.exit(1);
});
