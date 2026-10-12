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

  test('Validates authoritative stage progression transitions', () => {
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('welcome', 'describe_problem').allowed, true);
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('describe_problem', 'clarify_objective').allowed, true);
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('break_subproblems', 'explore_perspectives').allowed, true);
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('challenge_assumptions', 'check_satisfaction').allowed, true);
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('check_satisfaction', 'summarize_insights').allowed, true);
    assert.strictEqual(WorkflowStateMachine.validateStageTransition('summarize_insights', 'choose_action').allowed, true);

    // Illegal skip from welcome to choose_action
    const invalidSkip = WorkflowStateMachine.validateStageTransition('welcome', 'choose_action');
    assert.strictEqual(invalidSkip.allowed, false);
    assert.ok(invalidSkip.reason?.includes('Illegal workflow stage jump'));
  });

  test('Maps stages to authoritative 5 thinking modes', () => {
    assert.strictEqual(WorkflowStateMachine.getModeForStage('welcome'), 'understand');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('describe_problem'), 'understand');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('clarify_objective'), 'understand');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('break_subproblems'), 'explore');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('explore_perspectives'), 'explore');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('challenge_assumptions'), 'challenge');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('check_satisfaction'), 'challenge');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('summarize_insights'), 'decide');
    assert.strictEqual(WorkflowStateMachine.getModeForStage('choose_action'), 'act');
  });

  test('deriveCurrentStage honors authoritative persistedStage across retries/loopbacks', () => {
    // If the database has persisted describe_problem, even if messageCount > 2 (from retries),
    // it must NEVER guess clarify_objective
    const stage = WorkflowStateMachine.deriveCurrentStage('understand', 5, 'describe_problem');
    assert.strictEqual(stage, 'describe_problem');

    // Without persistedStage, it uses legacy message count derivation
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 0), 'welcome');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 1), 'describe_problem');
    assert.strictEqual(WorkflowStateMachine.deriveCurrentStage('understand', 3), 'clarify_objective');
  });
});
