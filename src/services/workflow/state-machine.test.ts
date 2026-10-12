import { test, describe } from 'node:test';
import assert from 'node:assert';
import { WorkflowStateMachine } from './state-machine';

describe('Workflow State Machine & Guardrails', () => {
  test('Permits standard forward transition from Understand to Explore', () => {
    const res = WorkflowStateMachine.validateTransition('understand', 'explore');
    assert.strictEqual(res.allowed, true);
  });

  test('Permits backward transition from Challenge to Explore', () => {
    const res = WorkflowStateMachine.validateTransition('challenge', 'explore');
    assert.strictEqual(res.allowed, true);
  });

  test('Blocks jumping directly from Understand to Decide without exploration', () => {
    const res = WorkflowStateMachine.validateTransition('understand', 'decide');
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.recommendedMode, 'explore');
  });

  test('Blocks transition to Act mode without any accepted decision', () => {
    const res = WorkflowStateMachine.validateTransition('decide', 'act', {
      hasAcceptedDecision: false,
      insights: [
        {
          id: '1',
          sessionId: 's',
          category: 'decision',
          title: 'Proposal',
          content: 'text',
          status: 'under_review',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.recommendedMode, 'decide');
  });

  test('Allows transition to Act when an accepted decision is present', () => {
    const res = WorkflowStateMachine.validateTransition('decide', 'act', {
      hasAcceptedDecision: true,
      insights: [
        {
          id: '1',
          sessionId: 's',
          category: 'decision',
          title: 'Proposal',
          content: 'text',
          status: 'accepted',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    assert.strictEqual(res.allowed, true);
  });

  test('Respects userOverride flag for intentional workflow jumps', () => {
    const res = WorkflowStateMachine.validateTransition('understand', 'act', {
      userOverride: true,
    });
    assert.strictEqual(res.allowed, true);
  });

  test('Strictly denies unconventional transitions without explicit user override', () => {
    // Act directly to Explore is not an allowed direct transition in state machine
    const res = WorkflowStateMachine.validateTransition('act', 'explore');
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes('disallowed by state machine guardrails'));
  });
});
