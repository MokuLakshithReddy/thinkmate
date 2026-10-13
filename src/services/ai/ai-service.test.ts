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

  test('Rolling buffer parser captures metadata marker split across chunk boundaries', () => {
    // Simulate Gemini API emitting chunks where ```json:thinkmate-meta is cut across 3 pieces
    const splitChunks = [
      'Here is the analysis of the trade-offs.\n\n',
      'The core conclusion is sound.\n```json:',
      'thinkmate-',
      'meta\n{\n  "suggestedQuestions": ["What is next?"],\n  "insights": []\n}\n```',
    ];

    const emittedTokens: string[] = [];
    const result = GeminiThinkingService.processStreamChunksWithRollingBuffer(
      splitChunks,
      (token) => emittedTokens.push(token)
    );

    const fullEmittedText = emittedTokens.join('');
    // The tokens emitted should NOT include the marker ```json:thinkmate-meta
    assert.ok(fullEmittedText.includes('Here is the analysis of the trade-offs'));
    assert.ok(fullEmittedText.includes('The core conclusion is sound'));
    assert.strictEqual(fullEmittedText.includes('thinkmate-meta'), false, 'Marker prefix must not leak into stream tokens');

    // Metadata buffer must have captured the JSON payload
    assert.ok(result.capturedJson.includes('"suggestedQuestions"'));
    assert.ok(result.capturedJson.includes('What is next?'));
  });
});
