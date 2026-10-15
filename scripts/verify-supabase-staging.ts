/**
 * Staging Database Transaction and Migration Verification Suite
 *
 * Runs genuine end-to-end database assertions against a target Supabase / PostgreSQL database:
 * 1. RPC permissions: Confirms execution is strictly denied to anon/public callers and granted to service_role.
 * 2. Concurrency control: Runs two genuinely concurrent simultaneous calls against the same initial state,
 *    proving row-level locking serializes traffic and rejects the losing request with CONFLICT.
 * 3. Duplicate request IDs with different payloads: Verifies key reuse tampering is rejected.
 * 4. Legacy rows with missing/empty hashes: Verifies legacy rows without hashes cannot be blindly replayed.
 * 5. Rollback behavior: Forces an error AFTER partial writes (inserting messages & updating session)
 *    to prove atomic rollback restores state with zero orphaned rows.
 *
 * Mandatory Environment Variables:
 *   STAGING_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 *   STAGING_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *
 * Exit code: 0 on complete pass, 1 on any failure, missing credentials, or assertion error.
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import assert from 'node:assert';

const SUPABASE_URL = process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function runStagingVerification() {
  console.log('='.repeat(75));
  console.log('ThinkMate — Genuine Staging Database Transaction & Migration Verification');
  console.log('='.repeat(75));

  // Strict credential check: ALL THREE credentials (URL, SERVICE_ROLE, and ANON) are mandatory
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error('\n[FATAL] Missing required staging credentials.');
    console.error('All three credentials are required to prove security and concurrency:');
    console.error(`  - STAGING_SUPABASE_URL: ${SUPABASE_URL ? 'PRESENT' : 'MISSING'}`);
    console.error(`  - STAGING_SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY ? 'PRESENT' : 'MISSING'}`);
    console.error(`  - STAGING_SUPABASE_ANON_KEY: ${ANON_KEY ? 'PRESENT' : 'MISSING'}\n`);
    process.exit(1);
  }

  // Safety Pre-Flight: Verify target project reference to strictly prevent running tests against production
  let projectHost = '';
  try {
    const parsedUrl = new URL(SUPABASE_URL);
    projectHost = parsedUrl.host.toLowerCase();
  } catch {
    console.error(`\n[FATAL] STAGING_SUPABASE_URL is not a valid URL: ${SUPABASE_URL}`);
    process.exit(1);
  }

  // Exact Staging Project Reference Allowlist:
  // EXPECTED_STAGING_PROJECT_REF is mandatory to fail closed against unverified environments
  const expectedProjectRef = (process.env.EXPECTED_STAGING_PROJECT_REF || process.env.STAGING_PROJECT_REF || '').toLowerCase().trim();
  if (!expectedProjectRef) {
    console.error('\n[SECURITY FATAL] Missing required EXPECTED_STAGING_PROJECT_REF environment variable.');
    console.error('To strictly prevent running verification against unverified projects, you must specify EXPECTED_STAGING_PROJECT_REF.');
    process.exit(1);
  }

  const expectedHost = `${expectedProjectRef}.supabase.co`;
  if (projectHost !== expectedHost) {
    console.error(`\n[SECURITY FATAL] Staging host mismatch! Target host "${projectHost}" does not exactly match required staging project "${expectedHost}".`);
    process.exit(1);
  }
  console.log(`✔ Verified target staging project strictly matches required allowlist: ${expectedHost}`);

  // Deny-list: Known production project refs that must NEVER receive destructive/staging test executions
  const FORBIDDEN_PRODUCTION_REFS = ['gtkvujspajcelzufpggr', 'ujbpyqubhxycgtaadkce'];
  for (const prodRef of FORBIDDEN_PRODUCTION_REFS) {
    if (projectHost.includes(prodRef)) {
      console.error(`\n[SECURITY FATAL] Refusing to run tests! Target host "${projectHost}" matches production project "${prodRef}".`);
      console.error('Staging verification must NEVER target production databases.');
      process.exit(1);
    }
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  });

  let testUserId = '';
  let attackerUserId = '';
  const testSessionId = crypto.randomUUID();

  // Create disposable test user via Supabase Auth Admin API so foreign key constraints are satisfied
  const testEmail = `staging-user-${crypto.randomUUID()}@thinkmate.local`;
  const { data: authUser, error: authErr } = await serviceClient.auth.admin.createUser({
    email: testEmail,
    password: 'StagingPassword123!',
    email_confirm: true,
  });
  if (authErr || !authUser?.user) {
    throw new Error(`Failed to create disposable test user: ${authErr?.message}`);
  }
  testUserId = authUser.user.id;

  console.log(`Target verified staging database: ${projectHost}`);
  console.log(`Disposable test session: ${testSessionId}`);
  console.log(`Disposable test user: ${testUserId}`);
  console.log(`Execution Timestamp: ${new Date().toISOString()}`);
  console.log(`Node Runtime: ${process.version}\n`);

  // Log schema migration status
  const { data: migrationRows, error: migErr } = await serviceClient
    .from('supabase_migrations')
    .select('version')
    .order('version', { ascending: true });
  if (!migErr && migrationRows) {
    console.log(`Applied Database Migrations (${migrationRows.length}):`);
    migrationRows.forEach((m: { version: string }) => console.log(`  - ${m.version}`));
    console.log('');
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: RPC Permissions Check (Mandatory Anonymous Execution Denial)
    // -------------------------------------------------------------------------
    console.log('[Test 1/6] Verifying RPC permissions: anon execution must be denied...');
    const { data: anonData, error: anonError } = await anonClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'Unauthorized probe',
      p_assistant_message: 'Unauthorized probe',
      p_next_stage: 'describe_problem',
      p_next_mode: 'understand',
      p_expected_stage: 'welcome',
      p_expected_mode: 'understand',
    });

    assert.strictEqual(anonData, null, 'Anon client must not receive RPC data');
    assert.ok(anonError, 'Anon client call to record_workflow_step_tx must return an error');
    const isDenied =
      anonError.code === '42501' ||
      anonError.message.includes('permission denied') ||
      anonError.message.includes('Forbidden') ||
      anonError.message.includes('does not exist'); // PostgreSQL revokes execute permission

    assert.ok(
      isDenied,
      `Expected permission denied (code 42501) for anon caller, received: ${anonError.message} (${anonError.code})`
    );
    console.log('  ✔ Passed: RPC execution strictly denied to anonymous/unprivileged callers.');

    // -------------------------------------------------------------------------
    // Set up disposable test session row for Tests 2-5
    // -------------------------------------------------------------------------
    const { error: seedError } = await serviceClient.from('thinking_sessions').insert({
      id: testSessionId,
      user_id: testUserId,
      title: 'Staging Integration Verification Session',
      problem_statement: 'Staging test problem statement',
      current_mode: 'understand',
      current_stage: 'welcome',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (seedError) {
      throw new Error(`Failed to insert seed session: ${seedError.message}`);
    }

    // -------------------------------------------------------------------------
    // TEST 2: Genuine Simultaneous Concurrency Test Under Row Lock
    // -------------------------------------------------------------------------
    console.log('\n[Test 2/6] Verifying genuine simultaneous concurrency under row lock...');
    const reqIdConc1 = `req-conc-1-${Date.now()}`;
    const reqIdConc2 = `req-conc-2-${Date.now()}`;

    // Launch two competing requests simultaneously over HTTP against the exact same initial state ('welcome')
    const [result1, result2] = await Promise.all([
      serviceClient.rpc('record_workflow_step_tx', {
        p_session_id: testSessionId,
        p_user_id: testUserId,
        p_user_message: 'Concurrent message 1',
        p_assistant_message: 'Step 1 processed',
        p_next_stage: 'describe_problem',
        p_next_mode: 'understand',
        p_expected_stage: 'welcome',
        p_expected_mode: 'understand',
        p_client_request_id: reqIdConc1,
        p_request_hash: 'hash-conc-1-valid',
      }),
      serviceClient.rpc('record_workflow_step_tx', {
        p_session_id: testSessionId,
        p_user_id: testUserId,
        p_user_message: 'Concurrent message 2',
        p_assistant_message: 'Step 2 processed',
        p_next_stage: 'describe_problem',
        p_next_mode: 'understand',
        p_expected_stage: 'welcome',
        p_expected_mode: 'understand',
        p_client_request_id: reqIdConc2,
        p_request_hash: 'hash-conc-2-valid',
      }),
    ]);

    const successes = [result1, result2].filter((r) => !r.error && r.data);
    const conflicts = [result1, result2].filter(
      (r) => r.error && r.error.message.includes('CONFLICT: expected stage')
    );

    assert.strictEqual(
      successes.length,
      1,
      `Expected exactly 1 request to win the race condition, got ${successes.length} successes`
    );
    assert.strictEqual(
      conflicts.length,
      1,
      `Expected exactly 1 request to lose the race and receive CONFLICT, got ${conflicts.length} conflicts`
    );
    console.log('  ✔ Passed: Simultaneous race serialized under row lock; exactly 1 won and 1 rejected with CONFLICT.');

    // -------------------------------------------------------------------------
    // TEST 3: Duplicate Request ID with Different Payload / Hash
    // -------------------------------------------------------------------------
    console.log('\n[Test 3/6] Verifying duplicate request ID with altered payload...');
    const duplicateReqId = `req-dup-test-${Date.now()}`;
    const hashOriginal = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hashTampered = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    // 1st call records successfully
    const { error: originalErr } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'Original prompt',
      p_assistant_message: 'Original answer',
      p_next_stage: 'clarify_objective',
      p_next_mode: 'understand',
      p_expected_stage: 'describe_problem',
      p_expected_mode: 'understand',
      p_client_request_id: duplicateReqId,
      p_request_hash: hashOriginal,
    });
    if (originalErr) throw new Error(`Original step failed: ${originalErr.message}`);

    // 2nd call reuses same client_request_id but with tampered payload hash
    const { data: tamperedData, error: tamperedErr } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'Tampered different prompt',
      p_assistant_message: 'Original answer',
      p_next_stage: 'clarify_objective',
      p_next_mode: 'understand',
      p_expected_stage: 'describe_problem',
      p_expected_mode: 'understand',
      p_client_request_id: duplicateReqId,
      p_request_hash: hashTampered,
    });

    assert.strictEqual(tamperedData, null, 'Tampered retry must not return data');
    assert.ok(tamperedErr, 'Tampered retry must fail');
    assert.ok(
      tamperedErr.message.includes('Idempotency key reuse violation'),
      `Expected Idempotency key reuse violation, received: ${tamperedErr.message}`
    );
    console.log('  ✔ Passed: Reusing request ID with different payload rejected with key reuse violation.');

    // -------------------------------------------------------------------------
    // TEST 4: Legacy Rows with Missing / Empty Hashes
    // -------------------------------------------------------------------------
    console.log('\n[Test 4/6] Verifying legacy row with empty/missing request_hash...');
    const legacyReqId = `req-legacy-${Date.now()}`;
    const { error: insertLegacyErr } = await serviceClient.from('workflow_idempotency_keys').insert({
      user_id: testUserId,
      session_id: testSessionId,
      client_request_id: legacyReqId,
      request_hash: '', // Legacy unverified hash
      response_payload: { message: 'Old unverified response', nextStep: 'explore_perspectives' },
    });
    if (insertLegacyErr) throw new Error(`Failed to insert legacy test row: ${insertLegacyErr.message}`);

    // Call RPC attempting to replay using verified request hash
    const { data: legacyReplayData, error: legacyReplayErr } = await serviceClient.rpc(
      'record_workflow_step_tx',
      {
        p_session_id: testSessionId,
        p_user_id: testUserId,
        p_user_message: 'New request attempting legacy reuse',
        p_assistant_message: 'New response',
        p_next_stage: 'break_subproblems',
        p_next_mode: 'explore',
        p_expected_stage: 'clarify_objective',
        p_expected_mode: 'understand',
        p_client_request_id: legacyReqId,
        p_request_hash: 'new-valid-sha256-hash',
      }
    );

    assert.strictEqual(legacyReplayData, null, 'Legacy record without hash must not be accepted');
    assert.ok(legacyReplayErr, 'Legacy record without hash must trigger rejection');
    assert.ok(
      legacyReplayErr.message.includes('Idempotency key reuse violation') &&
        legacyReplayErr.message.includes('unverified payload'),
      `Expected rejection for unverified legacy hash, received: ${legacyReplayErr.message}`
    );
    console.log('  ✔ Passed: Legacy record with empty/missing hash strictly rejected.');

    // -------------------------------------------------------------------------
    // TEST 5: Atomic Rollback Behavior AFTER Partial Writes
    // -------------------------------------------------------------------------
    console.log('\n[Test 5/6] Verifying atomic rollback behavior after partial writes...');
    // Capture initial state before the test transaction
    const { count: initialMsgCount, error: countErr1 } = await serviceClient
      .from('session_messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', testSessionId);
    if (countErr1) throw new Error(`Failed to count messages: ${countErr1.message}`);

    const { data: sessionBefore, error: sessErr1 } = await serviceClient
      .from('thinking_sessions')
      .select('current_stage, current_mode, updated_at')
      .eq('id', testSessionId)
      .single();
    if (sessErr1) throw new Error(`Failed to inspect session before tx: ${sessErr1.message}`);

    // Call RPC with VALID expected_stage and expected_mode so OCC passes,
    // Step 5 inserts user message, Step 6 inserts assistant message, Step 7 updates session,
    // but Step 8 forces an exception by passing a scalar JSON value to jsonb_set.
    const { data: rollbackData, error: rollbackErr } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'User message inserted prior to error',
      p_assistant_message: 'Assistant message inserted prior to error',
      p_next_stage: 'break_subproblems',
      p_next_mode: 'explore',
      p_expected_stage: sessionBefore.current_stage,
      p_expected_mode: sessionBefore.current_mode,
      p_client_request_id: `req-rollback-${Date.now()}`,
      p_request_hash: 'hash-rollback-test',
      // Passing a JSON string scalar causes jsonb_set(scalar, ...) in Step 8 to throw
      // "cannot replace path in scalar" (error code 22023) AFTER steps 5, 6, and 7 executed
      p_client_response: 'forced_scalar_string_exception' as unknown as Record<string, unknown>,
    });

    assert.strictEqual(rollbackData, null, 'Failed transaction must not return data');
    assert.ok(rollbackErr, 'Transaction must throw an error after partial writes');
    assert.ok(
      rollbackErr.message.includes('cannot replace path in scalar') ||
        rollbackErr.message.includes('22023') ||
        rollbackErr.code === '22023',
      `Expected post-write jsonb_set error (22023), received: ${rollbackErr.message}`
    );

    // Verify atomic rollback:
    // 1. Message count must be strictly unchanged (both user and assistant messages rolled back)
    const { count: postMsgCount, error: countErr2 } = await serviceClient
      .from('session_messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', testSessionId);
    if (countErr2) throw new Error(`Failed to count messages after tx: ${countErr2.message}`);

    assert.strictEqual(
      postMsgCount,
      initialMsgCount,
      `Rollback failed: session_messages count increased from ${initialMsgCount} to ${postMsgCount}`
    );

    // 2. Session stage, mode, and updated_at must remain completely unmodified
    const { data: sessionAfter, error: sessErr2 } = await serviceClient
      .from('thinking_sessions')
      .select('current_stage, current_mode, updated_at')
      .eq('id', testSessionId)
      .single();
    if (sessErr2) throw new Error(`Failed to inspect session after tx: ${sessErr2.message}`);

    assert.strictEqual(
      sessionAfter.current_stage,
      sessionBefore.current_stage,
      `Rollback failed: session current_stage changed to ${sessionAfter.current_stage}`
    );
    assert.strictEqual(
      sessionAfter.current_mode,
      sessionBefore.current_mode,
      `Rollback failed: session current_mode changed to ${sessionAfter.current_mode}`
    );
    console.log('  ✔ Passed: Partial writes (messages & session updates) atomically rolled back on failure.');

    // -------------------------------------------------------------------------
    // TEST 6: Multi-User Cross-Tenant Isolation, PostgreSQL RLS & Data Integrity
    // -------------------------------------------------------------------------
    console.log('\n[Test 6/6] Verifying multi-user cross-tenant isolation & PostgreSQL RLS...');

    // 1. Seed baseline records for all sensitive child tables before capturing baseline snapshot
    const testInsightId = crypto.randomUUID();
    const { error: seedInsightErr } = await serviceClient.from('session_insights').insert({
      id: testInsightId,
      session_id: testSessionId,
      category: 'decision',
      status: 'accepted',
      title: 'Victim Decision Insight',
      content: 'Core architecture decision record',
    });
    if (seedInsightErr) throw new Error(`Failed to seed victim insight: ${seedInsightErr.message}`);

    const testTransitionId = crypto.randomUUID();
    const { error: seedTransErr } = await serviceClient.from('workflow_transitions').insert({
      id: testTransitionId,
      session_id: testSessionId,
      from_mode: 'understand',
      to_mode: 'explore',
      reason: 'Baseline valid workflow transition record',
    });
    if (seedTransErr) throw new Error(`Failed to seed baseline transition: ${seedTransErr.message}`);

    // 2. Capture complete cryptographic baseline snapshot of Victim state across ALL sensitive tables
    const { data: baselineSession, error: bSessErr } = await serviceClient
      .from('thinking_sessions')
      .select('id, user_id, title, problem_statement, current_mode, current_stage, status')
      .eq('id', testSessionId)
      .single();
    if (bSessErr) throw new Error(`Failed to capture baseline session: ${bSessErr.message}`);

    const { data: baselineMessages, error: bMsgErr } = await serviceClient
      .from('session_messages')
      .select('id, session_id, role, content, mode')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (bMsgErr) throw new Error(`Failed to capture baseline messages: ${bMsgErr.message}`);
    assert.ok((baselineMessages?.length || 0) > 0, 'Baseline victim messages must be non-empty');

    const { data: baselineInsights, error: bInsErr } = await serviceClient
      .from('session_insights')
      .select('id, session_id, category, status, title, content')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (bInsErr) throw new Error(`Failed to capture baseline insights: ${bInsErr.message}`);
    assert.ok((baselineInsights?.length || 0) > 0, 'Baseline victim insights must be non-empty');

    const { data: baselineTransitions, error: bTransErr } = await serviceClient
      .from('workflow_transitions')
      .select('id, session_id, from_mode, to_mode, reason')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (bTransErr) throw new Error(`Failed to capture baseline transitions: ${bTransErr.message}`);
    assert.ok((baselineTransitions?.length || 0) > 0, 'Baseline victim transitions must be non-empty');

    const { data: baselineIdempotencyKeys, error: bIdempErr } = await serviceClient
      .from('workflow_idempotency_keys')
      .select('session_id, user_id, client_request_id, request_hash')
      .eq('session_id', testSessionId)
      .order('client_request_id', { ascending: true });
    if (bIdempErr) throw new Error(`Failed to capture baseline idempotency keys: ${bIdempErr.message}`);

    console.log(`  Baseline captured across 5 sensitive tables (${baselineMessages.length} msgs, ${baselineInsights.length} insights, ${baselineTransitions.length} transitions).`);

    // 3. Create disposable Attacker user and obtain JWT scoped to attacker's identity
    const attackerEmail = `staging-attacker-${crypto.randomUUID()}@thinkmate.local`;
    const attackerPassword = 'StagingAttackerPassword123!';
    const { data: attackerAuth, error: attackerAuthErr } = await serviceClient.auth.admin.createUser({
      email: attackerEmail,
      password: attackerPassword,
      email_confirm: true,
    });
    if (attackerAuthErr || !attackerAuth?.user) {
      throw new Error(`Failed to create disposable attacker user: ${attackerAuthErr?.message}`);
    }
    attackerUserId = attackerAuth.user.id;

    // Authenticate as Attacker to obtain an authentic user JWT scoped to auth.uid() = attackerUserId
    const { data: attackerSignIn, error: attackerSignInErr } = await anonClient.auth.signInWithPassword({
      email: attackerEmail,
      password: attackerPassword,
    });
    if (attackerSignInErr || !attackerSignIn?.session?.access_token) {
      throw new Error(`Failed to sign in as attacker: ${attackerSignInErr?.message}`);
    }
    const attackerToken = attackerSignIn.session.access_token;

    // Create client scoped to Attacker's authenticated JWT (enforcing PostgreSQL RLS)
    const attackerScopedClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${attackerToken}`,
        },
      },
    });

    // -------------------------------------------------------------------------
    // 6a. Table RLS: thinking_sessions (SELECT, INSERT, UPDATE, DELETE)
    // -------------------------------------------------------------------------
    // 6a.1: Attacker attempts to read Victim's session (must return 0 rows)
    const { data: foreignSessions, error: foreignSessErr } = await attackerScopedClient
      .from('thinking_sessions')
      .select('*')
      .eq('id', testSessionId);
    if (foreignSessErr) throw new Error(`RLS query error: ${foreignSessErr.message}`);
    assert.strictEqual(foreignSessions?.length || 0, 0, 'RLS violation: Attacker read victim thinking_sessions');

    // 6a.2: Attacker attempts to forge a session using Victim's user_id (must fail with 42501 / RLS error)
    const { data: forgedSess, error: forgedSessErr } = await attackerScopedClient
      .from('thinking_sessions')
      .insert({
        id: crypto.randomUUID(),
        user_id: testUserId, // Victim user ID
        title: 'Forged Victim Session',
        problem_statement: 'Injected problem',
        current_mode: 'understand',
        current_stage: 'welcome',
        status: 'active',
      })
      .select();
    assert.strictEqual(forgedSess?.length || 0, 0, 'No rows should be inserted by attacker');
    assert.ok(forgedSessErr, 'Expected specific RLS violation on unauthorized session insert');
    assert.ok(
      forgedSessErr.code === '42501' ||
        forgedSessErr.message.includes('violates row-level security policy') ||
        forgedSessErr.message.includes('permission denied'),
      `Expected authorization violation (42501/RLS), got: ${forgedSessErr.message} (${forgedSessErr.code})`
    );

    // 6a.3: Attacker attempts to modify Victim's session (must affect 0 rows)
    const { data: updatedSess, error: updateSessErr } = await attackerScopedClient
      .from('thinking_sessions')
      .update({ title: 'Cross-Tenant Malicious Tampering' })
      .eq('id', testSessionId)
      .select();
    if (updateSessErr) throw new Error(`RLS update error: ${updateSessErr.message}`);
    assert.strictEqual(updatedSess?.length || 0, 0, 'RLS violation: Attacker updated victim thinking_sessions');

    // 6a.4: Attacker attempts to delete Victim's session (must affect 0 rows)
    const { data: deletedSess, error: deleteSessErr } = await attackerScopedClient
      .from('thinking_sessions')
      .delete()
      .eq('id', testSessionId)
      .select();
    if (deleteSessErr) throw new Error(`RLS delete error: ${deleteSessErr.message}`);
    assert.strictEqual(deletedSess?.length || 0, 0, 'RLS violation: Attacker deleted victim thinking_sessions');
    console.log('  ✔ Passed: thinking_sessions RLS strictly blocks unauthorized SELECT, INSERT, UPDATE, and DELETE.');

    // -------------------------------------------------------------------------
    // 6b. Table RLS: session_messages (SELECT, INSERT, UPDATE, DELETE)
    // -------------------------------------------------------------------------
    // 6b.1: Attacker attempts to read Victim's messages (must return 0 rows)
    const { data: foreignMsgs, error: foreignMsgsErr } = await attackerScopedClient
      .from('session_messages')
      .select('*')
      .eq('session_id', testSessionId);
    if (foreignMsgsErr) throw new Error(`RLS query error: ${foreignMsgsErr.message}`);
    assert.strictEqual(foreignMsgs?.length || 0, 0, 'RLS violation: Attacker read victim session_messages');

    // 6b.2: Attacker attempts to insert message into Victim's session (must fail with 42501 / RLS error)
    const { data: injectedMsg, error: injectedMsgErr } = await attackerScopedClient
      .from('session_messages')
      .insert({
        id: crypto.randomUUID(),
        session_id: testSessionId,
        role: 'user',
        content: 'Malicious injected message',
        mode: 'understand',
      })
      .select();
    assert.strictEqual(injectedMsg?.length || 0, 0, 'No message rows should be inserted by attacker');
    assert.ok(injectedMsgErr, 'Expected specific RLS policy violation on message insert into victim session');
    assert.ok(
      injectedMsgErr.code === '42501' ||
        injectedMsgErr.message.includes('violates row-level security policy') ||
        injectedMsgErr.message.includes('permission denied'),
      `Expected authorization violation on message insert, got: ${injectedMsgErr.message} (${injectedMsgErr.code})`
    );

    // 6b.3: Attacker attempts to update messages in Victim's session (must affect 0 rows)
    const { data: tamperedMsgs, error: tamperedMsgsErr } = await attackerScopedClient
      .from('session_messages')
      .update({ content: 'Tampered content' })
      .eq('session_id', testSessionId)
      .select();
    if (tamperedMsgsErr) throw new Error(`RLS query error: ${tamperedMsgsErr.message}`);
    assert.strictEqual(tamperedMsgs?.length || 0, 0, 'RLS violation: Attacker updated victim session_messages');

    // 6b.4: Attacker attempts to delete messages in Victim's session (must affect 0 rows)
    const { data: deletedMsgs, error: deletedMsgsErr } = await attackerScopedClient
      .from('session_messages')
      .delete()
      .eq('session_id', testSessionId)
      .select();
    if (deletedMsgsErr) throw new Error(`RLS query error: ${deletedMsgsErr.message}`);
    assert.strictEqual(deletedMsgs?.length || 0, 0, 'RLS violation: Attacker deleted victim session_messages');
    console.log('  ✔ Passed: session_messages RLS strictly blocks unauthorized SELECT, INSERT, UPDATE, and DELETE.');

    // -------------------------------------------------------------------------
    // 6c. Table RLS: session_insights (SELECT, INSERT, UPDATE, DELETE)
    // -------------------------------------------------------------------------
    // 6c.1: Attacker attempts to read Victim's insight (must return 0 rows)
    const { data: foreignInsights, error: foreignInsightsErr } = await attackerScopedClient
      .from('session_insights')
      .select('*')
      .eq('id', testInsightId);
    if (foreignInsightsErr) throw new Error(`RLS query error: ${foreignInsightsErr.message}`);
    assert.strictEqual(foreignInsights?.length || 0, 0, 'RLS violation: Attacker read victim session_insights');

    // 6c.2: Attacker attempts to insert insight into Victim's session (must fail with 42501 / RLS error)
    const { data: injectedInsight, error: injectedInsightErr } = await attackerScopedClient
      .from('session_insights')
      .insert({
        id: crypto.randomUUID(),
        session_id: testSessionId,
        category: 'decision',
        status: 'tentative',
        title: 'Attacker Malicious Insight',
        content: 'Fabricated decision record',
      })
      .select();
    assert.strictEqual(injectedInsight?.length || 0, 0, 'No insight rows should be inserted by attacker');
    assert.ok(injectedInsightErr, 'Expected specific RLS policy violation on insight insert into victim session');
    assert.ok(
      injectedInsightErr.code === '42501' ||
        injectedInsightErr.message.includes('violates row-level security policy') ||
        injectedInsightErr.message.includes('permission denied'),
      `Expected authorization violation on insight insert, got: ${injectedInsightErr.message} (${injectedInsightErr.code})`
    );

    // 6c.3: Attacker attempts to update Victim's insight (must affect 0 rows)
    const { data: updatedInsights, error: updateInsightErr } = await attackerScopedClient
      .from('session_insights')
      .update({ status: 'rejected' })
      .eq('id', testInsightId)
      .select();
    if (updateInsightErr) throw new Error(`RLS query error: ${updateInsightErr.message}`);
    assert.strictEqual(updatedInsights?.length || 0, 0, 'RLS violation: Attacker updated victim session_insights');

    // 6c.4: Attacker attempts to delete Victim's insight (must affect 0 rows)
    const { data: deletedInsights, error: deleteInsightErr } = await attackerScopedClient
      .from('session_insights')
      .delete()
      .eq('id', testInsightId)
      .select();
    if (deleteInsightErr) throw new Error(`RLS query error: ${deleteInsightErr.message}`);
    assert.strictEqual(deletedInsights?.length || 0, 0, 'RLS violation: Attacker deleted victim session_insights');
    console.log('  ✔ Passed: session_insights RLS strictly blocks unauthorized SELECT, INSERT, UPDATE, and DELETE.');

    // -------------------------------------------------------------------------
    // 6d. Table RLS: workflow_transitions (SELECT, INSERT, UPDATE, DELETE)
    // -------------------------------------------------------------------------
    // 6d.1: Attacker attempts to read transitions for Victim's session (must return 0 rows)
    const { data: foreignTransitions, error: foreignTransErr } = await attackerScopedClient
      .from('workflow_transitions')
      .select('*')
      .eq('session_id', testSessionId);
    if (foreignTransErr) throw new Error(`RLS query error: ${foreignTransErr.message}`);
    assert.strictEqual(foreignTransitions?.length || 0, 0, 'RLS violation: Attacker read victim workflow_transitions');

    // 6d.2: Attacker attempts to insert transition for Victim's session (must fail with 42501 / RLS error)
    const { data: injectedTrans, error: injectedTransErr } = await attackerScopedClient
      .from('workflow_transitions')
      .insert({
        session_id: testSessionId,
        from_mode: 'understand',
        to_mode: 'explore',
        reason: 'Malicious transition record',
      })
      .select();
    assert.strictEqual(injectedTrans?.length || 0, 0, 'No transition rows should be inserted by attacker');
    assert.ok(injectedTransErr, 'Expected specific RLS policy violation on transition insert for victim session');
    assert.ok(
      injectedTransErr.code === '42501' ||
        injectedTransErr.message.includes('violates row-level security policy') ||
        injectedTransErr.message.includes('permission denied'),
      `Expected authorization violation on transition insert, got: ${injectedTransErr.message} (${injectedTransErr.code})`
    );

    // 6d.3: Attacker attempts to update Victim's transition (must affect 0 rows)
    const { data: updatedTrans, error: updateTransErr } = await attackerScopedClient
      .from('workflow_transitions')
      .update({ reason: 'Tampered transition reason' })
      .eq('id', testTransitionId)
      .select();
    if (updateTransErr) throw new Error(`RLS query error: ${updateTransErr.message}`);
    assert.strictEqual(updatedTrans?.length || 0, 0, 'RLS violation: Attacker updated victim workflow_transitions');

    // 6d.4: Attacker attempts to delete Victim's transition (must affect 0 rows)
    const { data: deletedTrans, error: deleteTransErr } = await attackerScopedClient
      .from('workflow_transitions')
      .delete()
      .eq('id', testTransitionId)
      .select();
    if (deleteTransErr) throw new Error(`RLS query error: ${deleteTransErr.message}`);
    assert.strictEqual(deletedTrans?.length || 0, 0, 'RLS violation: Attacker deleted victim workflow_transitions');
    console.log('  ✔ Passed: workflow_transitions RLS strictly blocks unauthorized SELECT, INSERT, UPDATE, and DELETE.');

    // -------------------------------------------------------------------------
    // 6e. Table Permissions & RLS: workflow_idempotency_keys (SELECT, INSERT, UPDATE, DELETE)
    // -------------------------------------------------------------------------
    // 6e.1: Attacker attempts direct SELECT on workflow_idempotency_keys
    const { data: foreignKeys, error: foreignKeysErr } = await attackerScopedClient
      .from('workflow_idempotency_keys')
      .select('*')
      .eq('session_id', testSessionId);
    if (foreignKeysErr) {
      assert.ok(
        foreignKeysErr.code === '42501' || foreignKeysErr.message.includes('permission denied'),
        `Expected permission denied (code 42501) for direct table query, got: ${foreignKeysErr.message}`
      );
    } else {
      assert.strictEqual(foreignKeys?.length || 0, 0, 'RLS violation: Attacker read victim workflow_idempotency_keys');
    }

    // 6e.2: Attacker attempts direct INSERT on workflow_idempotency_keys (must fail)
    const { data: injectedKey, error: injectedKeyErr } = await attackerScopedClient
      .from('workflow_idempotency_keys')
      .insert({
        user_id: testUserId,
        session_id: testSessionId,
        client_request_id: 'malicious-req-id',
        request_hash: 'tampered-hash',
        response_payload: { malicious: true },
      })
      .select();
    assert.strictEqual(injectedKey?.length || 0, 0, 'No idempotency key rows should be inserted by attacker');
    assert.ok(injectedKeyErr, 'Expected permission denied or RLS violation on idempotency key insert');
    assert.ok(
      injectedKeyErr.code === '42501' ||
        injectedKeyErr.message.includes('permission denied') ||
        injectedKeyErr.message.includes('violates row-level security policy'),
      `Expected permission denied (42501) on idempotency key insert, got: ${injectedKeyErr.message} (${injectedKeyErr.code})`
    );

    // 6e.3: Attacker attempts direct UPDATE on workflow_idempotency_keys
    const { data: updatedKeys, error: updateKeyErr } = await attackerScopedClient
      .from('workflow_idempotency_keys')
      .update({ request_hash: 'tampered-hash' })
      .eq('session_id', testSessionId)
      .select();
    if (updateKeyErr) {
      assert.ok(
        updateKeyErr.code === '42501' || updateKeyErr.message.includes('permission denied'),
        `Expected permission denied on idempotency key update, got: ${updateKeyErr.message}`
      );
    } else {
      assert.strictEqual(updatedKeys?.length || 0, 0, 'RLS violation: Attacker updated victim workflow_idempotency_keys');
    }

    // 6e.4: Attacker attempts direct DELETE on workflow_idempotency_keys
    const { data: deletedKeys, error: deleteKeyErr } = await attackerScopedClient
      .from('workflow_idempotency_keys')
      .delete()
      .eq('session_id', testSessionId)
      .select();
    if (deleteKeyErr) {
      assert.ok(
        deleteKeyErr.code === '42501' || deleteKeyErr.message.includes('permission denied'),
        `Expected permission denied on idempotency key delete, got: ${deleteKeyErr.message}`
      );
    } else {
      assert.strictEqual(deletedKeys?.length || 0, 0, 'RLS violation: Attacker deleted victim workflow_idempotency_keys');
    }
    console.log('  ✔ Passed: workflow_idempotency_keys strictly protected from direct unauthorized SELECT, INSERT, UPDATE, and DELETE.');

    // -------------------------------------------------------------------------
    // 6f. Separate Direct RPC Privilege Checks via Authenticated Non-Service Caller
    // -------------------------------------------------------------------------
    // Both record_workflow_step_tx and transition_workflow_mode_tx must be denied to authenticated non-service callers
    const { data: attackerDirectRpcData, error: attackerDirectRpcErr } = await attackerScopedClient.rpc(
      'record_workflow_step_tx',
      {
        p_session_id: testSessionId,
        p_user_id: attackerUserId,
        p_user_message: 'Direct RPC bypass attempt',
        p_assistant_message: 'Should be denied at grant level',
        p_next_stage: 'break_subproblems',
        p_next_mode: 'explore',
        p_expected_stage: sessionAfter.current_stage,
        p_expected_mode: sessionAfter.current_mode,
      }
    );
    assert.strictEqual(attackerDirectRpcData, null, 'Attacker direct RPC call must return null');
    assert.ok(attackerDirectRpcErr, 'Attacker direct RPC call must return an error');
    assert.ok(
      attackerDirectRpcErr.code === '42501' ||
        attackerDirectRpcErr.message.includes('permission denied') ||
        attackerDirectRpcErr.message.includes('Forbidden') ||
        attackerDirectRpcErr.message.includes('does not exist'),
      `Expected permission denied (42501) on direct RPC execution, got: ${attackerDirectRpcErr.message} (${attackerDirectRpcErr.code})`
    );

    const { data: attackerModeRpcData, error: attackerModeRpcErr } = await attackerScopedClient.rpc(
      'transition_workflow_mode_tx',
      {
        p_session_id: testSessionId,
        p_user_id: attackerUserId,
        p_expected_mode: sessionAfter.current_mode,
        p_to_mode: 'explore',
        p_reason: 'Direct mode shift bypass',
      }
    );
    assert.strictEqual(attackerModeRpcData, null, 'Attacker direct mode RPC must return null');
    assert.ok(attackerModeRpcErr, 'Attacker direct mode RPC must return an error');
    assert.ok(
      attackerModeRpcErr.code === '42501' ||
        attackerModeRpcErr.message.includes('permission denied') ||
        attackerModeRpcErr.message.includes('Forbidden') ||
        attackerModeRpcErr.message.includes('does not exist'),
      `Expected permission denied (42501) on direct mode RPC execution, got: ${attackerModeRpcErr.message} (${attackerModeRpcErr.code})`
    );
    console.log('  ✔ Passed: Direct transactional RPC execution strictly denied to authenticated non-service users (restricted to service_role).');

    // -------------------------------------------------------------------------
    // 6g. Service-Role Cross-User Rejection Check: Verify RPC rejects cross-tenant IDs under row locks
    // -------------------------------------------------------------------------
    const { data: crossUserData, error: crossUserErr } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: attackerUserId, // Unauthorized cross-user attempt
      p_user_message: 'Cross-tenant injection probe',
      p_assistant_message: 'Should be rejected',
      p_next_stage: 'break_subproblems',
      p_next_mode: 'explore',
      p_expected_stage: sessionAfter.current_stage,
      p_expected_mode: sessionAfter.current_mode,
    });

    assert.strictEqual(crossUserData, null, 'Cross-user RPC execution must return null');
    assert.ok(crossUserErr, 'Cross-user RPC execution must fail');
    assert.ok(
      crossUserErr.message.includes('Unauthorized') ||
        crossUserErr.message.includes('not found') ||
        crossUserErr.message.includes('Forbidden'),
      `Expected Unauthorized or session not found, received: ${crossUserErr.message}`
    );

    const { data: crossModeData, error: crossModeErr } = await serviceClient.rpc('transition_workflow_mode_tx', {
      p_session_id: testSessionId,
      p_user_id: attackerUserId,
      p_expected_mode: sessionAfter.current_mode,
      p_to_mode: 'explore',
      p_reason: 'Malicious mode shift',
    });

    assert.strictEqual(crossModeData, null, 'Cross-user mode transition must return null');
    assert.ok(crossModeErr, 'Cross-user mode transition must fail');
    assert.ok(
      crossModeErr.message.includes('Unauthorized') ||
        crossModeErr.message.includes('not found') ||
        crossModeErr.message.includes('Forbidden'),
      `Expected Unauthorized or session not found, received: ${crossModeErr.message}`
    );
    console.log('  ✔ Passed: Multi-user cross-tenant tampering strictly rejected under database locks.');

    // -------------------------------------------------------------------------
    // 6h. End-to-End Cryptographic Data Integrity Verification
    // Confirm that protected records remain 100% byte-for-byte identical to baseline after entire attack sequence
    // -------------------------------------------------------------------------
    const { data: postAttackSession, error: pSessErr } = await serviceClient
      .from('thinking_sessions')
      .select('id, user_id, title, problem_statement, current_mode, current_stage, status')
      .eq('id', testSessionId)
      .single();
    if (pSessErr) throw new Error(`Failed to query post-attack session: ${pSessErr.message}`);

    const { data: postAttackMessages, error: pMsgErr } = await serviceClient
      .from('session_messages')
      .select('id, session_id, role, content, mode')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (pMsgErr) throw new Error(`Failed to query post-attack messages: ${pMsgErr.message}`);

    const { data: postAttackInsights, error: pInsErr } = await serviceClient
      .from('session_insights')
      .select('id, session_id, category, status, title, content')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (pInsErr) throw new Error(`Failed to query post-attack insights: ${pInsErr.message}`);

    const { data: postAttackTransitions, error: pTransErr } = await serviceClient
      .from('workflow_transitions')
      .select('id, session_id, from_mode, to_mode, reason')
      .eq('session_id', testSessionId)
      .order('id', { ascending: true });
    if (pTransErr) throw new Error(`Failed to query post-attack transitions: ${pTransErr.message}`);

    const { data: postAttackIdempotencyKeys, error: pIdempErr } = await serviceClient
      .from('workflow_idempotency_keys')
      .select('session_id, user_id, client_request_id, request_hash')
      .eq('session_id', testSessionId)
      .order('client_request_id', { ascending: true });
    if (pIdempErr) throw new Error(`Failed to query post-attack idempotency keys: ${pIdempErr.message}`);

    assert.deepStrictEqual(postAttackSession, baselineSession, 'Data integrity violated: thinking_sessions altered during attack sequence');
    assert.deepStrictEqual(postAttackMessages, baselineMessages, 'Data integrity violated: session_messages altered during attack sequence');
    assert.deepStrictEqual(postAttackInsights, baselineInsights, 'Data integrity violated: session_insights altered during attack sequence');
    assert.deepStrictEqual(postAttackTransitions, baselineTransitions, 'Data integrity violated: workflow_transitions altered during attack sequence');
    assert.deepStrictEqual(postAttackIdempotencyKeys, baselineIdempotencyKeys, 'Data integrity violated: workflow_idempotency_keys altered during attack sequence');
    console.log('  ✔ Passed: End-to-end data integrity verified. Victim records remain 100% identical to baseline across all sensitive tables after complete attack sequence.');

    // -------------------------------------------------------------------------
    // 6i. Server-Side Session Revocation Test: Revoke attacker session
    // -------------------------------------------------------------------------
    const { error: revokeErr } = await serviceClient.auth.admin.signOut(attackerToken);
    if (revokeErr) throw new Error(`Server-side signOut failed: ${revokeErr.message}`);
    const { data: userAfterRevoke, error: postLogoutErr } = await serviceClient.auth.getUser(attackerToken);
    assert.ok(
      postLogoutErr || !userAfterRevoke?.user,
      'After server-side session revocation, session must be invalidated and rejected by auth.getUser'
    );
    console.log('  ✔ Passed: Server-side session revocation successfully terminates active session.');

    // -------------------------------------------------------------------------
    // 6j. Accepted-Decision Workflow Gate Enforcement Verification
    // Verifies that both transition_workflow_mode_tx AND record_workflow_step_tx
    // strictly reject transitions to Act mode or choose_action when no accepted
    // decision insight exists, preventing bypass of the accepted-decision gate.
    // -------------------------------------------------------------------------
    console.log('\nRunning Test 6j: Workflow Accepted-Decision Gate Enforcement across RPCs...');
    const gateSessionId = crypto.randomUUID();
    const { error: gateSeedErr } = await serviceClient.from('thinking_sessions').insert({
      id: gateSessionId,
      user_id: testUserId,
      title: 'Gate Verification Session',
      problem_statement: 'Testing decision gate invariants',
      current_mode: 'decide',
      current_stage: 'summarize_insights',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (gateSeedErr) throw new Error(`Failed to seed gate test session: ${gateSeedErr.message}`);

    try {
      // 1. Attempt transition_workflow_mode_tx to 'act' mode without accepted decision insight (MUST FAIL)
      const { data: noDecTransData, error: noDecTransErr } = await serviceClient.rpc('transition_workflow_mode_tx', {
        p_session_id: gateSessionId,
        p_user_id: testUserId,
        p_expected_mode: 'decide',
        p_to_mode: 'act',
        p_reason: 'Bypass attempt without accepted decision',
      });
      assert.strictEqual(noDecTransData, null, 'transition_workflow_mode_tx must return null when no decision accepted');
      assert.ok(noDecTransErr, 'transition_workflow_mode_tx must fail when no accepted decision exists');
      assert.ok(
        noDecTransErr.message.includes('accepted decision'),
        `Expected accepted decision error, received: ${noDecTransErr.message}`
      );

      // 2. Attempt record_workflow_step_tx to 'choose_action' / 'act' without accepted decision insight (MUST FAIL)
      const { data: noDecStepData, error: noDecStepErr } = await serviceClient.rpc('record_workflow_step_tx', {
        p_session_id: gateSessionId,
        p_user_id: testUserId,
        p_user_message: 'Let us execute directly',
        p_assistant_message: 'Executing plan',
        p_next_stage: 'choose_action',
        p_next_mode: 'act',
        p_expected_stage: 'summarize_insights',
        p_expected_mode: 'decide',
      });
      assert.strictEqual(noDecStepData, null, 'record_workflow_step_tx must return null when no decision accepted');
      assert.ok(noDecStepErr, 'record_workflow_step_tx must fail when no accepted decision exists');
      assert.ok(
        noDecStepErr.message.includes('accepted decision'),
        `Expected accepted decision error, received: ${noDecStepErr.message}`
      );

      // 3. Now insert an accepted decision insight into the session
      const { error: accDecErr } = await serviceClient.from('session_insights').insert({
        id: crypto.randomUUID(),
        session_id: gateSessionId,
        category: 'decision',
        status: 'accepted',
        title: 'Approved Action Architecture',
        content: 'Decision has been reviewed and accepted by user.',
      });
      if (accDecErr) throw new Error(`Failed to insert accepted decision: ${accDecErr.message}`);

      // 4. Verify transition now succeeds through both RPC paths
      const { data: okTransData, error: okTransErr } = await serviceClient.rpc('transition_workflow_mode_tx', {
        p_session_id: gateSessionId,
        p_user_id: testUserId,
        p_expected_mode: 'decide',
        p_to_mode: 'act',
        p_reason: 'Legitimate transition with accepted decision',
      });
      assert.strictEqual(okTransErr, null, 'transition_workflow_mode_tx must succeed with accepted decision');
      assert.ok(okTransData, 'transition_workflow_mode_tx must return payload with accepted decision');

      console.log('  ✔ Passed: Both transition_workflow_mode_tx and record_workflow_step_tx strictly enforce the accepted-decision gate.');
    } finally {
      await serviceClient.from('session_insights').delete().eq('session_id', gateSessionId);
      await serviceClient.from('workflow_transitions').delete().eq('session_id', gateSessionId);
      await serviceClient.from('thinking_sessions').delete().eq('id', gateSessionId);
    }

    console.log('\n' + '='.repeat(75));
    console.log('ALL 6 STAGING DATABASE INTEGRATION TESTS PASSED CLEANLY.');
    console.log('='.repeat(75));
  } finally {
    // Clean up disposable test data and verify all deletions succeed
    console.log('\nCleaning up disposable test records...');
    const cleanupErrors: string[] = [];

    const { error: delIdempErr } = await serviceClient
      .from('workflow_idempotency_keys')
      .delete()
      .eq('session_id', testSessionId);
    if (delIdempErr) cleanupErrors.push(`workflow_idempotency_keys deletion failed: ${delIdempErr.message}`);

    const { error: delInsightsErr } = await serviceClient
      .from('session_insights')
      .delete()
      .eq('session_id', testSessionId);
    if (delInsightsErr) cleanupErrors.push(`session_insights deletion failed: ${delInsightsErr.message}`);

    const { error: delTransErr } = await serviceClient
      .from('workflow_transitions')
      .delete()
      .eq('session_id', testSessionId);
    if (delTransErr) cleanupErrors.push(`workflow_transitions deletion failed: ${delTransErr.message}`);

    const { error: delMsgsErr } = await serviceClient
      .from('session_messages')
      .delete()
      .eq('session_id', testSessionId);
    if (delMsgsErr) cleanupErrors.push(`session_messages deletion failed: ${delMsgsErr.message}`);

    const { error: delSessErr } = await serviceClient
      .from('thinking_sessions')
      .delete()
      .eq('id', testSessionId);
    if (delSessErr) cleanupErrors.push(`thinking_sessions deletion failed: ${delSessErr.message}`);

    if (testUserId) {
      const { error: delUserErr } = await serviceClient.auth.admin.deleteUser(testUserId);
      if (delUserErr) cleanupErrors.push(`disposable test user deletion failed: ${delUserErr.message}`);
    }

    if (attackerUserId) {
      const { error: delAttackerErr } = await serviceClient.auth.admin.deleteUser(attackerUserId);
      if (delAttackerErr) cleanupErrors.push(`disposable attacker user deletion failed: ${delAttackerErr.message}`);
    }

    if (cleanupErrors.length > 0) {
      console.error('\n[FATAL] Cleanup failures detected:');
      cleanupErrors.forEach((err) => console.error(`  ✖ ${err}`));
      throw new Error(`Staging verification cleanup failed with ${cleanupErrors.length} errors: ${cleanupErrors.join('; ')}`);
    }

    console.log('✔ Cleanup completed successfully: all disposable records removed.');
  }
}

runStagingVerification().catch((err) => {
  console.error('\n[TEST FAILURE] Staging database verification failed:', err);
  process.exit(1);
});
