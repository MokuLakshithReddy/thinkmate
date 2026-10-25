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
  const isReleaseReadiness =
    req.nextUrl.searchParams.get('release_readiness') === 'true' ||
    req.nextUrl.searchParams.get('readiness') === 'release' ||
    req.nextUrl.searchParams.get('release') === 'true' ||
    req.nextUrl.searchParams.get('verify_ai') === 'true';

  const isReadiness = req.nextUrl.searchParams.get('readiness') === 'true' || isReleaseReadiness;

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
  const shouldVerifyLiveAI = isReleaseReadiness || req.nextUrl.searchParams.get('verify_ai') === 'true';
  let aiStatus: 'ready' | 'verified' | 'degraded' | 'unconfigured' = hasGeminiKey ? 'ready' : 'unconfigured';
  let liveVerified = false;
  let liveMessage = hasGeminiKey ? 'Configured with API key' : 'API key unconfigured';

  if (shouldVerifyLiveAI) {
    if (!hasGeminiKey) {
      aiStatus = 'unconfigured';
      liveMessage = 'API key unconfigured; cannot verify live AI model';
    } else {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) as string;
        const ai = new GoogleGenAI({ apiKey });
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('AI probe timed out')), 6000);
        });
        const res = await Promise.race([
          ai.models.generateContent({
            model: DEFAULT_GEMINI_MODEL,
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
            config: { maxOutputTokens: 2 },
          }),
          timeoutPromise,
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        const replyText = typeof res?.text === 'string' ? res.text.trim() : '';
        if (replyText.length > 0) {
          liveVerified = true;
          aiStatus = 'verified';
          liveMessage = 'Live model generation verified successfully';
        } else {
          aiStatus = 'degraded';
          liveMessage = 'Model responded but returned empty text';
        }
      } catch (probeErr) {
        aiStatus = 'degraded';
        // Sanitize error: never leak raw error message, internal stack traces, or credentials
        const errStr = probeErr instanceof Error ? probeErr.message : String(probeErr);
        console.error('[Health Probe AI Error]:', errStr);
        liveMessage = 'Live model probe failed: model execution error or network timeout';
      }
    }
  }

  const authInfrastructure = await checkAuthInfrastructure();

  // For release readiness, AI must be genuinely verified ('verified'), not merely configured ('ready')
  const isAiReady = isReleaseReadiness ? aiStatus === 'verified' : (aiStatus === 'ready' || aiStatus === 'verified');
  const readyCount = [dbStatus === 'ready', isAiReady, authInfrastructure.status === 'ready'].filter(
    Boolean
  ).length;
  const overallReadiness: 'ready' | 'degraded' | 'unavailable' =
    readyCount === 3 ? 'ready' : readyCount > 0 ? 'degraded' : 'unavailable';

  const isFullReleaseReady =
    dbStatus === 'ready' && aiStatus === 'verified' && authInfrastructure.status === 'ready';

  const status = {
    liveness: 'up',
    readiness: overallReadiness,
    releaseReadiness: isFullReleaseReady ? 'ready' : 'degraded',
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
  // When release readiness is probed, AI must additionally be live verified.
  // Any degraded or unavailable state returns HTTP 503 Service Unavailable.
  // Standard liveness probe (without ?readiness=true or ?release_readiness=true) returns HTTP 200.
  const isHealthyReadiness = overallReadiness === 'ready';
  const httpStatus = isReadiness ? (isHealthyReadiness ? 200 : 503) : 200;

  if (isReadiness && !isHealthyReadiness) {
    await reportOperationalAlertAsync('READINESS_FAILURE', {
      overallReadiness,
      isReleaseReadiness,
      dbStatus,
      aiStatus,
      authInfrastructureStatus: authInfrastructure.status,
      runbook: 'Check health endpoint dependencies. Verify Supabase, Gemini API, and Upstash Redis credentials.',
    });
  }

  return NextResponse.json(status, { status: httpStatus });
}
