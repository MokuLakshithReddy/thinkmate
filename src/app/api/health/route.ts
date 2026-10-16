import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/services/db/supabase-client';
import { UpstashRedisRateLimitStore, verifyRateLimiterConfig } from '@/lib/rate-limiter';
import { getSessionEncryptionKeyStatus } from '@/lib/production-config';
import { reportOperationalAlert } from '@/lib/monitoring';

type RateLimiterStatus = 'ready' | 'memory_fallback' | 'unconfigured' | 'invalid' | 'unreachable';

/**
 * Auth endpoints fail closed in production without a reachable distributed limiter and a dedicated
 * token-rotation key, so both are readiness requirements there. Only statuses are reported, never values.
 */
async function checkAuthInfrastructure() {
  const isProduction = process.env.NODE_ENV === 'production';
  const limiterConfig = verifyRateLimiterConfig({ emitAlerts: false });

  let rateLimiterStatus: RateLimiterStatus;
  if (!limiterConfig.valid) {
    rateLimiterStatus = limiterConfig.hasUpstash ? 'invalid' : 'unconfigured';
  } else if (!limiterConfig.hasUpstash) {
    rateLimiterStatus = 'memory_fallback';
  } else {
    const store = new UpstashRedisRateLimitStore(
      process.env.UPSTASH_REDIS_REST_URL as string,
      process.env.UPSTASH_REDIS_REST_TOKEN as string
    );
    rateLimiterStatus = (await store.ping()) ? 'ready' : 'unreachable';
  }

  const sessionEncryptionStatus = getSessionEncryptionKeyStatus();

  const ready = isProduction
    ? rateLimiterStatus === 'ready' && sessionEncryptionStatus === 'ready'
    : rateLimiterStatus === 'ready' || rateLimiterStatus === 'memory_fallback';

  return {
    status: (ready ? 'ready' : 'unavailable') as 'ready' | 'unavailable',
    rateLimiter: {
      provider: 'Upstash Redis',
      status: rateLimiterStatus,
      distributed: rateLimiterStatus === 'ready',
    },
    sessionEncryption: {
      status: sessionEncryptionStatus,
    },
  };
}

/**
 * Health & Readiness Probe.
 * Distinguishes between liveness (process alive) and readiness (dependencies reachable).
 * Safely verifies database reachability and AI provider configuration without exposing secrets.
 */
export async function GET(req: NextRequest) {
  const isReadiness = req.nextUrl.searchParams.get('readiness') === 'true';

  let dbStatus: 'ready' | 'degraded' | 'unavailable' = 'unavailable';
  let dbReachable = false;
  let dbMessage = 'Database service unconfigured';

  if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const client = getServiceSupabaseClient();
      const { error } = await client.from('thinking_sessions').select('id').limit(1);
      if (!error) {
        dbStatus = 'ready';
        dbReachable = true;
        dbMessage = 'Connected and verified';
      } else {
        dbStatus = 'degraded';
        dbMessage = 'Connected but table query returned error';
      }
    } catch {
      dbStatus = 'unavailable';
      dbMessage = 'Connection refused or unreachable';
    }
  }

  const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const aiStatus: 'ready' | 'unconfigured' = hasGeminiKey ? 'ready' : 'unconfigured';

  const authInfrastructure = await checkAuthInfrastructure();

  const readyCount = [dbStatus === 'ready', aiStatus === 'ready', authInfrastructure.status === 'ready'].filter(
    Boolean
  ).length;
  const overallReadiness: 'ready' | 'degraded' | 'unavailable' =
    readyCount === 3 ? 'ready' : readyCount > 0 ? 'degraded' : 'unavailable';

  const status = {
    liveness: 'up',
    readiness: overallReadiness,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    dependencies: {
      database: {
        provider: 'Supabase PostgreSQL',
        status: dbStatus,
        reachable: dbReachable,
        message: dbMessage,
      },
      aiProvider: {
        provider: 'Google GenAI (Gemini)',
        status: aiStatus,
        model: 'gemini-2.5-flash',
      },
      authInfrastructure,
    },
    version: '0.1.0',
  };

  // Production Readiness Rule:
  // When readiness is probed, ALL required dependencies (database, AI provider, auth infrastructure) must be ready.
  // Any degraded or unavailable state returns HTTP 503 Service Unavailable.
  // Standard liveness probe (without ?readiness=true) returns HTTP 200 to indicate process health.
  const isHealthyReadiness = overallReadiness === 'ready';
  const httpStatus = isReadiness ? (isHealthyReadiness ? 200 : 503) : 200;

  if (isReadiness && !isHealthyReadiness) {
    reportOperationalAlert('READINESS_FAILURE', {
      overallReadiness,
      dbStatus,
      aiStatus,
      authInfrastructureStatus: authInfrastructure.status,
      runbook: 'Check health endpoint dependencies. Verify Supabase, Gemini API, and Upstash Redis credentials.',
    });
  }

  return NextResponse.json(status, { status: httpStatus });
}
