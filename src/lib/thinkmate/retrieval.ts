import { GoogleGenAI } from '@google/genai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { flags } from './flags';

const getAi = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function embed(texts: string[], task: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  const ai = getAi();
  const res = await ai.models.embedContent({
    model: 'gemini-embedding-001',
    contents: texts,
    config: { taskType: task, outputDimensionality: 768 },
  });
  return (res.embeddings ?? []).map((e) => e.values as number[]);
}

// Returns null when everything should be sent; otherwise returns the item IDs worth sending
export async function relevantIds(
  sb: SupabaseClient,
  ws: string,
  message: string,
  confirmedCount: number
): Promise<Set<string> | null> {
  if (flags.retrieval === 'off' || confirmedCount <= 25) return null;

  if (flags.retrieval === 'vector') {
    try {
      const [v] = await embed([message], 'RETRIEVAL_QUERY');
      const { data } = await sb.rpc('tm_match_items', { ws, query: v, lim: 10 });
      if (data && Array.isArray(data)) {
        return new Set<string>((data as Array<{ id: string }>).map((r) => r.id));
      }
    } catch {
      // Fall through to FTS if vector call is unavailable
    }
  }

  const { data } = await sb.rpc('tm_search_items', { ws, q: message, lim: 10 });
  return new Set<string>(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}
