import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ffjgbefnubyjzrlvpdkl.supabase.co').trim();
const ANON_KEY = (process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_KEY = (process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_ACCESS_TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const PROJECT_REF = (process.env.SUPABASE_PROJECT_REF || 'ffjgbefnubyjzrlvpdkl').trim();

async function verifyStagingRpc() {
  console.log('=== Staging Database RPC Live Verification ===');
  console.log(`Target: ${SUPABASE_URL}`);

  if (!ANON_KEY || !SERVICE_KEY) {
    throw new Error(
      'Missing required environment variables for staging verification: ' +
      'STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1. Confirm migrations 007 and 009 are recorded in _tm_schema_migrations
  console.log('\n[Check 1] Verifying migrations 007 and 009 in _tm_schema_migrations table...');
  let migrations: Array<{ name: string; applied_at: string }> = [];
  const { data: migData, error: migErr } = await adminClient
    .from('_tm_schema_migrations')
    .select('name, applied_at')
    .order('applied_at');

  if (!migErr && migData) {
    migrations = migData;
  } else if (SUPABASE_ACCESS_TOKEN) {
    const sqlRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT name, applied_at FROM public._tm_schema_migrations ORDER BY applied_at;' }),
    });
    if (sqlRes.ok) {
      migrations = await sqlRes.json();
    }
  }

  const has007 = migrations.some((m) => m.name === '007_atomic_turn_rpc.sql');
  const has009 = migrations.some((m) => m.name === '009_user_level_quota_lock.sql');
  console.log('Migrations recorded in staging:');
  for (const m of migrations) {
    console.log(`  - ${m.name} (applied: ${m.applied_at})`);
  }
  if (!has007) {
    throw new Error('Migration 007_atomic_turn_rpc.sql NOT found in _tm_schema_migrations!');
  }
  if (!has009) {
    throw new Error('Migration 009_user_level_quota_lock.sql NOT found in _tm_schema_migrations!');
  }
  console.log('✓ Migrations 007 and 009 confirmed deployed.');

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

    // 9. Test User-Level Quota Reservation Serialization Across Different Workspaces (P1 Concurrency Verification)
    console.log('\n[Check 8] Testing user-level quota serialization across different workspaces...');
    const { data: ws2Data, error: ws2Err } = await clientA
      .from('tm_workspaces')
      .insert({ owner_id: uA.user.id, title: `Workspace 2 for Quota Concurrency ${nonce}` })
      .select('id')
      .single();

    if (ws2Err) throw new Error(`Failed to create Workspace 2 as User A: ${ws2Err.message}`);
    const wsId2 = ws2Data.id;
    console.log(`✓ Workspace 2 created: ${wsId2}`);

    // Count current turns/reservations for User A
    const { data: currentTurns, error: countErr } = await clientA.rpc('tm_turns_last_day');
    if (countErr) throw new Error(`Failed to query initial turn count: ${countErr.message}`);
    const baseCount = currentTurns ?? 0;
    console.log(`Initial User A turns in last 24h: ${baseCount}`);

    // Free plan allows 30 turns/day. Seed events so exactly 1 slot remains (29 turns used)
    const neededToSeed = Math.max(0, 29 - baseCount);
    if (neededToSeed > 0) {
      const dummyEvents = Array.from({ length: neededToSeed }).map((_, idx) => ({
        workspace_id: wsId,
        event_type: 'turn',
        payload: { seed_index: idx },
      }));
      const { error: seedErr } = await adminClient.from('tm_events').insert(dummyEvents);
      if (seedErr) throw new Error(`Failed to seed dummy turns for boundary test: ${seedErr.message}`);
    }

    console.log(`Launching 2 simultaneous concurrent reservations via tm_reserve_turn_quota_for_plan against Workspace 1 (${wsId}) and Workspace 2 (${wsId2})...`);

    const [raceRes1, raceRes2] = await Promise.all([
      clientA.rpc('tm_reserve_turn_quota_for_plan', { p_workspace_id: wsId }),
      clientA.rpc('tm_reserve_turn_quota_for_plan', { p_workspace_id: wsId2 }),
    ]);

    console.log('Concurrent plan reservation results:');
    console.log('  - Workspace 1 response:', raceRes1);
    console.log('  - Workspace 2 response:', raceRes2);

    if (raceRes1.error || raceRes2.error) {
      throw new Error(`RPC execution error during concurrent reservation: ${raceRes1.error?.message || raceRes2.error?.message}`);
    }

    const allowedCount = [raceRes1.data?.allowed, raceRes2.data?.allowed].filter(Boolean).length;
    const rejectedCount = [raceRes1.data?.allowed, raceRes2.data?.allowed].filter((a) => a === false).length;

    if (allowedCount !== 1 || rejectedCount !== 1) {
      throw new Error(
        `CRITICAL QUOTA RACE FAILURE: Expected exactly 1 allowed and 1 rejected reservation across workspaces, got allowed=${allowedCount}, rejected=${rejectedCount}`
      );
    }
    console.log('✓ User-level row lock strictly serialized concurrent requests across two different workspaces at the plan quota boundary.');

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
    await adminClient.from('tm_events').delete().eq('workspace_id', uA.user.id);
    await adminClient.from('tm_workspaces').delete().eq('owner_id', uA.user.id);
    await adminClient.from('tm_user_quotas').delete().eq('user_id', uA.user.id);
    await adminClient.auth.admin.deleteUser(uA.user.id);
    await adminClient.auth.admin.deleteUser(uB.user.id);
    console.log('✓ Cleanup complete.');
  }
}

verifyStagingRpc().catch((err) => {
  console.error('STAGING VERIFICATION FAILURE:', err);
  process.exit(1);
});
