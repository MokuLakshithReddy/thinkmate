import { readFileSync, existsSync } from 'node:fs';

const isSyntheticRun = process.argv.includes('--synthetic') || process.env.PILOT_SYNTHETIC === 'true';

function csv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [head[i], v.trim()])));
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const sessionsFile = isSyntheticRun ? 'pilot/sessions.synthetic.csv' : 'pilot/sessions.csv';
const scoresFile = isSyntheticRun ? 'pilot/scores.synthetic.csv' : 'pilot/scores.csv';

const sessions = csv(sessionsFile);
const scores = csv(scoresFile);

if (sessions.length === 0) {
  console.log('========================================================================');
  console.log('                 THINKMATE PILOT EVALUATION STATUS                     ');
  console.log('========================================================================');
  console.log(`Input file "${sessionsFile}" contains no participant sessions.`);
  console.log('Pilot data collection is currently pending.');
  console.log('To run against synthetic benchmark test data, invoke:');
  console.log('  npm run analyze -- --synthetic');
  console.log('========================================================================');
  process.exit(0);
}

if (isSyntheticRun) {
  console.log('========================================================================');
  console.log('       [SYNTHETIC TEST BENCHMARK ONLY - NOT A REAL PILOT RESULT]        ');
  console.log('Warning: Evaluating illustrative/synthetic mock observations.');
  console.log('This execution DOES NOT constitute empirical user research validation.');
  console.log('Decision gates are for algorithmic verification only.');
  console.log('========================================================================\n');
}

const sums: Record<string, number[]> = {};
for (const r of scores) {
  (sums[r.session_id] ??= []).push(+r.p + +r.e + +r.i + +r.d);
}

const total = (id: string) => {
  const a = sums[id] ?? [];
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
};

// paired differences: each participant's ThinkMate total minus their own baseline total
const byP: Record<string, Record<string, string>[]> = {};
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
const count = (f: (s: Record<string, string>) => boolean) => tmS.filter(f).length;

const completed = count((s) => s.completed === 'y');
const accepted = count((s) => s.would_use === 'y' && s.named_situation === 'y');
const abandoned = count((s) => s.abandoned === 'y');
const positive = pairs.filter((x) => x.diff > 0).length;
const medDiff = pairs.length ? median(pairs.map((x) => x.diff)) : NaN;

const bySheet: Record<string, Record<string, string>[]> = {};
for (const r of scores) {
  (bySheet[r.session_id] ??= []).push(r);
}

let within = 0, compared = 0, doubleScored = 0;
for (const rows of Object.values(bySheet)) {
  if (rows.length < 2) continue;
  doubleScored++;
  for (const k of ['p', 'e', 'i', 'd']) {
    compared++;
    if (Math.abs(+rows[0][k] - +rows[1][k]) <= 1) within++;
  }
}

const gate = (name: string, pass: boolean, detail: string) =>
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`);

gate('Completion (>= 80%)', n > 0 && completed / n >= 0.8, share(completed, n));
gate(
  'Independence (median diff >= +1 and >= 60% positive)',
  medDiff >= 1 && pairs.length > 0 && positive / pairs.length >= 0.6,
  `median ${medDiff}, positive ${share(positive, pairs.length)}`
);
gate('Acceptance (>= 70%)', n > 0 && accepted / n >= 0.7, share(accepted, n));
gate('Friction (abandon <= 25%)', n > 0 && abandoned / n <= 0.25, share(abandoned, n));
gate(
  'Scoring independence (>= 50% double-scored, >= 75% within 1 point)',
  doubleScored / Math.max(sessions.length, 1) >= 0.5 && compared > 0 && within / compared >= 0.75,
  `double-scored ${share(doubleScored, sessions.length)}, agreement ${share(within, compared)}`
);

console.log('\nEvery pair (ThinkMate minus baseline, scale 4-16):');
for (const x of pairs) {
  console.log(`  ${x.p} vs ${x.baseline}: ${x.diff.toFixed(1)}`);
}

if (isSyntheticRun) {
  console.log('\n[NOTICE]: Synthetic run completed for algorithm verification.');
  console.log('Real pilot results must be collected before publishing release decisions.');
}
