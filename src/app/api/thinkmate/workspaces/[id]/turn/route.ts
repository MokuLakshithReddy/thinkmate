import { NextResponse } from 'next/server';
import { authed, unauthorized } from '@/lib/thinkmate/auth';
import { TurnInput } from '@/lib/thinkmate/schemas';
import {
  loadState,
  ctxFrom,
  toContent,
  questionStreak,
  applyModelOutput,
  logEvent,
  DIRECT,
  pickAction,
} from '@/lib/thinkmate/state';
import { buildSystemPrompt } from '@/lib/thinkmate/prompts';
import { runTurn } from '@/lib/thinkmate/llm';
import { flags } from '@/lib/thinkmate/flags';
import { relevantIds } from '@/lib/thinkmate/retrieval';
import { safeErr } from '@/lib/thinkmate/log';
import { checkRateLimitAsync, createRateLimitErrorResponse } from '@/lib/rate-limiter';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await authed();
  if (!a) return unauthorized();
  const { sb } = a;

  // 1. User-scoped distributed per-minute rate limit (burst protection)
  const rateCheck = await checkRateLimitAsync(`rate_limit:turn:${a.user.id}`, 20, 60000);
  if (!rateCheck.allowed) {
    return createRateLimitErrorResponse(
      rateCheck,
      'Rate limit exceeded: too many turns in a short period. Please wait a minute before retrying.'
    );
  }

  // 2. Atomic daily quota check & reservation (prevents boundary race conditions under concurrency)
  const dailyLimit = Number(process.env.TM_DAILY_TURNS ?? 300);
  try {
    const { data: reserveData, error: reserveErr } = await sb.rpc('tm_reserve_turn_quota', {
      p_workspace_id: id,
      p_daily_limit: dailyLimit,
    });

    if (!reserveErr && reserveData) {
      if (!reserveData.allowed) {
        return NextResponse.json({ error: 'daily_cap' }, { status: 429 });
      }
    } else {
      // Fallback for environments where migration 008 is not yet applied
      const { data: used, error: quotaErr } = await sb.rpc('tm_turns_last_day');
      if (quotaErr) {
        if (process.env.NODE_ENV === 'production') {
          return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
        }
      } else if ((used ?? 0) >= dailyLimit) {
        return NextResponse.json({ error: 'daily_cap' }, { status: 429 });
      }
    }
  } catch {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'quota_service_unavailable' }, { status: 503 });
    }
  }

  const rawJson = await req.json().catch(() => null);
  const body = TurnInput.safeParse(rawJson);
  if (!body.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const state = await loadState(sb, id);
  if (!state) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Idempotency: duplicate submit protection (Layer 8)
  if (body.data.client_msg_id) {
    const existing = state.messages.find(
      (m) => m.client_msg_id === body.data.client_msg_id
    );
    if (existing) {
      return NextResponse.json(state);
    }
  }

  if (state.messages.length > 160) {
    return NextResponse.json({ error: 'turn_cap' }, { status: 429 });
  }

  const streak = questionStreak(state.messages);
  const action = flags.stages
    ? pickAction(state, body.data.message)
    : !state.ws.problem_frame_confirmed
    ? 'ask'
    : streak >= 3
    ? 'hint'
    : 'ask';

  // Retrieval for long workspaces (Layer 4)
  const confirmedCount = state.items.filter((i) => i.status === 'confirmed').length;
  const allowedItemIds = await relevantIds(sb, id, body.data.message, confirmedCount);

  const system = buildSystemPrompt({
    ...ctxFrom(state, allowedItemIds),
    stage: state.ws.stage ?? 'orient',
    action,
    questionStreak: streak,
    forceNonQuestion: streak >= 3,
  });

  const history = [
    ...state.messages.slice(-8).map(toContent),
    { role: 'user' as const, parts: [{ text: body.data.message }] },
  ];

  if (DIRECT.test(body.data.message)) {
    await logEvent(sb, id, 'direct_request', {});
  }

  const t0 = Date.now();
  let output;
  let tokens: number | undefined;
  try {
    const res = await runTurn(system, history);
    output = res.output;
    tokens = res.tokens;
  } catch (e) {
    await logEvent(sb, id, 'model_error', { message: safeErr(e) }, { required: false });
    return NextResponse.json({ error: 'model_failed' }, { status: 502 });
  }

  try {
    const updated = await applyModelOutput(
      sb,
      id,
      body.data.message,
      output,
      Date.now() - t0,
      action,
      tokens,
      body.data.client_msg_id,
      a.user.id
    );
    return NextResponse.json(updated);
  } catch (e) {
    await logEvent(sb, id, 'persistence_error', { message: safeErr(e) }, { required: false });
    return NextResponse.json(
      { error: 'persistence_failed' },
      { status: 500 }
    );
  }
}
