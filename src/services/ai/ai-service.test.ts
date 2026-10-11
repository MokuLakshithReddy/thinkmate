import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ThinkStreamRequestSchema, ThinkingStreamEvent } from './types';
import { GeminiThinkingService } from './gemini-service';

describe('AI Thinking Service & Zod Validation', () => {
  test('Validates complete ThinkStreamRequest schema', () => {
    const validData = {
      sessionId: 'sess-123',
      problemStatement: 'Should we rewrite into Rust?',
      currentMode: 'understand',
      messages: [
        { role: 'user', content: 'What are the main trade-offs?' },
      ],
      model: 'gemini-2.5-flash',
    };

    const parsed = ThinkStreamRequestSchema.safeParse(validData);
    assert.strictEqual(parsed.success, true);
  });

  test('Rejects invalid mode or empty content', () => {
    const invalidData = {
      sessionId: 'sess-123',
      problemStatement: '',
      currentMode: 'invalid_mode',
      messages: [{ role: 'user', content: '' }],
    };

    const parsed = ThinkStreamRequestSchema.safeParse(invalidData);
    assert.strictEqual(parsed.success, false);
  });

  test('GeminiThinkingService generates events across modes in resilient fallback', async () => {
    const service = new GeminiThinkingService();
    const events: ThinkingStreamEvent[] = [];

    await service.generateThinkingStream(
      {
        sessionId: 'sess-test',
        problemStatement: 'Need to choose database: PostgreSQL or DynamoDB',
        currentMode: 'explore',
        messages: [{ role: 'user', content: 'Explore options' }],
        model: 'gemini-2.5-flash',
      },
      (event) => {
        events.push(event);
      }
    );

    const tokenEvents = events.filter((e) => e.type === 'token');
    const questionEvents = events.filter((e) => e.type === 'questions');
    const insightEvents = events.filter((e) => e.type === 'insights');

    assert.ok(tokenEvents.length > 0, 'Should emit token events');
    assert.ok(questionEvents.length > 0, 'Should emit suggested questions');
    assert.ok(insightEvents.length > 0, 'Should emit extracted insights');
  });
});
