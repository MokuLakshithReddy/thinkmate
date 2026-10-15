import { z } from 'zod';
import { ThinkingMode, Insight } from '@/types';

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'Message content cannot be empty'),
  mode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']).optional(),
});

import { SUPPORTED_GEMINI_MODELS, DEFAULT_GEMINI_MODEL, type SupportedGeminiModel } from '@/config/models';
export type { SupportedGeminiModel };

export const ThinkStreamRequestSchema = z.object({
  sessionId: z.string().min(1).max(100),
  problemStatement: z.string().min(1).max(10000),
  currentMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']),
  messages: z.array(MessageSchema).max(50),
  model: z.enum(SUPPORTED_GEMINI_MODELS).default(DEFAULT_GEMINI_MODEL),
});

export type ThinkStreamRequest = z.infer<typeof ThinkStreamRequestSchema>;

export interface StreamEventToken {
  type: 'token';
  token: string;
}

export interface StreamEventQuestions {
  type: 'questions';
  questions: string[];
}

export interface StreamEventInsights {
  type: 'insights';
  insights: Partial<Insight>[];
}

export interface StreamEventSuggestedMode {
  type: 'suggestedMode';
  mode: ThinkingMode;
}

export interface StreamEventError {
  type: 'error';
  error: string;
}

export type ThinkingStreamEvent =
  | StreamEventToken
  | StreamEventQuestions
  | StreamEventInsights
  | StreamEventSuggestedMode
  | StreamEventError;

export interface ThinkingAIService {
  generateThinkingStream(
    request: ThinkStreamRequest,
    onEvent: (event: ThinkingStreamEvent) => void
  ): Promise<void>;
}
