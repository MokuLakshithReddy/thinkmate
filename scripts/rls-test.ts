import { createClient, SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function asUser(url: string, key: string, email: string, pass: string): Promise<SupabaseClient> {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error) {
    // Sanitize error: never log passwords or auth payload
    throw new Error(`Authentication failed for test identity: ${error.message}`);
  }
  return c;
}

export async function runRlsTests() {
  console.log('=== ThinkMate PostgreSQL RLS Isolation Verification ===');

  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const emailA = requireEnv('TEST_A_EMAIL');
  const passA = requireEnv('TEST_A_PASS');
  const emailB = requireEnv('TEST_B_EMAIL');
  const passB = requireEnv('TEST_B_PASS');

  // Verify accounts are distinct
  if (emailA.toLowerCase() === emailB.toLowerCase()) {
    throw new Error('TEST_A_EMAIL and TEST_B_EMAIL must represent distinct test identities');
  }

  console.log('Authenticating test identities...');
  const a = await asUser(url, key, emailA, passA);
  const b = await asUser(url, key, emailB, passB);

  const { data: { user: ua } } = await a.auth.getUser();
  const { data: { user: ub } } = await b.auth.getUser();

  if (!ua || !ub) {
    throw new Error('Failed to retrieve user profiles for authenticated sessions');
  }

  if (ua.id === ub.id) {
    throw new Error(`Identity collision: Both test accounts resolved to identical UID ${ua.id}`);
  }

  console.log(`Test identities verified: User A (${ua.id}) vs User B (${ub.id})`);

  let workspaceAId: string | null = null;
  let workspaceBId: string | null = null;

  try {
    // 1. User A creates private workspace and child records
    console.log('[Test 1] User A provisions workspace and child domain records...');
    const { data: wsA, error: wsAErr } = await a
      .from('tm_workspaces')
      .insert({ owner_id: ua.id, title: 'Secret Project A' })
      .select()
      .single();

    if (wsAErr || !wsA) {
      throw new Error(`User A workspace creation failed: ${wsAErr?.message}`);
    }
    workspaceAId = wsA.id;

    // User A inserts item
    const { data: itemA, error: itemAErr } = await a
      .from('tm_items')
      .insert({
        workspace_id: wsA.id,
        kind: 'claim',
        text: 'Confidential Claim A',
        origin: 'user',
        status: 'confirmed',
      })
      .select()
      .single();
    if (itemAErr || !itemA) throw new Error(`User A item insertion failed: ${itemAErr?.message}`);

    // User A inserts frame
    const { error: frameAErr } = await a
      .from('tm_frames')
      .insert({
        workspace_id: wsA.id,
        statement: 'Confidential Frame A',
        version: 1,
      });
    if (frameAErr) throw new Error(`User A frame insertion failed: ${frameAErr.message}`);

    // User A inserts evidence
    const { error: evAErr } = await a
      .from('tm_evidence')
      .insert({
        workspace_id: wsA.id,
        kind: 'observation',
        title: 'Confidential Evidence A',
        summary: 'Secret findings',
        limitations: [],
        added_by: 'user',
      });
    if (evAErr) throw new Error(`User A evidence insertion failed: ${evAErr.message}`);

    // User A inserts decision
    const { error: decAErr } = await a
      .from('tm_decisions')
      .insert({
        workspace_id: wsA.id,
        selected_item_id: itemA.id,
        rationale: 'Strategic choice verified by user A',
      });
    if (decAErr) throw new Error(`User A decision insertion failed: ${decAErr.message}`);

    // 2. User A can read their own records
    console.log('[Test 2] Verify User A can read own workspace and records...');
    const { data: ownWs } = await a.from('tm_workspaces').select('id, title').eq('id', wsA.id).single();
    if (!ownWs || ownWs.title !== 'Secret Project A') {
      throw new Error('RLS Failure: User A cannot read their own workspace');
    }

    // 3. User B creates their own workspace
    console.log('[Test 3] User B provisions independent workspace...');
    const { data: wsB, error: wsBErr } = await b
      .from('tm_workspaces')
      .insert({ owner_id: ub.id, title: 'Project B' })
      .select()
      .single();
    if (wsBErr || !wsB) throw new Error(`User B workspace creation failed: ${wsBErr?.message}`);
    workspaceBId = wsB.id;

    // 4. Cross-User Reads (User B cannot read User A's workspace or child records)
    console.log('[Test 4] Assert User B cannot read User A records...');
    const { data: readWs } = await b.from('tm_workspaces').select('id').eq('id', wsA.id);
    if ((readWs ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A workspace');
    }

    const { data: readItems } = await b.from('tm_items').select('id').eq('workspace_id', wsA.id);
    if ((readItems ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A items');
    }

    const { data: readFrames } = await b.from('tm_frames').select('id').eq('workspace_id', wsA.id);
    if ((readFrames ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A frames');
    }

    const { data: readEvidence } = await b.from('tm_evidence').select('id').eq('workspace_id', wsA.id);
    if ((readEvidence ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A evidence');
    }

    const { data: readDecisions } = await b.from('tm_decisions').select('id').eq('workspace_id', wsA.id);
    if ((readDecisions ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A decisions');
    }

    // 5. Cross-User Mutation & IDOR (User B cannot modify or inject into User A's workspace)
    console.log('[Test 5] Assert User B cannot mutate User A records...');
    const { error: injectItemErr } = await b
      .from('tm_items')
      .insert({
        workspace_id: wsA.id,
        kind: 'claim',
        text: 'Malicious Injected Item',
        origin: 'user',
      });
    if (!injectItemErr) {
      throw new Error('RLS VIOLATION: User B successfully injected item into User A workspace');
    }

    const { data: updateWsData } = await b
      .from('tm_workspaces')
      .update({ title: 'Hacked by B' })
      .eq('id', wsA.id)
      .select();
    if ((updateWsData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A workspace title');
    }

    // 6. Cross-User Deletion (User B cannot delete User A's workspace)
    console.log('[Test 6] Assert User B cannot delete User A records...');
    await b.from('tm_workspaces').delete().eq('id', wsA.id);

    // Verify User A workspace is still intact
    const { data: intactWs } = await a.from('tm_workspaces').select('id, title').eq('id', wsA.id).single();
    if (!intactWs || intactWs.title !== 'Secret Project A') {
      throw new Error('RLS VIOLATION: User A workspace was modified or deleted by User B');
    }

    // 7. Identity Forgery (User B cannot insert workspace claiming User A is owner)
    console.log('[Test 7] Assert User B cannot forge ownership claims...');
    const { error: forgeErr } = await b
      .from('tm_workspaces')
      .insert({ owner_id: ua.id, title: 'Forged Owner Workspace' });
    if (!forgeErr) {
      throw new Error('RLS VIOLATION: User B successfully created a workspace owned by User A');
    }

    console.log('All PostgreSQL RLS isolation checks passed successfully.');
  } finally {
    // Guaranteed cleanup for test-created records
    console.log('Cleaning up test-created workspaces...');
    if (workspaceAId) {
      const { error: delAErr } = await a.from('tm_workspaces').delete().eq('id', workspaceAId);
      if (delAErr) console.warn('Warning: Failed to clean up User A workspace:', delAErr.message);
    }
    if (workspaceBId) {
      const { error: delBErr } = await b.from('tm_workspaces').delete().eq('id', workspaceBId);
      if (delBErr) console.warn('Warning: Failed to clean up User B workspace:', delBErr.message);
    }
  }
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  runRlsTests()
    .then(() => {
      console.log('RLS audit complete: real database user isolation verified.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('RLS Test Failure:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
