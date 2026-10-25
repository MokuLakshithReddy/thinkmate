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

async function testLiveMcpEndToEnd() {
  console.log('=== Real External MCP Client E2E Verification ===');

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1. Provision staging test user
  const nonce = Date.now();
  const email = `mcp-e2e-user-${nonce}@thinkmate.dev`;
  const pass = `McpE2ESecret_${nonce}!`;

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
    auth: { persistSession: false, autoRefreshToken: false }
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
      .insert({ owner_id: userId, title: `MCP Live E2E Workspace ${nonce}` })
      .select('id')
      .single();

    if (wsErr) throw new Error(`Workspace creation failed: ${wsErr.message}`);
    wsId = wsData.id;
    console.log(`✓ Test workspace created: ${wsId}`);

    // 4. Start MCP Server locally on port 3338 with live AI runner
    const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY is required for live AI verification. To run with deterministic mocks, use scripts/verify-mock-mcp-e2e.ts');
    }

    const { runTurn } = await import('../src/lib/thinkmate/llm');
    const { DEFAULT_GEMINI_MODEL } = await import('../src/config/models');
    const activeModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

    console.log(`[Step 4] Starting ThinkMate MCP server on port 3338...`);
    console.log(`  AI Execution Mode: [LIVE GEMINI AI GENERATION]`);
    console.log(`  Target Model: ${activeModel}`);

    let capturedModelOutput: any = null;
    const liveRunner = async (system: any, history: any) => {
      // Direct live AI execution — fails test if Gemini fails
      const res = await runTurn(system, history);
      capturedModelOutput = res.output;
      return res;
    };

    server = startMcpServer(3338, liveRunner as any);
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('✓ MCP server is listening on port 3338 with live AI runner.');

    // 5. Connect as a real external MCP client over HTTP
    console.log('\n[Step 5] External MCP client executing execute_thinking_turn via HTTP POST /mcp...');
    const clientMsgId = crypto.randomUUID();
    const question = 'How should we partition user data across regional database clusters to minimize latency and ensure fault tolerance?';

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

    const mcpRes = await fetch('http://localhost:3338/mcp', {
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
    console.log('\n[MCP Response]:', JSON.stringify(mcpJson, null, 2));

    if (mcpJson.error) {
      throw new Error(`MCP tool execution returned error: ${JSON.stringify(mcpJson.error)}`);
    }

    const contentText = mcpJson.result?.content?.[0]?.text;
    if (!contentText || mcpJson.result?.isError) {
      throw new Error(`MCP tool execution failed or produced empty text: ${JSON.stringify(mcpJson.result)}`);
    }

    if (!capturedModelOutput) {
      throw new Error('Live Gemini model was not called during execute_thinking_turn execution!');
    }

    // Verify MCP response strictly contains the live model reply
    if (!contentText.includes(capturedModelOutput.reply)) {
      throw new Error('MCP response content does not match the live model reply returned by Gemini!');
    }

    console.log('✓ External MCP request succeeded with genuine live AI generation.');
    console.log(`✓ Live model reply preview: ${capturedModelOutput.reply.slice(0, 150)}...`);

    // 6. Direct Staging Database Verification
    console.log('\n[Step 6] Verifying live database persistence on staging database...');
    const { data: messages, error: mErr } = await adminClient
      .from('tm_messages')
      .select('seq, role, content, client_msg_id')
      .eq('workspace_id', wsId)
      .order('seq');

    if (mErr) throw new Error(`Failed to load messages from staging: ${mErr.message}`);
    console.log(`✓ Messages persisted on staging: ${messages.length}`);
    for (const m of messages) {
      console.log(`  - seq ${m.seq} [${m.role}]: ${m.content.slice(0, 100)}...`);
    }

    if (messages.length < 2) {
      throw new Error(`Expected at least 2 messages (user & assistant), found: ${messages.length}`);
    }

    // Assert live model reply was persisted to tm_messages
    const persistedAssistant = messages.find((m) => m.role === 'assistant');
    if (!persistedAssistant || persistedAssistant.content !== capturedModelOutput.reply) {
      throw new Error('Persisted assistant message in staging DB does not match live model output!');
    }
    console.log('✓ Live model output verified in tm_messages.');

    const { data: items, error: iErr } = await adminClient
      .from('tm_items')
      .select('kind, text, status, origin')
      .eq('workspace_id', wsId);

    if (iErr) throw new Error(`Failed to load items from staging: ${iErr.message}`);
    console.log(`✓ Proposed items persisted on staging: ${items.length}`);
    for (const it of items) {
      console.log(`  - [${it.status}] ${it.kind}: ${it.text}`);
    }

    // Assert proposed items in database match captured model proposed items
    if (items.length !== capturedModelOutput.proposed_items.length) {
      throw new Error(`Expected ${capturedModelOutput.proposed_items.length} proposed items in staging DB, found ${items.length}`);
    }
    console.log('✓ Proposed items verified against live model output.');

    const { data: events, error: eErr } = await adminClient
      .from('tm_events')
      .select('event_type, payload')
      .eq('workspace_id', wsId);

    if (eErr) throw new Error(`Failed to load events from staging: ${eErr.message}`);
    console.log(`✓ Audit events recorded on staging: ${events.length}`);
    for (const ev of events) {
      console.log(`  - event: ${ev.event_type}`);
    }

    // 7. Verify loadState matches persisted state
    console.log('\n[Step 7] Verifying workspace reload via loadState()...');
    const state = await loadState(userClient, wsId!);
    if (!state) throw new Error('loadState returned null for persisted workspace!');
    console.log(`✓ Workspace reloaded cleanly: ${state.ws.title}`);
    console.log(`✓ Reloaded messages: ${state.messages.length}`);
    console.log(`✓ Reloaded items: ${state.items.length}`);

    console.log('\n=== REAL EXTERNAL MCP CLIENT EXECUTION FULLY VERIFIED ===');
  } finally {
    // Teardown
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

testLiveMcpEndToEnd().catch((err) => {
  console.error('LIVE MCP E2E FAILED:', err);
  process.exit(1);
});
