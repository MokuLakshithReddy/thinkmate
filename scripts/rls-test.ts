import { createClient, SupabaseClient } from '@supabase/supabase-js';

async function asUser(url: string, key: string, email: string, pass: string): Promise<SupabaseClient> {
  const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { session }, error } = await authClient.auth.signInWithPassword({ email, password: pass });
  if (error || !session) {
    // Sanitize error: never log passwords or auth payload
    throw new Error(`Authentication failed for test identity: ${error?.message ?? 'missing session'}`);
  }
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function runRlsTests() {
  console.log('=== ThinkMate PostgreSQL RLS Isolation Verification ===');

  const url = (process.env.STAGING_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  if (!url) throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL');
  const key = (process.env.STAGING_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!key) throw new Error('Missing required environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = (process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();

  let emailA = process.env.TEST_A_EMAIL?.trim();
  let passA = process.env.TEST_A_PASS?.trim();
  let emailB = process.env.TEST_B_EMAIL?.trim();
  let passB = process.env.TEST_B_PASS?.trim();

  let adminClient: SupabaseClient | null = null;
  let ephemeralUserAId: string | null = null;
  let ephemeralUserBId: string | null = null;

  if (emailA && passA && emailB && passB) {
    // Verify accounts are distinct
    if (emailA.toLowerCase() === emailB.toLowerCase()) {
      throw new Error('TEST_A_EMAIL and TEST_B_EMAIL must represent distinct test identities');
    }
  } else if (serviceKey) {
    // Automated provisioning for staging verification workflows
    console.log('Explicit test credentials not provided; provisioning ephemeral test identities via service role...');
    adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    emailA = `rls-test-a-${suffix}@thinkmate.internal`;
    passA = `TestPassA_${suffix}!Aa1`;
    emailB = `rls-test-b-${suffix}@thinkmate.internal`;
    passB = `TestPassB_${suffix}!Bb1`;

    const resA = await adminClient.auth.admin.createUser({ email: emailA, password: passA, email_confirm: true });
    if (resA.error || !resA.data.user) {
      throw new Error(`Failed to create ephemeral User A: ${resA.error?.message}`);
    }
    ephemeralUserAId = resA.data.user.id;

    const resB = await adminClient.auth.admin.createUser({ email: emailB, password: passB, email_confirm: true });
    if (resB.error || !resB.data.user) {
      throw new Error(`Failed to create ephemeral User B: ${resB.error?.message}`);
    }
    ephemeralUserBId = resB.data.user.id;
  } else {
    throw new Error('Missing required environment variable: TEST_A_EMAIL (or SUPABASE_SERVICE_ROLE_KEY)');
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

    // User A inserts message
    const { data: msgA, error: msgAErr } = await a
      .from('tm_messages')
      .insert({
        workspace_id: wsA.id,
        role: 'user',
        content: 'Confidential Prompt from User A',
      })
      .select()
      .single();
    if (msgAErr || !msgA) throw new Error(`User A message insertion failed: ${msgAErr?.message}`);

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

    const { data: readMessages } = await b.from('tm_messages').select('id').eq('workspace_id', wsA.id);
    if ((readMessages ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A messages');
    }

    const { data: readEvents } = await b.from('tm_events').select('id').eq('workspace_id', wsA.id);
    if ((readEvents ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to read User A events');
    }

    // 5. Cross-User Mutation & IDOR (User B cannot modify or inject into User A's workspace or child tables)
    console.log('[Test 5] Assert User B cannot mutate or inject User A records...');
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

    const { error: injectFrameErr } = await b
      .from('tm_frames')
      .insert({
        workspace_id: wsA.id,
        statement: 'Malicious Frame Injected by B',
        version: 2,
      });
    if (!injectFrameErr) {
      throw new Error('RLS VIOLATION: User B successfully injected frame into User A workspace');
    }

    const { error: injectEvErr } = await b
      .from('tm_evidence')
      .insert({
        workspace_id: wsA.id,
        kind: 'observation',
        title: 'Malicious Evidence Injected by B',
        summary: 'Injected findings',
        limitations: [],
        added_by: 'user',
      });
    if (!injectEvErr) {
      throw new Error('RLS VIOLATION: User B successfully injected evidence into User A workspace');
    }

    const { error: injectDecErr } = await b
      .from('tm_decisions')
      .insert({
        workspace_id: wsA.id,
        selected_item_id: itemA.id,
        rationale: 'Malicious decision by B',
      });
    if (!injectDecErr) {
      throw new Error('RLS VIOLATION: User B successfully injected decision into User A workspace');
    }

    const { error: injectMsgErr } = await b
      .from('tm_messages')
      .insert({
        workspace_id: wsA.id,
        role: 'user',
        content: 'Malicious Injected Message',
      });
    if (!injectMsgErr) {
      throw new Error('RLS VIOLATION: User B successfully injected message into User A workspace');
    }

    // Unauthorized Updates
    const { data: updateWsData } = await b
      .from('tm_workspaces')
      .update({ title: 'Hacked by B' })
      .eq('id', wsA.id)
      .select();
    if ((updateWsData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A workspace title');
    }

    const { data: updateItemData } = await b
      .from('tm_items')
      .update({ text: 'Tampered Item Text' })
      .eq('id', itemA.id)
      .select();
    if ((updateItemData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A item');
    }

    const { data: updateFrameData } = await b
      .from('tm_frames')
      .update({ statement: 'Tampered Frame' })
      .eq('workspace_id', wsA.id)
      .select();
    if ((updateFrameData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A frame');
    }

    const { data: updateEvData } = await b
      .from('tm_evidence')
      .update({ title: 'Tampered Evidence' })
      .eq('workspace_id', wsA.id)
      .select();
    if ((updateEvData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A evidence');
    }

    const { data: updateDecData } = await b
      .from('tm_decisions')
      .update({ rationale: 'Tampered Decision' })
      .eq('workspace_id', wsA.id)
      .select();
    if ((updateDecData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A decision');
    }

    const { data: updateMsgData } = await b
      .from('tm_messages')
      .update({ content: 'Tampered Message Content' })
      .eq('id', msgA.id)
      .select();
    if ((updateMsgData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B successfully mutated User A message');
    }

    // 6. Cross-User Deletions (User B cannot delete User A records or workspace)
    console.log('[Test 6] Assert User B cannot delete User A records...');
    const { data: deleteItemData } = await b.from('tm_items').delete().eq('id', itemA.id).select();
    if ((deleteItemData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to delete User A item');
    }

    const { data: deleteEvData } = await b.from('tm_evidence').delete().eq('workspace_id', wsA.id).select();
    if ((deleteEvData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to delete User A evidence');
    }

    const { data: deleteDecData } = await b.from('tm_decisions').delete().eq('workspace_id', wsA.id).select();
    if ((deleteDecData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to delete User A decision');
    }

    const { data: deleteMsgData } = await b.from('tm_messages').delete().eq('id', msgA.id).select();
    if ((deleteMsgData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to delete User A message');
    }

    const { data: deleteWsData } = await b.from('tm_workspaces').delete().eq('id', wsA.id).select();
    if ((deleteWsData ?? []).length > 0) {
      throw new Error('RLS VIOLATION: User B was able to delete User A workspace');
    }

    // Verify User A records are completely intact
    const { data: intactWs } = await a.from('tm_workspaces').select('id, title').eq('id', wsA.id).single();
    if (!intactWs || intactWs.title !== 'Secret Project A') {
      throw new Error('RLS VIOLATION: User A workspace was modified or deleted by User B');
    }
    const { data: intactItem } = await a.from('tm_items').select('id, text').eq('id', itemA.id).single();
    if (!intactItem || intactItem.text !== 'Confidential Claim A') {
      throw new Error('RLS VIOLATION: User A item was modified or deleted by User B');
    }
    const { data: intactMsg } = await a.from('tm_messages').select('id, content').eq('id', msgA.id).single();
    if (!intactMsg || intactMsg.content !== 'Confidential Prompt from User A') {
      throw new Error('RLS VIOLATION: User A message was modified or deleted by User B');
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
    // Guaranteed, conclusively verified cleanup for test-created records
    console.log('Cleaning up test-created workspaces...');
    const cleanupFailures: string[] = [];

    if (workspaceAId) {
      const { error: delAErr } = await a.from('tm_workspaces').delete().eq('id', workspaceAId);
      if (delAErr) {
        cleanupFailures.push(`Failed to delete User A workspace (${workspaceAId}): ${delAErr.message}`);
      } else {
        const { data: checkA } = await a.from('tm_workspaces').select('id').eq('id', workspaceAId);
        if ((checkA ?? []).length > 0) {
          cleanupFailures.push(`User A workspace (${workspaceAId}) remained present after delete command`);
        }
      }
    }

    if (workspaceBId) {
      const { error: delBErr } = await b.from('tm_workspaces').delete().eq('id', workspaceBId);
      if (delBErr) {
        cleanupFailures.push(`Failed to delete User B workspace (${workspaceBId}): ${delBErr.message}`);
      } else {
        const { data: checkB } = await b.from('tm_workspaces').select('id').eq('id', workspaceBId);
        if ((checkB ?? []).length > 0) {
          cleanupFailures.push(`User B workspace (${workspaceBId}) remained present after delete command`);
        }
      }
    }

    if (cleanupFailures.length > 0) {
      const failureMsg = `CRITICAL CLEANUP FAILURE:\n${cleanupFailures.map((f) => `  - ${f}`).join('\n')}`;
      console.error(failureMsg);
      throw new Error(failureMsg);
    }
    console.log('All test-created records cleanly deleted and verified.');

    // Delete ephemeral test users if created
    if (adminClient) {
      console.log('Tearing down ephemeral test users...');
      if (ephemeralUserAId) {
        await adminClient.auth.admin.deleteUser(ephemeralUserAId).catch((err) => {
          console.error(`Warning: failed to delete ephemeral test user A: ${err}`);
        });
      }
      if (ephemeralUserBId) {
        await adminClient.auth.admin.deleteUser(ephemeralUserBId).catch((err) => {
          console.error(`Warning: failed to delete ephemeral test user B: ${err}`);
        });
      }
      console.log('Ephemeral test users purged.');
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
