import { NextResponse } from 'next/server';

export async function GET() {
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const hasSupabaseUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  const hasSupabaseKey = !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);

  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      api: {
        status: 'up',
      },
      aiProvider: {
        provider: 'Google GenAI (Gemini)',
        status: hasGeminiKey ? 'configured' : 'fallback_simulator_mode',
        model: 'gemini-2.5-flash',
      },
      database: {
        provider: 'Supabase PostgreSQL',
        status: hasSupabaseUrl && hasSupabaseKey ? 'configured' : 'local_storage_mode',
      },
    },
    version: '0.1.0',
  };

  return NextResponse.json(status, { status: 200 });
}
