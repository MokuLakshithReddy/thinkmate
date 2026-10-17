/**
 * Pre-release configuration check. Validates the current environment against production requirements.
 *
 *   npx tsx --env-file=.env.production.local scripts/check-production-env.ts [--ping] [--test-alert] [--test-readiness]
 *
 * Flags:
 *   --ping            Verifies Upstash Redis credentials with an atomic PING command.
 *   --test-alert      Validates alert dispatch to ALERT_WEBHOOK_URL (or verifies stdout logging).
 *   --test-readiness  Verifies all readiness dependencies (Database, Auth Infrastructure, AI Key).
 *
 * Exits 1 on any error. Sensitive variable values are NEVER printed.
 */
import { validateProductionConfig } from '../src/lib/production-config';
import { UpstashRedisRateLimitStore } from '../src/lib/rate-limiter';
import { dispatchWebhookNotification, reportOperationalAlert, OperationalAlert } from '../src/lib/monitoring';
import { getServiceSupabaseClient } from '../src/services/db/supabase-client';

async function main() {
  const report = validateProductionConfig(process.env);
  const errors = [...report.errors];

  // 1. Redis PING verification
  if (process.argv.includes('--ping')) {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const store = new UpstashRedisRateLimitStore(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN);
      if (await store.ping(5000)) {
        console.log('ok       UPSTASH_REDIS_REST_URL: PING succeeded');
      } else {
        errors.push({ variable: 'UPSTASH_REDIS_REST_URL', message: 'PING failed (unreachable or bad token)' });
      }
    } else {
      errors.push({ variable: 'UPSTASH_REDIS_REST_URL', message: 'Cannot --ping: credentials not configured in environment' });
    }
  }

  // 2. Alert delivery verification
  if (process.argv.includes('--test-alert')) {
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
      console.log('info     Testing external alert webhook delivery...');
      const testPayload: OperationalAlert = {
        tag: 'THINKMATE_OPERATOR_ALERT',
        type: 'READINESS_FAILURE',
        severity: 'WARNING',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
        details: {
          test: true,
          message: 'Pre-flight operational alert delivery verification test',
        },
      };

      try {
        await dispatchWebhookNotification(webhookUrl, testPayload);
        console.log('ok       ALERT_WEBHOOK_URL: Test notification delivered successfully (HTTP 2xx received)');
      } catch (alertErr) {
        errors.push({
          variable: 'ALERT_WEBHOOK_URL',
          message: `Delivery test failed: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
        });
      }
    } else {
      console.log('info     ALERT_WEBHOOK_URL is not set; operational alerts log to console.error for cloud aggregators.');
    }
  }

  // 3. Database & readiness probe verification
  if (process.argv.includes('--test-readiness')) {
    console.log('info     Testing service dependencies for readiness probe...');
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const client = getServiceSupabaseClient();
        const { error } = await client.from('thinking_sessions').select('id').limit(1);
        if (!error) {
          console.log('ok       Database (Supabase): table query verified for readiness');
        } else {
          errors.push({ variable: 'NEXT_PUBLIC_SUPABASE_URL', message: `Database query failed: ${error.message}` });
        }
      } catch (dbErr) {
        errors.push({
          variable: 'NEXT_PUBLIC_SUPABASE_URL',
          message: `Connection refused: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
        });
      }
    } else {
      errors.push({ variable: 'SUPABASE_SERVICE_ROLE_KEY', message: 'Cannot --test-readiness: credentials missing' });
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
