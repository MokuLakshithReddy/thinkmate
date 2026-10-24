import { GoogleGenAI } from '@google/genai';

const getAi = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface ResearchSource {
  uri: string;
  title?: string;
}

export interface ResearchResult {
  text: string;
  sources: ResearchSource[];
}

export async function research(question: string, context: string): Promise<ResearchResult> {
  const ai = getAi();
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Question: ${question}\nProblem context: ${context}\nAnswer in under 200 words. Separate what the sources report from your own interpretation. State conflicts and limits.`,
          },
        ],
      },
    ],
    config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
  });

  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources: ResearchSource[] = chunks
    .map((c: any) => ({
      uri: (c.web?.uri as string) || '',
      title: c.web?.title as string | undefined,
    }))
    .filter((s) => Boolean(s.uri))
    .slice(0, 6);

  return { text: res.text ?? '', sources };
}
