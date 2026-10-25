/**
 * Centralized, resilient AI Model Fallback & Error Classification
 *
 * Implements bounded fallback across supported Gemini models for transient availability
 * errors (503, 500, timeouts, unavailable, overloaded) while strictly preventing retry
 * loops on non-retryable client errors (authentication 401/403, quota exhaustion 429,
 * or payload validation 400).
 */

export function isTransientModelError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  // Non-retryable errors: do NOT switch models or blindly retry
  if (
    msg.includes('api_key') ||
    msg.includes('api key') ||
    msg.includes('unauthorized') ||
    msg.includes('permission_denied') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('invalid_argument') ||
    msg.includes('bad request')
  ) {
    return false;
  }

  // Transient availability or infrastructure errors that warrant fallback
  if (
    msg.includes('unavailable') ||
    msg.includes('timeout') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('overloaded') ||
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('not found') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed')
  ) {
    return true;
  }

  // Default to true for ambiguous network errors
  return true;
}

export function getFallbackModelChain(primaryModel: string): string[] {
  const chain = [primaryModel];
  const candidates = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.8-flash'];
  for (const m of candidates) {
    if (!chain.includes(m)) {
      chain.push(m);
    }
  }
  return chain;
}
