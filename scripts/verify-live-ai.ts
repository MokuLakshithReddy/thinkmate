import { GoogleGenAI } from '@google/genai';
import { NextRequest } from 'next/server';
import { DEFAULT_GEMINI_MODEL } from '../src/config/models';
import assert from 'node:assert';

export async function verifyLiveAiExecution() {
  console.log('='.repeat(70));
  console.log('ThinkMate — Live AI Provider & Release Readiness Verification');
  console.log('='.repeat(70));

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required.');
  }

  console.log(`[AI Test 1] Verifying live Gemini model generation against "${DEFAULT_GEMINI_MODEL}"...`);
  const ai = new GoogleGenAI({ apiKey });
  const start = Date.now();
  const res = await ai.models.generateContent({
    model: DEFAULT_GEMINI_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Please respond with exactly "THINKMATE_RELEASE_VERIFIED".' }],
      },
    ],
    config: { maxOutputTokens: 20 },
  });
  const durationMs = Date.now() - start;
  const replyText = res.text?.trim() ?? '';
  console.log(`✔ Live model responded in ${durationMs}ms: "${replyText}"`);
  assert.ok(replyText.length > 0, 'Gemini response must not be empty');

  console.log('\n[AI Test 2] Testing /api/health?release_readiness=true endpoint probe...');
  const { GET: healthGet } = await import('../src/app/api/health/route');
  const req = new NextRequest('http://localhost:3000/api/health?release_readiness=true');
  const healthRes = await healthGet(req);
  const healthData = await healthRes.json();

  console.log('Health probe HTTP status:', healthRes.status);
  console.log('AI Provider Status:', healthData.dependencies?.aiProvider?.status);
  console.log('AI Live Verified:', healthData.dependencies?.aiProvider?.liveVerified);
  console.log('Overall Release Readiness:', healthData.releaseReadiness);

  assert.strictEqual(healthData.dependencies?.aiProvider?.liveVerified, true, 'AI provider must be live verified');
  assert.strictEqual(healthData.dependencies?.aiProvider?.status, 'verified', 'AI status must be "verified"');
  console.log('✔ GET /api/health?release_readiness=true successfully verified live AI provider!\n');
  console.log('='.repeat(70));
  console.log('ALL AI LIVE VERIFICATIONS PASSED.');
  console.log('='.repeat(70));
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  verifyLiveAiExecution()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Live AI Verification Error]:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
