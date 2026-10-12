import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabaseClient } from '@/services/db/supabase-client';

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

  const overallReadiness: 'ready' | 'degraded' | 'unavailable' =
    dbStatus === 'ready' && aiStatus === 'ready'
      ? 'ready'
      : dbStatus === 'ready' || aiStatus === 'ready'
      ? 'degraded'
      : 'unavailable';

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
    },
    version: '0.1.0',
  };

  // Production Readiness Rule:
  // When readiness is probed, ALL required dependencies (database and AI provider) must be fully ready.
  // Any degraded or unavailable state returns HTTP 503 Service Unavailable.
  // Standard liveness probe (without ?readiness=true) returns HTTP 200 to indicate process health.
  const isHealthyReadiness = overallReadiness === 'ready';
  const httpStatus = isReadiness ? (isHealthyReadiness ? 200 : 503) : 200;

  return NextResponse.json(status, { status: httpStatus });
}
