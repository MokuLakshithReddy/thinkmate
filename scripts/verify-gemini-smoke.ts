import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { GoogleGenAI } from '@google/genai';
import { DEFAULT_GEMINI_MODEL } from '../src/config/models';
import assert from 'node:assert';

async function main() {
  console.log('='.repeat(70));
  console.log('ThinkMate — Live Gemini API Smoke Test');
  console.log('='.repeat(70));

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required.');
    process.exit(1);
  }

  console.log(`[Gemini Smoke] Target Model: "${DEFAULT_GEMINI_MODEL}"`);
  console.log(`[Gemini Smoke] Sending minimal test request to Google Gemini API...`);

  const startTime = Date.now();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const res = await ai.models.generateContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with exactly: PONG' }],
        },
      ],
      config: {
        maxOutputTokens: 10,
        temperature: 0,
      },
    });

    const elapsed = Date.now() - startTime;
    const replyText = res.text?.trim() ?? '';

    console.log(`[Gemini Smoke] Response received in ${elapsed}ms: "${replyText}"`);

    assert.ok(replyText.length > 0, 'Gemini response must not be empty');
    console.log(`✔ SUCCESS: Configured default model "${DEFAULT_GEMINI_MODEL}" exists and is actively callable!`);
    console.log('='.repeat(70));
    process.exitCode = 0;
    return;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✖ FAILED: Gemini API call failed for model "${DEFAULT_GEMINI_MODEL}": ${msg}`);
    process.exit(1);
  }
}

main();
