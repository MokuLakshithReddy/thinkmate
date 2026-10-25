import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ALLOWED = [
  'src/app/api/billing',
  'src/app/api/account',
  'src/app/api/auth/reset',
  'src/app/api/auth/signup',
  'src/lib/supabase-admin',
  'src/lib/legal',
  'src/app/api/thinkmate/invites',
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

test('service-role client is imported only from allowed server paths', () => {
  const offenders = walk('src')
    .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.endsWith('.test.ts'))
    .filter((f) => readFileSync(f, 'utf8').includes('supabase-admin'))
    .filter((f) => !ALLOWED.some((a) => f.split(sep).join('/').startsWith(a)));
  assert.deepEqual(offenders, []);
});
