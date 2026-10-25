import { readFileSync, existsSync } from 'node:fs';

export interface PilotSessionRow {
  session_id: string;
  participant: string;
  condition: 'thinkmate' | 'ordinary' | 'socratic';
  brief: string;
  order: string;
  minutes_to_frame: string;
  completed: string;
  abandoned: string;
  would_use: string;
  named_situation: string;
  chosen_idea?: string;
}

export interface PilotScoreRow {
  session_id: string;
  scorer: string;
  p: string;
  e: string;
  i: string;
  d: string;
}

export function parseCsv<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const values = l.split(',').map((v) => v.trim());
    return Object.fromEntries(head.map((k, idx) => [k, values[idx]])) as unknown as T;
  });
}

export function validateSessions(rows: PilotSessionRow[]): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const r of rows) {
    if (!r.session_id) errors.push('Row missing session_id');
    if (seenIds.has(r.session_id)) errors.push(`Duplicate session_id: ${r.session_id}`);
    seenIds.add(r.session_id);

    if (!r.participant || !/^P\d+$/.test(r.participant)) {
      errors.push(`Invalid participant code "${r.participant}" in session ${r.session_id}. Expected format P1..P8.`);
    }

    if (!['thinkmate', 'ordinary', 'socratic'].includes(r.condition)) {
      errors.push(`Invalid condition "${r.condition}" in session ${r.session_id}.`);
    }

    const mins = parseFloat(r.minutes_to_frame);
    if (isNaN(mins) || mins <= 0 || mins > 45) {
      errors.push(`Invalid minutes_to_frame "${r.minutes_to_frame}" in session ${r.session_id}. Must be between 1 and 45.`);
    }

    if (!['y', 'n'].includes(r.completed?.toLowerCase())) {
      errors.push(`Invalid completed flag "${r.completed}" in session ${r.session_id}. Expected y/n.`);
    }

    if (!['y', 'n'].includes(r.abandoned?.toLowerCase())) {
      errors.push(`Invalid abandoned flag "${r.abandoned}" in session ${r.session_id}. Expected y/n.`);
    }

    if (!['y', 'n'].includes(r.would_use?.toLowerCase())) {
      errors.push(`Invalid would_use flag "${r.would_use}" in session ${r.session_id}. Expected y/n.`);
    }

    if (!['y', 'n'].includes(r.named_situation?.toLowerCase())) {
      errors.push(`Invalid named_situation flag "${r.named_situation}" in session ${r.session_id}. Expected y/n.`);
    }

    if (r.completed?.toLowerCase() === 'y') {
      const idea = r.chosen_idea?.trim();
      if (!idea || idea.toLowerCase() === 'none' || idea.toLowerCase() === 'n/a') {
        errors.push(
          `Completed session ${r.session_id} is missing required chosen_idea milestone (got "${r.chosen_idea ?? ''}").`
        );
      }
    }
  }

  return errors;
}

export function validateScores(rows: PilotScoreRow[]): string[] {
  const errors: string[] = [];

  for (const r of rows) {
    if (!r.session_id) errors.push('Score row missing session_id');
    if (!r.scorer) errors.push(`Score row missing scorer in session ${r.session_id}`);

    for (const dim of ['p', 'e', 'i', 'd'] as const) {
      const val = parseInt(r[dim], 10);
      if (isNaN(val) || val < 1 || val > 4) {
        errors.push(`Score dimension "${dim}" has invalid value "${r[dim]}" in session ${r.session_id}. Must be integer between 1 and 4.`);
      }
    }
  }

  return errors;
}

const median = (a: number[]) => {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function runAnalysis(options?: { synthetic?: boolean; strict?: boolean }) {
  const isSynthetic =
    options?.synthetic ??
    (process.argv.includes('--synthetic') || process.env.PILOT_SYNTHETIC === 'true');
  const sessionsFile = isSynthetic ? 'pilot/sessions.synthetic.csv' : 'pilot/sessions.csv';
  const scoresFile = isSynthetic ? 'pilot/scores.synthetic.csv' : 'pilot/scores.csv';

  const sessions = parseCsv<PilotSessionRow>(sessionsFile);
  const scores = parseCsv<PilotScoreRow>(scoresFile);

  if (sessions.length === 0) {
    console.log('========================================================================');
    console.log('                 THINKMATE PILOT EVALUATION STATUS                     ');
    console.log('========================================================================');
    console.log(`Input file "${sessionsFile}" contains no participant sessions.`);
    console.log('Live pilot data collection is currently pending.');
    console.log('To run against synthetic benchmark test data for algorithmic verification:');
    console.log('  npm run analyze -- --synthetic');
    console.log('========================================================================');
    return { status: 'pending', gates: [] };
  }

  if (isSynthetic) {
    console.log('========================================================================');
    console.log('       [SYNTHETIC TEST BENCHMARK ONLY - NOT A REAL PILOT RESULT]        ');
    console.log('Warning: Evaluating illustrative mock observations for algorithmic verification.');
    console.log('This execution CANNOT and DOES NOT constitute empirical user research validation.');
    console.log('Decision gates are for algorithmic verification only.');
    console.log('========================================================================\n');
  }

  // Schema & Data Integrity Validation
  const sessionErrors = validateSessions(sessions);
  const scoreErrors = validateScores(scores);
  const allValidationErrors = [...sessionErrors, ...scoreErrors];

  if (allValidationErrors.length > 0) {
    console.error('=== DATA INTEGRITY VALIDATION FAILED ===');
    allValidationErrors.forEach((e) => console.error(`  - ${e}`));
    throw new Error(`Pilot analyzer rejected dataset with ${allValidationErrors.length} validation errors.`);
  }

  const sums: Record<string, number[]> = {};
  for (const r of scores) {
    (sums[r.session_id] ??= []).push(+r.p + +r.e + +r.i + +r.d);
  }

  const total = (id: string) => {
    const a = sums[id] ?? [];
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  };

  // Paired differences: each participant's ThinkMate total minus their own baseline total
  const byP: Record<string, PilotSessionRow[]> = {};
  for (const s of sessions) {
    (byP[s.participant] ??= []).push(s);
  }

  const pairs = Object.entries(byP).flatMap(([p, ss]) => {
    const tm = ss.find((s) => s.condition === 'thinkmate');
    const base = ss.find((s) => s.condition !== 'thinkmate');
    return tm && base ? [{ p, baseline: base.condition, diff: total(tm.session_id) - total(base.session_id) }] : [];
  }).filter((x) => !Number.isNaN(x.diff));

  const tmS = sessions.filter((s) => s.condition === 'thinkmate');
  const n = tmS.length;
  const share = (k: number, d: number) => `${k}/${d} (${d ? Math.round((100 * k) / d) : 0}%)`;

  // Protocol milestone enforcement:
  // Completion requires confirmed frame reached within 45 min, completed flag, and chosen-idea milestone
  const completed = tmS.filter(
    (s) =>
      s.completed.toLowerCase() === 'y' &&
      parseFloat(s.minutes_to_frame) <= 45 &&
      Boolean(s.chosen_idea && s.chosen_idea.trim().length > 0 && s.chosen_idea.toLowerCase() !== 'none')
  ).length;

  const accepted = tmS.filter(
    (s) => s.would_use.toLowerCase() === 'y' && s.named_situation.toLowerCase() === 'y'
  ).length;

  const abandoned = tmS.filter((s) => s.abandoned.toLowerCase() === 'y').length;
  const positive = pairs.filter((x) => x.diff > 0).length;
  const medDiff = pairs.length ? median(pairs.map((x) => x.diff)) : NaN;

  const bySheet: Record<string, PilotScoreRow[]> = {};
  for (const r of scores) {
    (bySheet[r.session_id] ??= []).push(r);
  }

  let within = 0;
  let compared = 0;
  let doubleScored = 0;

  for (const rows of Object.values(bySheet)) {
    if (rows.length < 2) continue;
    doubleScored++;
    for (const k of ['p', 'e', 'i', 'd'] as const) {
      compared++;
      if (Math.abs(+rows[0][k] - +rows[1][k]) <= 1) within++;
    }
  }

  const gateResults: Array<{ name: string; pass: boolean; detail: string }> = [];
  const gate = (name: string, pass: boolean, detail: string) => {
    gateResults.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
  };

  gate('Gate 1 — Completion (>= 80% confirmed frame & idea <= 45 min)', n > 0 && completed / n >= 0.8, share(completed, n));
  gate(
    'Gate 2 — Independence (median diff >= +1 and >= 60% positive)',
    medDiff >= 1 && pairs.length > 0 && positive / pairs.length >= 0.6,
    `median ${medDiff}, positive ${share(positive, pairs.length)}`
  );
  gate('Gate 3 — Acceptance (>= 70% would use & named situation)', n > 0 && accepted / n >= 0.7, share(accepted, n));
  gate('Gate 4 — Friction (abandon <= 25%)', n > 0 && abandoned / n <= 0.25, share(abandoned, n));
  gate(
    'Gate 5 — Scoring independence (>= 50% double-scored, >= 75% within 1 point)',
    doubleScored / Math.max(sessions.length, 1) >= 0.5 && compared > 0 && within / compared >= 0.75,
    `double-scored ${share(doubleScored, sessions.length)}, agreement ${share(within, compared)}`
  );

  console.log('\n--- Descriptive Metrics & Pair Contrasts ---');
  console.log(`Median Time to Problem Frame: ${median(tmS.map((s) => parseFloat(s.minutes_to_frame)))} minutes`);
  console.log('\nEvery pair contrast (ThinkMate minus assigned baseline, scale 4-16):');
  for (const x of pairs) {
    console.log(`  ${x.p} vs ${x.baseline}: ${x.diff.toFixed(1)}`);
  }

  const failedGates = gateResults.filter((g) => !g.pass);
  const passedAllGates = failedGates.length === 0;

  if (failedGates.length > 0) {
    console.error('\n=== DECISION GATE EVALUATION FAILED ===');
    for (const fg of failedGates) {
      console.error(`  - FAILED: ${fg.name} -> ${fg.detail}`);
    }
  } else {
    console.log('\n=== ALL 5 DECISION GATES PASSED SUCCESSFULLY ===');
  }

  if (isSynthetic) {
    console.log('\n[NOTICE]: Synthetic run completed for algorithm verification.');
    console.log('Real participant sessions must be collected before publishing release decisions.');
  }

  // Enforce unambiguous failure when gates fail:
  // When analyzing real participant data, or when ENFORCE_PILOT_GATES is set, or with --strict flag
  const shouldEnforceGatePass =
    options?.strict ??
    (!isSynthetic ||
      process.env.ENFORCE_PILOT_GATES === 'true' ||
      process.argv.includes('--strict'));

  if (shouldEnforceGatePass && !passedAllGates) {
    throw new Error(
      `Decision Gate Verification Failure: ${failedGates.length} gate(s) failed (${failedGates.map((g) => g.name).join(', ')}).`
    );
  }

  return {
    status: passedAllGates ? 'passed' : 'failed',
    gates: gateResults,
    failedCount: failedGates.length,
  };
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  try {
    const result = runAnalysis();
    if (result.status === 'failed') {
      console.error('[Gate Failure]: One or more decision gates failed criteria.');
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    console.error('[Analysis Error]:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
