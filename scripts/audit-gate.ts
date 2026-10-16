/**
 * Full-tree dependency audit gate (dev + prod).
 * Fails on any high/critical advisory unless it is listed in audit-allowlist.json with an unexpired reviewBy date.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface AllowlistEntry {
  id: string;
  package: string;
  reason: string;
  mitigation: string;
  reviewBy: string;
}

interface AuditVia {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
}

interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
  url: string;
  range: string;
}

const FAILING_SEVERITIES = new Set(['high', 'critical']);
const root = path.resolve(__dirname, '..');

function runAudit(): { vulnerabilities?: Record<string, { via: (string | AuditVia)[] }>; error?: unknown } {
  let raw: string;
  try {
    raw = execFileSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // npm audit exits non-zero when it finds vulnerabilities; the JSON report is still on stdout.
    raw = (err as { stdout?: string }).stdout || '';
  }
  return JSON.parse(raw);
}

function collectAdvisories(report: ReturnType<typeof runAudit>): Advisory[] {
  const byKey = new Map<string, Advisory>();
  for (const vuln of Object.values(report.vulnerabilities || {})) {
    for (const via of vuln.via) {
      if (typeof via === 'string') continue;
      const id = via.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] || `npm-${via.source}`;
      const pkg = via.name || 'unknown';
      byKey.set(`${id}:${pkg}`, {
        id,
        package: pkg,
        severity: via.severity || 'unknown',
        title: via.title || '',
        url: via.url || '',
        range: via.range || '',
      });
    }
  }
  return [...byKey.values()];
}

function main() {
  const allowlist: AllowlistEntry[] = JSON.parse(
    readFileSync(path.join(root, 'audit-allowlist.json'), 'utf8')
  ).advisories;
  const report = runAudit();
  if (report.error) {
    console.error('npm audit failed:', JSON.stringify(report.error));
    process.exit(2);
  }

  const today = new Date().toISOString().slice(0, 10);
  const advisories = collectAdvisories(report);
  const failures: string[] = [];

  for (const adv of advisories) {
    const label = `${adv.severity.toUpperCase()} ${adv.id} ${adv.package}@${adv.range} — ${adv.title} ${adv.url}`;
    if (!FAILING_SEVERITIES.has(adv.severity)) {
      console.log(`info     ${label}`);
      continue;
    }
    const entry = allowlist.find((a) => a.id === adv.id && a.package === adv.package);
    if (!entry) {
      failures.push(`not allowlisted: ${label}`);
    } else if (entry.reviewBy < today) {
      failures.push(`allowlist entry expired on ${entry.reviewBy}, re-triage: ${label}`);
    } else {
      console.log(`accepted ${label}\n         reason: ${entry.reason}\n         review by: ${entry.reviewBy}`);
    }
  }

  for (const entry of allowlist) {
    if (!advisories.some((a) => a.id === entry.id && a.package === entry.package)) {
      console.warn(`stale allowlist entry (no longer reported, remove it): ${entry.id} ${entry.package}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nDependency audit failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\nDependency audit passed (${advisories.length} advisories reported, none unaccepted at high/critical).`);
}

main();
