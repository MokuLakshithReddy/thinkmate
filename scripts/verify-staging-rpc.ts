import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ffjgbefnubyjzrlvpdkl.supabase.co').trim();
const ANON_KEY = (process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_KEY = (process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_ACCESS_TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const PROJECT_REF = (process.env.SUPABASE_PROJECT_REF || 'ffjgbefnubyjzrlvpdkl').trim();

async function verifyStagingRpc() {
  console.log('=== Staging Database RPC Live Verification ===');
  console.log(`Target: ${SUPABASE_URL}`);

  if (!ANON_KEY || !SERVICE_KEY || !SUPABASE_ACCESS_TOKEN) {
    throw new Error(
      'Missing required environment variables for staging verification: ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN'
    );
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1. Confirm migration 007 is recorded in _tm_schema_migrations
  console.log('\n[Check 1] Verifying migration 007 in _tm_schema_migrations table...');
  const sqlRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: 'SELECT name, applied_at FROM public._tm_schema_migrations ORDER BY applied_at;' }),
  });
  if (!sqlRes.ok) {
    throw new Error(`Failed to query _tm_schema_migrations: ${await sqlRes.text()}`);
  }
  const migrations: Array<{ name: string; applied_at: string }> = await sqlRes.json();

  const has007 = migrations.some((m) => m.name === '007_atomic_turn_rpc.sql');
  console.log('Migrations recorded in staging:');
  for (const m of migrations) {
    console.log(`  - ${m.name} (applied: ${m.applied_at})`);
  }
  if (!has007) {
    throw new Error('Migration 007_atomic_turn_rpc.sql NOT found in tm_migrations!');
  }
  console.log('✓ Migration 007_atomic_turn_rpc.sql confirmed deployed.');

  // 2. Provision 2 ephemeral test users
  const nonce = Date.now();
  const emailA = `test-rpc-user-a-${nonce}@thinkmate.dev`;
  const emailB = `test-rpc-user-b-${nonce}@thinkmate.dev`;
  const pass = `StagingRpcSecretPass_${nonce}!`;

  console.log('\n[Check 2] Provisioning ephemeral test identities...');
  const { data: uA, error: errUA } = await adminClient.auth.admin.createUser({
    email: emailA,
    password: pass,
    email_confirm: true,
  });
  if (errUA) throw new Error(`Failed to create User A: ${errUA.message}`);

  const { data: uB, error: errUB } = await adminClient.auth.admin.createUser({
    email: emailB,
    password: pass,
    email_confirm: true,
  });
  if (errUB) throw new Error(`Failed to create User B: ${errUB.message}`);

  console.log(`✓ User A created: ${uA.user.id}`);
  console.log(`✓ User B created: ${uB.user.id}`);

  // 3. Obtain real JWTs by logging in with anon client
  const clientA = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authA, error: authAErr } = await clientA.auth.signInWithPassword({
    email: emailA,
    password: pass,
  });
  if (authAErr || !authA.session) throw new Error(`User A login failed: ${authAErr?.message}`);

  const clientB = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authB, error: authBErr } = await clientB.auth.signInWithPassword({
    email: emailB,
    password: pass,
  });
  if (authBErr || !authB.session) throw new Error(`User B login failed: ${authBErr?.message}`);

  console.log('✓ Real user JWT sessions established.');

  let wsId: string | null = null;
  try {
    // 4. Create workspace as User A
    console.log('\n[Check 3] Creating test workspace as User A...');
    const { data: wsData, error: wsErr } = await clientA
      .from('tm_workspaces')
      .insert({ owner_id: uA.user.id, title: `RPC Staging Verification ${nonce}` })
      .select('id')
      .single();

    if (wsErr) throw new Error(`Failed to create workspace as User A: ${wsErr.message}`);
    wsId = wsData.id;
    console.log(`✓ Workspace created: ${wsId}`);

    // 5. Test tm_apply_turn_tx as User A
    console.log('\n[Check 4] Testing tm_apply_turn_tx under User A JWT...');
    const clientMsgId = `d0000000-0000-0000-0000-${String(nonce).slice(-12).padStart(12, '0')}`;
    const userPrompt = 'How do we design a multi-tenant isolation model?';
    const assistantReply = 'We should use PostgreSQL Row Level Security (RLS) with tenant context.';

    const { data: rpcRes1, error: rpcErr1 } = await clientA.rpc('tm_apply_turn_tx', {
      p_workspace_id: wsId,
      p_user_message: userPrompt,
      p_assistant_reply: assistantReply,
      p_guidance_mode: 'hint',
      p_policy_action: 'advise',
      p_proposed_items: [
        { kind: 'idea', text: 'Use RLS policies per tenant_id', origin: 'ai', meta: {} },
        { kind: 'claim', text: 'RLS avoids application-level leaking', origin: 'ai', meta: {} }
      ],
      p_proposed_problem_frame: 'Multi-tenant database isolation architecture',
      p_client_msg_id: clientMsgId,
      p_meta: { test: true }
    });

    if (rpcErr1) throw new Error(`tm_apply_turn_tx failed for User A: ${rpcErr1.message}`);
    console.log('✓ tm_apply_turn_tx response 1:', rpcRes1);
    if (rpcRes1.idempotent_replay !== false) {
      throw new Error(`Expected idempotent_replay: false on first turn, got ${rpcRes1.idempotent_replay}`);
    }
    if (rpcRes1.assistant_reply !== assistantReply) {
      throw new Error(`Assistant reply mismatch: ${rpcRes1.assistant_reply}`);
    }

    // 6. Test idempotent replay with identical client_msg_id
    console.log('\n[Check 5] Testing idempotent replay under User A JWT...');
    const { data: rpcRes2, error: rpcErr2 } = await clientA.rpc('tm_apply_turn_tx', {
      p_workspace_id: wsId,
      p_user_message: userPrompt,
      p_assistant_reply: 'Divergent text that should be ignored by replay',
      p_guidance_mode: 'hint',
      p_policy_action: 'advise',
      p_proposed_items: [],
      p_client_msg_id: clientMsgId,
    });

    if (rpcErr2) throw new Error(`Idempotent replay failed for User A: ${rpcErr2.message}`);
    console.log('✓ tm_apply_turn_tx replay response:', rpcRes2);
    if (rpcRes2.idempotent_replay !== true) {
      throw new Error(`Expected idempotent_replay: true, got ${rpcRes2.idempotent_replay}`);
    }
    if (rpcRes2.assistant_reply !== assistantReply) {
      throw new Error(`Expected original assistant reply on replay, got: ${rpcRes2.assistant_reply}`);
    }
    console.log('✓ Idempotent replay strictly returned the original stored assistant response.');

    // 7. Test tm_propose_update_tx as User A
    console.log('\n[Check 6] Testing tm_propose_update_tx under User A JWT...');
    const { data: propRes, error: propErr } = await clientA.rpc('tm_propose_update_tx', {
      p_workspace_id: wsId,
      p_items: [
        { kind: 'hypothesis', text: 'Separate schemas might increase maintenance overhead' }
      ],
      p_problem_frame: 'Updated problem frame statement',
      p_audit_payload: { via: 'staging_verification' }
    });

    if (propErr) throw new Error(`tm_propose_update_tx failed for User A: ${propErr.message}`);
    console.log('✓ tm_propose_update_tx response:', propRes);

    // 8. Test cross-user authorization rejection under User B JWT
    console.log('\n[Check 7] Testing authorization boundary: User B executing RPC against User A workspace...');
    const { data: unauthRes, error: unauthErr } = await clientB.rpc('tm_apply_turn_tx', {
      p_workspace_id: wsId,
      p_user_message: 'Malicious turn injection attempt',
      p_assistant_reply: 'Should be rejected',
    });

    if (!unauthErr) {
      throw new Error(`CRITICAL SECURITY FAILURE: User B was able to execute tm_apply_turn_tx on User A's workspace! Result: ${JSON.stringify(unauthRes)}`);
    }
    console.log(`✓ Unauthorized turn rejected as expected: ${unauthErr.message}`);

    const { data: unauthProp, error: unauthPropErr } = await clientB.rpc('tm_propose_update_tx', {
      p_workspace_id: wsId,
      p_items: [{ kind: 'idea', text: 'Malicious idea' }],
    });

    if (!unauthPropErr) {
      throw new Error(`CRITICAL SECURITY FAILURE: User B was able to execute tm_propose_update_tx on User A's workspace! Result: ${JSON.stringify(unauthProp)}`);
    }
    console.log(`✓ Unauthorized propose update rejected as expected: ${unauthPropErr.message}`);

    console.log('\n=== ALL STAGING DATABASE RPC VERIFICATIONS PASSED ===');
  } finally {
    // Teardown
    console.log('\n[Cleanup] Cleaning up test workspace and ephemeral users...');
    if (wsId) {
      await adminClient.from('tm_messages').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_items').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_events').delete().eq('workspace_id', wsId);
      await adminClient.from('tm_workspaces').delete().eq('id', wsId);
    }
    await adminClient.auth.admin.deleteUser(uA.user.id);
    await adminClient.auth.admin.deleteUser(uB.user.id);
    console.log('✓ Cleanup complete.');
  }
}

verifyStagingRpc().catch((err) => {
  console.error('STAGING VERIFICATION FAILURE:', err);
  process.exit(1);
});
