import { z } from 'zod';

/**
 * Authoritative Centralized Gemini Model Registry
 *
 * Retired Models (Shut down September 29, 2025 per official Google Gemini API release notes):
 * - gemini-1.5-pro (RETIRED)
 * - gemini-1.5-flash (RETIRED)
 *
 * Current Supported Active Models:
 * - gemini-2.5-flash: Default recommended model. Fast reasoning, balanced latency and cost.
 * - gemini-2.5-pro: Deep multi-hop synthesis and complex architectural reasoning.
 */
export const SUPPORTED_GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

export type SupportedGeminiModel = (typeof SUPPORTED_GEMINI_MODELS)[number];

export const DEFAULT_GEMINI_MODEL: SupportedGeminiModel = 'gemini-2.5-flash';

export const SupportedModelSchema = z
  .enum(SUPPORTED_GEMINI_MODELS)
  .default(DEFAULT_GEMINI_MODEL);

export interface ModelMetadata {
  id: SupportedGeminiModel;
  name: string;
  tagline: string;
  description: string;
  isDefault?: boolean;
}

export const GEMINI_MODEL_METADATA: Record<SupportedGeminiModel, ModelMetadata> = {
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    tagline: 'Recommended: Fast & Deep Reasoning',
    description: 'Ultra-low latency with advanced multimodal reasoning. Ideal for real-time interactive co-thinking.',
    isDefault: true,
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    tagline: 'Advanced: Deep Multi-Hop Synthesis',
    description: 'Deep analytical thinking for complex trade-offs, formal decision trees, and architectural planning.',
  },
};

export function isValidModel(model: string): model is SupportedGeminiModel {
  return SUPPORTED_GEMINI_MODELS.includes(model as SupportedGeminiModel);
}
