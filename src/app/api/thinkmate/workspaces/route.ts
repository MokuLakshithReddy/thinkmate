import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { logEvent } from '@/lib/thinkmate/state';

export async function POST(req: Request) {
  const a = await authed();
  if (!a) return unauthorized();

  const { title } = await req.json().catch(() => ({}));
  const cleanTitle = String(title ?? 'Untitled problem').slice(0, 120);

  // 1. Try atomic RPC with transaction lock
  const { data: rpcData, error: rpcErr } = await a.sb.rpc('tm_create_workspace', {
    p_title: cleanTitle,
  });

  if (!rpcErr && rpcData) {
    if (rpcData.ok === true && rpcData.id) {
      return NextResponse.json({ id: rpcData.id });
    }
    if (rpcData.error === 'plan_limit') {
      return NextResponse.json({ error: 'plan_limit', upgrade: true }, { status: 429 });
    }
  }

  // If RPC is missing in non-production, fall back to strict fail-closed check
  if (rpcErr && (rpcErr.code === 'PGRST202' || rpcErr.message?.includes('Could not find'))) {
    const { data: usage, error: usageErr } = await a.sb.rpc('tm_my_usage');
    if (usageErr || !usage || typeof usage.workspaces_limit !== 'number') {
      console.error('[Workspaces Create] Usage lookup failed in fallback:', usageErr);
      return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
    }

    if ((usage.workspaces_used ?? 0) >= usage.workspaces_limit) {
      return NextResponse.json({ error: 'plan_limit', upgrade: true }, { status: 429 });
    }

    const { data, error } = await a.sb
      .from('tm_workspaces')
      .insert({
        owner_id: a.user.id,
        title: cleanTitle,
      })
      .select('id')
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }

    await logEvent(a.sb, data.id, 'workspace_created');
    return NextResponse.json(data);
  }

  console.error('[Workspaces Create] RPC failed:', rpcErr, rpcData);
  return NextResponse.json({ error: 'create_failed' }, { status: 500 });
}
