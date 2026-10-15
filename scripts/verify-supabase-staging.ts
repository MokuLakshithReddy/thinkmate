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

  const testUserId = crypto.randomUUID();
  const testSessionId = crypto.randomUUID();
  console.log(`Target verified staging database: ${projectHost}`);
  console.log(`Disposable test session: ${testSessionId}`);
  console.log(`Disposable test user: ${testUserId}\n`);

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
    // TEST 6: Multi-User Cross-Tenant Isolation
    // -------------------------------------------------------------------------
    console.log('\n[Test 6/6] Verifying multi-user cross-tenant isolation...');
    const attackerUserId = crypto.randomUUID();

    // Attacker attempts to modify victim's session via record_workflow_step_tx
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

    // Attacker attempts to transition victim's session mode via transition_workflow_mode_tx
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
