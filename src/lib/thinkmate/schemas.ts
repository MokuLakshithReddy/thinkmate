import { z } from 'zod';

export const Mode = z.enum(['guide', 'balanced', 'ideas']);
export type Mode = z.infer<typeof Mode>;

export const GuidanceMode = z.enum(['question', 'hint', 'challenge', 'explain', 'example']);
export type GuidanceMode = z.infer<typeof GuidanceMode>;

export const ItemKind = z.enum(['claim', 'hypothesis', 'idea', 'counterargument', 'experiment', 'question']);
export type ItemKind = z.infer<typeof ItemKind>;

export const TurnInput = z.object({
  message: z.string().trim().min(1).max(4000),
  client_msg_id: z.string().uuid().optional(),
});
export type TurnInput = z.infer<typeof TurnInput>;

export const ProposedItem = z.object({
  kind: ItemKind,
  text: z.string().min(3).max(400),
  origin: z.enum(['user', 'ai']),
});
export type ProposedItem = z.infer<typeof ProposedItem>;

export const ModelOutput = z.preprocess((val: unknown) => {
  if (typeof val === 'object' && val !== null) {
    const raw = val as Record<string, unknown>;
    // If the model output used proposed_claims / proposed_questions (B4 shape), adapt to proposed_items (C1 shape)
    if (!raw.proposed_items && (Array.isArray(raw.proposed_claims) || Array.isArray(raw.proposed_questions))) {
      const items: unknown[] = [];
      if (Array.isArray(raw.proposed_claims)) {
        for (const c of raw.proposed_claims) {
          items.push({ kind: 'claim', text: c.text, origin: c.origin ?? 'ai' });
        }
      }
      if (Array.isArray(raw.proposed_questions)) {
        for (const q of raw.proposed_questions) {
          items.push({ kind: 'question', text: typeof q === 'string' ? q : q.text, origin: 'ai' });
        }
      }
      return { ...raw, proposed_items: items };
    }
  }
  return val;
}, z.object({
  reply: z.string().min(1).max(4000),
  guidance_mode: GuidanceMode,
  proposed_problem_frame: z.string().min(10).max(500).nullish(),
  proposed_items: z
    .array(ProposedItem)
    .default([])
    .transform((a) => a.slice(0, 4)),
}));

export type ModelOutput = z.infer<typeof ModelOutput>;
