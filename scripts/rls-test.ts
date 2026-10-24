import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function asUser(email: string, pass: string) {
  const c = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  return c;
}

async function main() {
  const emailA = process.env.TEST_A_EMAIL || 'staging-e2e-tester@thinkmate.dev';
  const passA = process.env.TEST_A_PASS || 'StagingTestPassword123!';
  const emailB = process.env.TEST_B_EMAIL || 'test-user-b@thinkmate.dev';
  const passB = process.env.TEST_B_PASS || 'StagingTestPassword123!';

  console.log(`Testing RLS between ${emailA} and ${emailB}...`);

  const a = await asUser(emailA, passA);
  const b = await asUser(emailB, passB);

  const { data: { user: ua } } = await a.auth.getUser();
  const { data: ws, error: wsErr } = await a.from('tm_workspaces').insert({ owner_id: ua!.id, title: 'Secret Project A' }).select().single();
  if (wsErr || !ws) throw new Error(`Could not create workspace: ${wsErr?.message}`);

  await a.from('tm_items').insert({
    workspace_id: ws.id,
    kind: 'claim',
    text: 'Confidential claim A',
    origin: 'user',
    status: 'confirmed'
  });

  const readWs = await b.from('tm_workspaces').select('id').eq('id', ws.id);
  const readItems = await b.from('tm_items').select('id').eq('workspace_id', ws.id);
  const writeItem = await b.from('tm_items').insert({
    workspace_id: ws.id,
    kind: 'claim',
    text: 'Intrusion claim',
    origin: 'user'
  });
  const updWs = await b.from('tm_workspaces').update({ title: 'Hacked title' }).eq('id', ws.id).select();
  const forge = await b.from('tm_workspaces').insert({ owner_id: ua!.id, title: 'Forged workspace' });

  // Extended domain tests (frames, evidence, decisions)
  const readFrames = await b.from('tm_frames').select('id').eq('workspace_id', ws.id);
  const readEvidence = await b.from('tm_evidence').select('id').eq('workspace_id', ws.id);
  const readDecisions = await b.from('tm_decisions').select('id').eq('workspace_id', ws.id);

  const results = {
    cannotReadWorkspace: readWs.data?.length === 0,
    cannotReadItems: readItems.data?.length === 0,
    cannotWriteItem: !!writeItem.error,
    cannotUpdate: (updWs.data?.length ?? 0) === 0,
    cannotForgeOwner: !!forge.error,
    cannotReadFrames: readFrames.data?.length === 0,
    cannotReadEvidence: readEvidence.data?.length === 0,
    cannotReadDecisions: readDecisions.data?.length === 0,
  };

  console.log('RLS Test Results:', results);

  // Clean up
  await a.from('tm_workspaces').delete().eq('id', ws.id);

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    console.error('One or more RLS assertions failed!');
    process.exit(1);
  }
  console.log('All RLS tests passed: isolation verified.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
