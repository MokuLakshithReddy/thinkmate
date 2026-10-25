import { GoogleGenAI } from '@google/genai';
import { ModelOutput } from './schemas';
import { DEFAULT_GEMINI_MODEL } from '../../config/models';
import dns from 'node:dns';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {}

const getAiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export type Content = { role: 'user' | 'model'; parts: { text: string }[] };

async function generateJson(
  system: string,
  contents: Content[],
  signal?: AbortSignal
): Promise<{ text: string; tokens?: number }> {
  const ai = getAiClient();
  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const res = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      temperature: 0.6,
      maxOutputTokens: 1200,
      abortSignal: signal,
    },
  });

  const tokens = res.usageMetadata?.totalTokenCount;
  return { text: res.text ?? '', tokens };
}

function isRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('AbortError') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('INTERNAL') ||
    msg.includes('UNAVAILABLE')
  );
}

export async function runTurn(
  system: string,
  history: Content[],
  retries = 1,
  timeoutMs = 25000
): Promise<{ output: ModelOutput; tokens?: number }> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Request timed out'));
    }, timeoutMs);

    try {
      const raw = await generateJson(system, history, controller.signal);
      const parsed = JSON.parse(raw.text);
      const validated = ModelOutput.parse(parsed);
      return { output: validated, tokens: raw.tokens };
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === retries) {
        throw e;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
