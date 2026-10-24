import { readFileSync } from 'node:fs';
import path from 'node:path';

const SUPABASE_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_AUTH_TOKEN || '';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'ffjgbefnubyjzrlvpdkl';

async function executeSql(query: string, label: string) {
  console.log(`Executing ${label}...`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Migration ${label} failed (${res.status}): ${body}`);
  }
  console.log(`Successfully applied ${label}`);
}

async function main() {
  const migrations = [
    '001_mvp.sql',
    '002_full_domain.sql',
    '003_fts.sql',
    '005_teams.sql',
    '006_quota_idempotency.sql'
  ];

  for (const m of migrations) {
    const file = path.join(__dirname, '..', 'supabase', 'migrations', m);
    const sql = readFileSync(file, 'utf8');
    await executeSql(sql, m);
  }

  // Audit RLS on tm_ tables
  const auditRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: `
        select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'tm_%'
        order by 1;
      `
    })
  });
  console.log('RLS audit result:', await auditRes.json());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
