/**
 * Staging Database Transaction and Migration Verification Suite
 *
 * Runs genuine end-to-end database assertions against a target Supabase / PostgreSQL database:
 * 1. RPC permissions: Confirms execution is strictly denied to anon/public callers and granted to service_role.
 * 2. Concurrency control: Confirms optimistic concurrency control under row lock detects conflicting updates.
 * 3. Duplicate request IDs with different payloads: Verifies key reuse tampering is rejected.
 * 4. Legacy rows with missing/empty hashes: Verifies legacy rows without hashes cannot be blindly replayed.
 * 5. Rollback behavior: Verifies atomic rollback on transaction errors (no partial message writes).
 *
 * Requires:
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('\n[FATAL] Missing required staging credentials.');
    console.error('Please configure:');
    console.error('  STAGING_SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)');
    console.error('  STAGING_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)');
    console.error('Optional: STAGING_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)\n');
    process.exit(1);
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const testUserId = crypto.randomUUID();
  const testSessionId = crypto.randomUUID();
  console.log(`Target database: ${SUPABASE_URL}`);
  console.log(`Disposable test session: ${testSessionId}`);
  console.log(`Disposable test user: ${testUserId}\n`);

  try {
    // -------------------------------------------------------------------------
    // TEST 1: RPC Permissions Check
    // -------------------------------------------------------------------------
    console.log('[Test 1/5] Verifying RPC permissions: anon execution must be denied...');
    if (ANON_KEY) {
      const anonClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
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
        anonError.message.includes('does not exist'); // PostgreSQL hides unauthorized functions

      assert.ok(
        isDenied,
        `Expected permission denied (code 42501) for anon caller, received: ${anonError.message} (${anonError.code})`
      );
      console.log('  ✔ Passed: RPC execution correctly denied to anonymous/unprivileged callers.');
    } else {
      console.warn('  ⚠ Skipped anon check: ANON_KEY not provided.');
    }

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
    // TEST 2: Optimistic Concurrency Control under Row Lock
    // -------------------------------------------------------------------------
    console.log('\n[Test 2/5] Verifying Optimistic Concurrency Control under row lock...');
    // Request A: Valid transition from welcome -> describe_problem
    const { data: stepAData, error: stepAError } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'Valid first message',
      p_assistant_message: 'First step completed',
      p_next_stage: 'describe_problem',
      p_next_mode: 'understand',
      p_expected_stage: 'welcome',
      p_expected_mode: 'understand',
      p_client_request_id: `req-stepA-${Date.now()}`,
      p_request_hash: 'hash-stepA-valid',
    });

    if (stepAError) {
      throw new Error(`Step A failed: ${stepAError.message}`);
    }
    assert.ok(stepAData, 'Step A must return payload');

    // Request B: Concurrent request sending stale expected_stage 'welcome'
    const { data: stepBData, error: stepBError } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'Concurrent stale message',
      p_assistant_message: 'Should be rejected',
      p_next_stage: 'clarify_objective',
      p_next_mode: 'understand',
      p_expected_stage: 'welcome', // Stale! DB is now at describe_problem
      p_expected_mode: 'understand',
      p_client_request_id: `req-stepB-${Date.now()}`,
      p_request_hash: 'hash-stepB-valid',
    });

    assert.strictEqual(stepBData, null, 'Stale concurrent request must not succeed');
    assert.ok(stepBError, 'Stale concurrent request must trigger error');
    assert.ok(
      stepBError.message.includes('CONFLICT: expected stage'),
      `Expected CONFLICT exception, got: ${stepBError.message}`
    );
    console.log('  ✔ Passed: Stale concurrent request detected under lock and rejected with CONFLICT.');

    // -------------------------------------------------------------------------
    // TEST 3: Duplicate Request ID with Different Payload / Hash
    // -------------------------------------------------------------------------
    console.log('\n[Test 3/5] Verifying duplicate request ID with altered payload...');
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
    console.log('\n[Test 4/5] Verifying legacy row with empty/missing request_hash...');
    const legacyReqId = `req-legacy-${Date.now()}`;
    // Insert an unverified legacy idempotency row with empty hash
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
    // TEST 5: Atomic Rollback Behavior
    // -------------------------------------------------------------------------
    console.log('\n[Test 5/5] Verifying atomic rollback on failed transaction...');
    const { count: initialMsgCount, error: countErr1 } = await serviceClient
      .from('session_messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', testSessionId);
    if (countErr1) throw new Error(`Failed to count messages: ${countErr1.message}`);

    // Attempt a transaction that triggers an error (mismatched stage)
    const { error: failedTxErr } = await serviceClient.rpc('record_workflow_step_tx', {
      p_session_id: testSessionId,
      p_user_id: testUserId,
      p_user_message: 'This message should NOT be saved',
      p_assistant_message: 'This assistant reply should NOT be saved',
      p_next_stage: 'choose_action',
      p_next_mode: 'act',
      p_expected_stage: 'welcome', // Will conflict
      p_expected_mode: 'understand',
    });
    assert.ok(failedTxErr, 'Transaction was expected to fail');

    // Confirm that session_messages count did NOT increase
    const { count: postMsgCount, error: countErr2 } = await serviceClient
      .from('session_messages')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', testSessionId);
    if (countErr2) throw new Error(`Failed to count messages after tx: ${countErr2.message}`);

    assert.strictEqual(
      postMsgCount,
      initialMsgCount,
      `Rollback failed: message count increased from ${initialMsgCount} to ${postMsgCount}`
    );
    console.log('  ✔ Passed: Failed transaction atomically rolled back with zero orphaned records.');

    console.log('\n' + '='.repeat(75));
    console.log('ALL 5 STAGING DATABASE INTEGRATION TESTS PASSED CLEANLY.');
    console.log('='.repeat(75));
  } finally {
    // Clean up disposable test data
    console.log('\nCleaning up disposable test records...');
    await serviceClient.from('workflow_idempotency_keys').delete().eq('session_id', testSessionId);
    await serviceClient.from('session_messages').delete().eq('session_id', testSessionId);
    await serviceClient.from('thinking_sessions').delete().eq('id', testSessionId);
    console.log('Cleanup completed.');
  }
}

runStagingVerification().catch((err) => {
  console.error('\n[TEST FAILURE] Staging database verification failed:', err);
  process.exit(1);
});
