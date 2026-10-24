import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelOutput } from './schemas';
import { chooseAction, type Signals } from './policy';

export async function loadState(sb: SupabaseClient, id: string) {
  const { data: ws } = await sb.from('tm_workspaces').select('*').eq('id', id).maybeSingle();
  if (!ws) return null;

  const [items, messages, links, decisions, frames, evidence] = await Promise.all([
    sb.from('tm_items').select('*').eq('workspace_id', id).order('created_at'),
    sb.from('tm_messages').select('*').eq('workspace_id', id).order('seq'),
    sb.from('tm_item_evidence').select('*').eq('workspace_id', id),
    sb.from('tm_decisions').select('*').eq('workspace_id', id),
    sb.from('tm_frames').select('*').eq('workspace_id', id).order('version'),
    sb.from('tm_evidence').select('*').eq('workspace_id', id).order('created_at'),
  ]);

  return {
    ws,
    items: items.data ?? [],
    messages: messages.data ?? [],
    links: links.data ?? [],
    decisions: decisions.data ?? [],
    frames: frames.data ?? [],
    evidence: evidence.data ?? [],
  };
}

export type State = NonNullable<Awaited<ReturnType<typeof loadState>>>;

export async function logEvent(
  sb: SupabaseClient,
  id: string,
  event_type: string,
  payload: Record<string, unknown> = {}
) {
  await sb.from('tm_events').insert({ workspace_id: id, event_type, payload });
}

// Consecutive trailing assistant replies that were question-only
export function questionStreak(messages: { role: string; guidance_mode?: string | null }[]): number {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    if (messages[i].guidance_mode === 'question') n++;
    else break;
  }
  return n;
}

export const toContent = (m: { role: string; content: string }) => ({
  role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
  parts: [{ text: m.content as string }],
});

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

export const words = (s: string) =>
  new Set(
    norm(s)
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

// Provenance guard: a claim labelled user must share words with what the user actually wrote
export function originLooksRight(claim: string, userText: string): boolean {
  const c = words(claim);
  const u = words(userText);
  if (c.size === 0) return false;
  let hit = 0;
  c.forEach((w) => {
    if (u.has(w)) hit++;
  });
  return hit / c.size >= 0.4;
}

export function ctxFrom(s: State, allowedItemIds?: Set<string> | null) {
  const pick = (status: string, kind?: string) =>
    s.items
      .filter((i: any) => {
        if (i.status !== status) return false;
        if (kind && i.kind !== kind) return false;
        if (allowedItemIds && status === 'confirmed' && !allowedItemIds.has(i.id)) return false;
        return true;
      })
      .map((i: any) => i.text as string);

  const evidence = (s.evidence as any[]).map(
    (e) => `${e.title}: ${String(e.summary || '').slice(0, 200)}`
  );

  return {
    mode: s.ws.mode as 'guide' | 'balanced' | 'ideas',
    stage: s.ws.stage,
    frame: s.ws.problem_frame,
    frameConfirmed: Boolean(s.ws.problem_frame_confirmed),
    confirmed: pick('confirmed'),
    rejected: pick('rejected'),
    pending: pick('proposed'),
    questions: pick('confirmed', 'question'),
    evidence,
  };
}

export const DIRECT = /just tell me|give me (an? )?(answer|idea|ideas)|what should i (build|do)/i;
const STUCK = /(don't know|do not know|not sure|stuck|no idea|idk|confused)/i;
const short = (t: string) => t.trim().split(/\s+/).length <= 4;

export function signalsFrom(s: State, message: string): Signals {
  const items = s.items as any[];
  const conf = items.filter((i) => i.status === 'confirmed');
  const linked = new Set((s.links as any[]).map((l) => l.item_id));
  const assistants = s.messages.filter((m: any) => m.role === 'assistant') as any[];

  let since = 0;
  for (let i = assistants.length - 1; i >= 0 && assistants[i].policy_action !== 'summarize'; i--) {
    since++;
  }

  const prevUser = [...s.messages].reverse().find((m: any) => m.role === 'user') as any;

  return {
    mode: s.ws.mode,
    stage: s.ws.stage,
    directRequest: DIRECT.test(message),
    frameConfirmed: s.ws.problem_frame_confirmed,
    frameText: s.ws.problem_frame ?? s.ws.proposed_problem_frame,
    questionStreak: questionStreak(s.messages as any),
    stuck: STUCK.test(message) || (short(message) && Boolean(prevUser) && short(prevUser.content)),
    unsupportedConfirmed: conf.filter(
      (i) => ['claim', 'hypothesis'].includes(i.kind) && !linked.has(i.id)
    ).length,
    ideas: conf.filter((i) => i.kind === 'idea').length,
    turnsSinceSummary: since,
    decided: (s.decisions as any[]).length > 0,
    lastAction: assistants.length ? assistants[assistants.length - 1].policy_action ?? null : null,
  };
}

export const pickAction = (s: State, message: string) => chooseAction(signalsFrom(s, message));

export async function applyModelOutput(
  sb: SupabaseClient,
  id: string,
  userText: string,
  out: ModelOutput,
  ms: number,
  action: string,
  tokens?: number,
  clientMsgId?: string
) {
  const { data: existing } = await sb.from('tm_items').select('kind,text').eq('workspace_id', id);
  const seen = new Set((existing ?? []).map((i: any) => i.kind + ':' + norm(i.text)));

  const rows = out.proposed_items
    .map((i) => ({
      kind: i.kind,
      text: i.text,
      origin:
        i.kind === 'question'
          ? 'ai'
          : i.origin === 'user' && !originLooksRight(i.text, userText)
          ? 'ai'
          : i.origin,
    }))
    .filter((r) => !seen.has(r.kind + ':' + norm(r.text)))
    .map((r) => ({ ...r, workspace_id: id, status: 'proposed' }));

  await sb.from('tm_messages').insert([
    {
      workspace_id: id,
      role: 'user',
      content: userText,
      client_msg_id: clientMsgId || null,
    },
    {
      workspace_id: id,
      role: 'assistant',
      content: out.reply,
      guidance_mode: out.guidance_mode,
      policy_action: action,
    },
  ]);

  if (rows.length) {
    await sb.from('tm_items').insert(rows);
  }

  if (out.proposed_problem_frame) {
    await sb
      .from('tm_workspaces')
      .update({
        proposed_problem_frame: out.proposed_problem_frame,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  await logEvent(sb, id, 'turn', {
    guidance_mode: out.guidance_mode,
    policy_action: action,
    proposed: rows.length,
    ms,
    tokens: tokens ?? 0,
  });

  return loadState(sb, id);
}
