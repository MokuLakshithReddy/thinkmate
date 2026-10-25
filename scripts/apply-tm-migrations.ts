import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_RLS_TABLES = [
  'tm_workspaces',
  'tm_items',
  'tm_frames',
  'tm_evidence',
  'tm_item_evidence',
  'tm_decisions',
  'tm_events',
  'tm_members',
];

const KNOWN_PRODUCTION_REFS = new Set([
  'gtkvujspajcelzufpggr', // SnapGram / main production reference
]);

function validateProjectRef(ref: string): void {
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
    throw new Error(
      `Invalid SUPABASE_PROJECT_REF "${ref}". Expected a 20-character alphanumeric project identifier.`
    );
  }
}

async function executeSql(projectRef: string, token: string, query: string, label: string) {
  console.log(`[Migration] Executing: ${label}...`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Migration step failed for ${label} (HTTP ${res.status}): ${body}`);
  }
  return body ? JSON.parse(body) : null;
}

export async function applyMigrations() {
  console.log('=== ThinkMate Fail-Safe Migration Runner ===');

  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!projectRef) {
    throw new Error('SUPABASE_PROJECT_REF is required. No database project was selected.');
  }

  validateProjectRef(projectRef);

  const token = (process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_AUTH_TOKEN)?.trim();
  if (!token) {
    throw new Error('SUPABASE_ACCESS_TOKEN (or SUPABASE_AUTH_TOKEN) is required to run migrations.');
  }

  const isProductionTarget =
    KNOWN_PRODUCTION_REFS.has(projectRef) ||
    process.env.NODE_ENV === 'production' ||
    process.env.ENVIRONMENT === 'production';

  if (isProductionTarget) {
    const confirmed = process.env.CONFIRM_PRODUCTION_MIGRATION === 'true';
    if (!confirmed) {
      throw new Error(
        `TARGET SAFETY ABORT: Project "${projectRef}" is identified as a production environment. ` +
          'To proceed, you must explicitly set CONFIRM_PRODUCTION_MIGRATION=true.'
      );
    }
    console.warn(`[SAFETY CHECK] Verified deliberate production migration approval for project "${projectRef}".`);
  } else {
    console.log(`[SAFETY CHECK] Verified non-production target project: "${projectRef}".`);
  }

  // 1. Create migration tracking table if not present
  console.log('[Tracking] Ensuring _tm_schema_migrations table exists...');
  await executeSql(
    projectRef,
    token,
    `
      create table if not exists public._tm_schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `,
    'create _tm_schema_migrations tracking table'
  );

  // 2. Query already applied migrations
  const existingMigrationsRaw = await executeSql(
    projectRef,
    token,
    'select name from public._tm_schema_migrations order by applied_at asc;',
    'query applied migrations'
  );

  const appliedSet = new Set<string>(
    Array.isArray(existingMigrationsRaw)
      ? existingMigrationsRaw.map((r: { name: string }) => r.name)
      : []
  );

  const migrationFiles = [
    '001_mvp.sql',
    '002_full_domain.sql',
    '003_fts.sql',
    '005_teams.sql',
    '006_quota_idempotency.sql',
  ];

  // 3. Apply pending migrations sequentially
  for (const m of migrationFiles) {
    if (appliedSet.has(m)) {
      console.log(`[Migration] Skipping already-applied migration: ${m}`);
      continue;
    }

    const filePath = path.join(__dirname, '..', 'supabase', 'migrations', m);
    if (!existsSync(filePath)) {
      throw new Error(`Migration file not found: ${filePath}`);
    }

    const sql = readFileSync(filePath, 'utf8');
    await executeSql(projectRef, token, sql, m);

    // Record migration success
    await executeSql(
      projectRef,
      token,
      `insert into public._tm_schema_migrations (name) values ('${m}') on conflict (name) do nothing;`,
      `record migration ${m}`
    );
    console.log(`[Migration] Successfully applied and recorded: ${m}`);
  }

  // 4. RLS Audit Gate
  console.log('[RLS Gate] Verifying Row-Level Security on all required tables...');
  const auditResult = await executeSql(
    projectRef,
    token,
    `
      select c.relname, c.relrowsecurity, count(p.polname)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tm_%'
      group by c.relname, c.relrowsecurity
      order by 1;
    `,
    'audit RLS policies'
  );

  const tableMap = new Map<string, { relrowsecurity: boolean; policy_count: number }>();
  if (Array.isArray(auditResult)) {
    for (const row of auditResult) {
      tableMap.set(row.relname, {
        relrowsecurity: Boolean(row.relrowsecurity),
        policy_count: Number(row.policy_count),
      });
    }
  }

  const failures: string[] = [];

  for (const requiredTable of REQUIRED_RLS_TABLES) {
    const tableInfo = tableMap.get(requiredTable);
    if (!tableInfo) {
      failures.push(`Table "${requiredTable}" does not exist in schema.`);
      continue;
    }
    if (!tableInfo.relrowsecurity) {
      failures.push(`Table "${requiredTable}" has Row Level Security (RLS) DISABLED.`);
    }
    if (tableInfo.policy_count < 1) {
      failures.push(`Table "${requiredTable}" has RLS enabled but 0 security policies defined.`);
    }
  }

  if (failures.length > 0) {
    console.error('=== RLS AUDIT GATE FAILED ===');
    failures.forEach((f) => console.error(`  - ${f}`));
    throw new Error(`RLS Audit Gate rejected deployment: ${failures.length} security condition(s) failed.`);
  }

  console.log('=== RLS Audit Gate PASSED: All 8 required tables have RLS enabled and active policies. ===');
  console.log('Database migrations completed successfully and safely.');
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  applyMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Migration Error]:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
