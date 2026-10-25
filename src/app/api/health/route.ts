import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/services/db/supabase-client';
import { UpstashRedisRateLimitStore, verifyRateLimiterConfig } from '@/lib/rate-limiter';
import { getSessionEncryptionKeyStatus } from '@/lib/production-config';
import { reportOperationalAlertAsync } from '@/lib/monitoring';
import { DEFAULT_GEMINI_MODEL } from '@/config/models';

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
  const verifyLiveAI = req.nextUrl.searchParams.get('verify_ai') === 'true';
  let aiStatus: 'ready' | 'verified' | 'degraded' | 'unconfigured' = hasGeminiKey ? 'ready' : 'unconfigured';
  let liveVerified = false;
  let liveMessage = hasGeminiKey ? 'Configured with API key' : 'API key unconfigured';

  if (verifyLiveAI && hasGeminiKey) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) as string });
      const timeoutPromise = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('AI probe timed out')), 6000));
      const res = await Promise.race([
        ai.models.generateContent({
          model: DEFAULT_GEMINI_MODEL,
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          config: { maxOutputTokens: 2 },
        }),
        timeoutPromise,
      ]);
      if (res && res.text !== undefined) {
        liveVerified = true;
        aiStatus = 'verified';
        liveMessage = 'Live model generation verified successfully';
      }
    } catch (probeErr) {
      aiStatus = 'degraded';
      liveMessage = `Live model probe failed: ${probeErr instanceof Error ? probeErr.message : String(probeErr)}`;
    }
  }

  const authInfrastructure = await checkAuthInfrastructure();

  const isAiReady = aiStatus === 'ready' || aiStatus === 'verified';
  const readyCount = [dbStatus === 'ready', isAiReady, authInfrastructure.status === 'ready'].filter(
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
        configured: hasGeminiKey,
        liveVerified,
        message: liveMessage,
        model: DEFAULT_GEMINI_MODEL,
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
    await reportOperationalAlertAsync('READINESS_FAILURE', {
      overallReadiness,
      dbStatus,
      aiStatus,
      authInfrastructureStatus: authInfrastructure.status,
      runbook: 'Check health endpoint dependencies. Verify Supabase, Gemini API, and Upstash Redis credentials.',
    });
  }

  return NextResponse.json(status, { status: httpStatus });
}
