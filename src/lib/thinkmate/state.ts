import type { SupabaseClient } from '@supabase/supabase-js';
import type { ModelOutput } from './schemas';
import { chooseAction, type Signals } from './policy';
import type { Stage } from './stages';

export interface WorkspaceRow {
  id: string;
  owner_id: string;
  title: string;
  mode: 'guide' | 'balanced' | 'ideas';
  stage: Stage;
  problem_frame: string | null;
  problem_frame_confirmed: boolean;
  proposed_problem_frame: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: string;
  workspace_id: string;
  kind: 'claim' | 'hypothesis' | 'idea' | 'counterargument' | 'experiment' | 'question';
  text: string;
  origin: 'user' | 'ai';
  status: 'proposed' | 'confirmed' | 'rejected';
  verification?: 'unassessed' | 'supported' | 'contradicted' | 'mixed';
  superseded_by?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  embedding?: number[] | null;
}

export interface MessageRow {
  id: string;
  seq: number;
  workspace_id: string;
  role: 'user' | 'assistant';
  content: string;
  guidance_mode?: string | null;
  policy_action?: string | null;
  client_msg_id?: string | null;
  created_at: string;
}

export interface EvidenceRow {
  id: string;
  workspace_id: string;
  kind: 'observation' | 'interview' | 'document' | 'dataset' | 'experiment' | 'web_source';
  title: string;
  source_ref?: string | null;
  summary: string;
  limitations: string[];
  added_by: 'user' | 'research';
  meta?: Record<string, unknown>;
  created_by?: string;
  created_at: string;
}

export interface ItemEvidenceRow {
  item_id: string;
  evidence_id: string;
  workspace_id: string;
  relation: 'supports' | 'contradicts' | 'context';
}

export interface DecisionRow {
  id: string;
  workspace_id: string;
  selected_item_id: string;
  rationale: string;
  rejected_item_ids: string[];
  reconsider_if?: string | null;
  created_by?: string;
  created_at: string;
}

export interface FrameRow {
  id: string;
  workspace_id: string;
  version: number;
  statement: string;
  stakeholders: string[];
  scope?: string | null;
  supersedes_id?: string | null;
  created_by?: string;
  created_at: string;
}

export interface State {
  ws: WorkspaceRow;
  items: ItemRow[];
  messages: MessageRow[];
  links: ItemEvidenceRow[];
  decisions: DecisionRow[];
  frames: FrameRow[];
  evidence: EvidenceRow[];
}

export async function loadState(sb: SupabaseClient, id: string): Promise<State | null> {
  const { data: ws, error: wsErr } = await sb.from('tm_workspaces').select('*').eq('id', id).maybeSingle();
  if (wsErr) {
    throw new Error(`Failed to load workspace ${id}: ${wsErr.message}`);
  }
  if (!ws) return null;

  const [items, messages, links, decisions, frames, evidence] = await Promise.all([
    sb.from('tm_items').select('*').eq('workspace_id', id).order('created_at'),
    sb.from('tm_messages').select('*').eq('workspace_id', id).order('seq'),
    sb.from('tm_item_evidence').select('*').eq('workspace_id', id),
    sb.from('tm_decisions').select('*').eq('workspace_id', id),
    sb.from('tm_frames').select('*').eq('workspace_id', id).order('version'),
    sb.from('tm_evidence').select('*').eq('workspace_id', id).order('created_at'),
  ]);

  if (items.error) throw new Error(`Failed to load items for workspace ${id}: ${items.error.message}`);
  if (messages.error) throw new Error(`Failed to load messages for workspace ${id}: ${messages.error.message}`);
  if (links.error) throw new Error(`Failed to load item evidence links for workspace ${id}: ${links.error.message}`);
  if (decisions.error) throw new Error(`Failed to load decisions for workspace ${id}: ${decisions.error.message}`);
  if (frames.error) throw new Error(`Failed to load frames for workspace ${id}: ${frames.error.message}`);
  if (evidence.error) throw new Error(`Failed to load evidence for workspace ${id}: ${evidence.error.message}`);

  return {
    ws: ws as WorkspaceRow,
    items: (items.data ?? []) as ItemRow[],
    messages: (messages.data ?? []) as MessageRow[],
    links: (links.data ?? []) as ItemEvidenceRow[],
    decisions: (decisions.data ?? []) as DecisionRow[],
    frames: (frames.data ?? []) as FrameRow[],
    evidence: (evidence.data ?? []) as EvidenceRow[],
  };
}

export async function logEvent(
  sb: SupabaseClient,
  id: string,
  event_type: string,
  payload: Record<string, unknown> = {},
  options: { required?: boolean } = { required: true }
) {
  const { error } = await sb.from('tm_events').insert({ workspace_id: id, event_type, payload });
  if (error) {
    const msg = `Failed to log audit event '${event_type}' for workspace ${id}: ${error.message}`;
    if (options.required) {
      throw new Error(msg);
    }
    console.warn(`[Audit Event Warning]: ${msg}`);
  }
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
      .filter((i: ItemRow) => {
        if (i.status !== status) return false;
        if (kind && i.kind !== kind) return false;
        if (allowedItemIds && status === 'confirmed' && !allowedItemIds.has(i.id)) return false;
        return true;
      })
      .map((i: ItemRow) => i.text);

  const evidence = s.evidence.map(
    (e: EvidenceRow) => `${e.title}: ${String(e.summary || '').slice(0, 200)}`
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
  const items = s.items;
  const conf = items.filter((i) => i.status === 'confirmed');
  const linked = new Set(s.links.map((l) => l.item_id));
  const assistants = s.messages.filter((m) => m.role === 'assistant');

  let since = 0;
  for (let i = assistants.length - 1; i >= 0 && assistants[i].policy_action !== 'summarize'; i--) {
    since++;
  }

  const prevUser = [...s.messages].reverse().find((m) => m.role === 'user');

  return {
    mode: s.ws.mode,
    stage: s.ws.stage,
    directRequest: DIRECT.test(message),
    frameConfirmed: s.ws.problem_frame_confirmed,
    frameText: s.ws.problem_frame ?? s.ws.proposed_problem_frame,
    questionStreak: questionStreak(s.messages),
    stuck: STUCK.test(message) || (short(message) && (prevUser ? short(prevUser.content) : false)),
    unsupportedConfirmed: conf.filter(
      (i) => ['claim', 'hypothesis'].includes(i.kind) && !linked.has(i.id)
    ).length,
    ideas: conf.filter((i) => i.kind === 'idea').length,
    turnsSinceSummary: since,
    decided: s.decisions.length > 0,
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
  clientMsgId?: string,
  userId?: string
): Promise<State | null> {
  const proposedItemsPayload = out.proposed_items.map((i) => ({
    kind: i.kind,
    text: i.text,
    origin:
      i.kind === 'question'
        ? ('ai' as const)
        : i.origin === 'user' && !originLooksRight(i.text, userText)
        ? ('ai' as const)
        : i.origin,
  }));

  // 1. Transactional Database RPC Execution
  if (typeof (sb as unknown as { rpc?: unknown }).rpc === 'function') {
    const { error: rpcErr } = await sb.rpc('tm_apply_turn_tx', {
      p_workspace_id: id,
      p_user_message: userText,
      p_assistant_reply: out.reply,
      p_guidance_mode: out.guidance_mode || null,
      p_policy_action: action || null,
      p_proposed_items: proposedItemsPayload,
      p_proposed_problem_frame: out.proposed_problem_frame || null,
      p_client_msg_id: clientMsgId || null,
      p_meta: {
        user_id: userId,
        ms,
        tokens: tokens ?? 0,
      },
    });

    if (!rpcErr) {
      return loadState(sb, id);
    }

    const isMissingRpc =
      rpcErr.message.includes('function public.tm_apply_turn_tx') ||
      rpcErr.message.includes('Could not find') ||
      rpcErr.code === 'PGRST202';
    if (!isMissingRpc) {
      throw new Error(`Failed to apply turn atomically: ${rpcErr.message}`);
    }
  }

  // 2. Compensating Fallback for Offline / Mock Environments without Database RPC
  const { data: existing, error: existingErr } = await sb
    .from('tm_items')
    .select('kind,text')
    .eq('workspace_id', id);
  if (existingErr) {
    throw new Error(`Failed to load existing items: ${existingErr.message}`);
  }
  const existingRows = (existing ?? []) as { kind: string; text: string }[];
  const seen = new Set(existingRows.map((i) => i.kind + ':' + norm(i.text)));

  const rows = proposedItemsPayload
    .filter((r) => !seen.has(r.kind + ':' + norm(r.text)))
    .map((r) => ({ ...r, workspace_id: id, status: 'proposed' }));

  const { data: insertedMsgs, error: msgErr } = await sb
    .from('tm_messages')
    .insert([
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
    ])
    .select('id');

  if (msgErr) {
    throw new Error(`Failed to save turn messages: ${msgErr.message}`);
  }

  const userMsgId = insertedMsgs?.[0]?.id;
  const astMsgId = insertedMsgs?.[1]?.id;

  try {
    if (rows.length) {
      const { error: itemsErr } = await sb.from('tm_items').insert(rows);
      if (itemsErr) {
        throw new Error(`Failed to save proposed items: ${itemsErr.message}`);
      }
    }

    if (out.proposed_problem_frame) {
      const { error: frameErr } = await sb
        .from('tm_workspaces')
        .update({
          proposed_problem_frame: out.proposed_problem_frame,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (frameErr) {
        throw new Error(`Failed to update problem frame: ${frameErr.message}`);
      }
    }

    await logEvent(sb, id, 'turn', {
      user_id: userId,
      guidance_mode: out.guidance_mode,
      policy_action: action,
      proposed: rows.length,
      ms,
      tokens: tokens ?? 0,
    });
  } catch (stepErr) {
    // Compensate inserted messages so no partial turn is retained on failure
    if (userMsgId) {
      try {
        await sb.from('tm_messages').delete().eq('id', userMsgId);
      } catch {}
    }
    if (astMsgId) {
      try {
        await sb.from('tm_messages').delete().eq('id', astMsgId);
      } catch {}
    }
    throw stepErr;
  }

  return loadState(sb, id);
}
