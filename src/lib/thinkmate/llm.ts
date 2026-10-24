import { GoogleGenAI } from '@google/genai';
import { ModelOutput } from './schemas';

const getAiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export type Content = { role: 'user' | 'model'; parts: { text: string }[] };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

async function generateJson(
  system: string,
  contents: Content[]
): Promise<{ text: string; tokens?: number }> {
  const ai = getAiClient();
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  const res = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      temperature: 0.6,
      maxOutputTokens: 1200,
    },
  });

  const tokens = res.usageMetadata?.totalTokenCount;
  return { text: res.text ?? '', tokens };
}

export async function runTurn(
  system: string,
  history: Content[],
  retries = 1
): Promise<{ output: ModelOutput; tokens?: number }> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const raw = await withTimeout(generateJson(system, history), 25000);
      const parsed = JSON.parse(raw.text);
      const validated = ModelOutput.parse(parsed);
      return { output: validated, tokens: raw.tokens };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
