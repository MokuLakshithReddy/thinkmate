import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_RLS_TABLES = [
  'thinking_sessions',
  'session_messages',
  'session_insights',
  'workflow_transitions',
  'workflow_idempotency_keys',
  'tm_workspaces',
  'tm_items',
  'tm_frames',
  'tm_evidence',
  'tm_item_evidence',
  'tm_decisions',
  'tm_events',
  'tm_members',
  'tm_user_quotas',
  'user_consents',
  'plan_limits',
  'billing_subscriptions',
  'billing_events',
  'tm_invites',
];

const KNOWN_PRODUCTION_REFS = new Set([
  'gtkvujspajcelzufpggr', // SnapGram / main production reference
  'ujbpyqubhxycgtaadkce', // Secondary production reference
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
    '20261012000000_thinkmate_schema.sql',
    '20261013000000_concurrency_and_idempotency_hardening.sql',
    '20261015000000_enforce_workflow_decision_gate.sql',
    '001_mvp.sql',
    '002_full_domain.sql',
    '003_fts.sql',
    '005_teams.sql',
    '006_quota_idempotency.sql',
    '007_atomic_turn_rpc.sql',
    '008_atomic_quota_reservation.sql',
    '009_user_level_quota_lock.sql',
    '010_consents.sql',
    '011_plans_usage.sql',
    '012_lock_reserve.sql',
    '013_invites.sql',
    '014_invites_harden.sql',
    '015_atomic_limits.sql',
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
      where n.nspname = 'public' and c.relkind = 'r'
        and (
          c.relname like 'tm_%'
          or c.relname in (
            'user_consents',
            'plan_limits',
            'billing_subscriptions',
            'billing_events',
            'thinking_sessions',
            'session_messages',
            'session_insights',
            'workflow_transitions',
            'workflow_idempotency_keys'
          )
        )
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

  console.log(`=== RLS Audit Gate PASSED: All ${REQUIRED_RLS_TABLES.length} required tables have RLS enabled and active policies. ===`);

  // 5. Schema Functions & Constraints Verification Gate
  console.log('[Schema Gate] Verifying critical functions and workflow constraints...');
  const funcResult = await executeSql(
    projectRef,
    token,
    `
      select proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'execute_workflow_transition_tx',
          'apply_turn_and_insights_tx',
          'tm_apply_turn_tx',
          'tm_reserve_turn_quota_for_plan',
          'tm_create_workspace',
          'tm_reserve_research_quota',
          'tm_create_invite',
          'tm_accept_invite'
        );
    `,
    'verify critical functions'
  );

  const foundFunctions = new Set(Array.isArray(funcResult) ? funcResult.map((r: { proname: string }) => r.proname) : []);
  const requiredFunctions = [
    'execute_workflow_transition_tx',
    'apply_turn_and_insights_tx',
    'tm_apply_turn_tx',
    'tm_reserve_turn_quota_for_plan',
    'tm_create_workspace',
    'tm_reserve_research_quota',
    'tm_create_invite',
    'tm_accept_invite',
  ];

  const schemaFailures: string[] = [];
  for (const fn of requiredFunctions) {
    if (!foundFunctions.has(fn)) {
      schemaFailures.push(`Required function "${fn}" is missing from public schema.`);
    }
  }

  const constraintResult = await executeSql(
    projectRef,
    token,
    `
      select conname from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public'
        and c.conname in ('chk_stage_mode_compatible');
    `,
    'verify critical constraints'
  );

  const foundConstraints = new Set(Array.isArray(constraintResult) ? constraintResult.map((r: { conname: string }) => r.conname) : []);
  if (!foundConstraints.has('chk_stage_mode_compatible')) {
    schemaFailures.push('Required workflow constraint "chk_stage_mode_compatible" is missing from thinking_sessions.');
  }

  if (schemaFailures.length > 0) {
    console.error('=== SCHEMA VERIFICATION GATE FAILED ===');
    schemaFailures.forEach((f) => console.error(`  - ${f}`));
    throw new Error(`Schema Verification Gate rejected deployment: ${schemaFailures.length} condition(s) failed.`);
  }

  console.log('=== Schema Verification Gate PASSED: All critical functions and constraints verified. ===');
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
