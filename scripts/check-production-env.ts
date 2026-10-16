/**
 * Pre-release configuration check. Validates the current environment against production requirements.
 *
 *   npx tsx --env-file=.env.production.local scripts/check-production-env.ts [--ping]
 *
 * --ping additionally verifies the Upstash Redis credentials with a PING.
 * Exits 1 on any error. Variable values are never printed.
 */
import { validateProductionConfig } from '../src/lib/production-config';
import { UpstashRedisRateLimitStore } from '../src/lib/rate-limiter';

async function main() {
  const report = validateProductionConfig(process.env);
  const errors = [...report.errors];

  if (process.argv.includes('--ping') && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const store = new UpstashRedisRateLimitStore(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN);
    if (await store.ping(5000)) {
      console.log('ok       UPSTASH_REDIS_REST_URL: PING succeeded');
    } else {
      errors.push({ variable: 'UPSTASH_REDIS_REST_URL', message: 'PING failed (unreachable or bad token)' });
    }
  }

  for (const w of report.warnings) console.warn(`warning  ${w.variable}: ${w.message}`);
  for (const e of errors) console.error(`error    ${e.variable}: ${e.message}`);

  if (errors.length > 0) {
    console.error(`\nProduction configuration check failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`\nProduction configuration check passed (${report.warnings.length} warning(s)).`);
}

main();
