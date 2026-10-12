import { test, describe } from 'node:test';
import assert from 'node:assert';
import { CoThinkEngine } from './cothink-engine';

describe('Co-Thinker 8-Step Flowchart Engine', () => {
  const engine = new CoThinkEngine();

  test('Step 0 (welcome) -> Step 1 (describe_problem) when starting new problem', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'welcome',
        conversationHistory: [],
      },
      'Start a totally new problem',
      'start_new'
    );

    assert.strictEqual(res.nextStep, 'describe_problem');
    assert.ok(res.message.includes('Describe the dilemma'));
  });

  test('Step 1 (describe_problem) -> Step 2 (clarify_objective)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'describe_problem',
        conversationHistory: [],
      },
      'Our team is struggling with microservices latency and tracing overhead.'
    );

    assert.strictEqual(res.nextStep, 'clarify_objective');
    assert.ok(res.message.includes('clarify your primary objective'));
    assert.ok(res.options && res.options.length > 0);
  });

  test('Step 2 (clarify_objective) -> Step 3 (break_subproblems)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'clarify_objective',
        conversationHistory: [],
      },
      'We need to isolate the root bottleneck and improve latency under 50ms.'
    );

    assert.strictEqual(res.nextStep, 'break_subproblems');
    assert.ok(res.message.includes('break the problem into subproblems'));
  });

  test('Step 3 (break_subproblems) -> Step 4 (explore_perspectives)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'break_subproblems',
        conversationHistory: [],
      },
      'Subproblem 1: Immovable constraints & bottlenecks'
    );

    assert.strictEqual(res.nextStep, 'explore_perspectives');
    assert.ok(res.message.includes('explore different perspectives and evidence'));
  });

  test('Step 4 (explore_perspectives) -> Step 5 (challenge_assumptions)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'explore_perspectives',
        conversationHistory: [],
      },
      'I lean toward the Pragmatist perspective.'
    );

    assert.strictEqual(res.nextStep, 'challenge_assumptions');
    assert.ok(res.message.includes('challenge the underlying assumptions'));
  });

  test('Step 5 (challenge_assumptions) -> Step 6 (check_satisfaction)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'challenge_assumptions',
        conversationHistory: [],
      },
      'We will run a 2-day low-risk spike.'
    );

    assert.strictEqual(res.nextStep, 'check_satisfaction');
    assert.ok(res.message.includes('Are you satisfied with our understanding'));
    assert.ok(res.options?.some((o) => o.id === 'sat_yes'));
    assert.ok(res.options?.some((o) => o.id === 'sat_no'));
  });

  test('Step 6 (check_satisfaction) LOOPBACK: "Not yet" loops back to Step 4 (explore_perspectives)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'check_satisfaction',
        conversationHistory: [],
      },
      'Not yet',
      'sat_no'
    );

    assert.strictEqual(res.nextStep, 'explore_perspectives');
    assert.ok(res.message.includes('Let\'s dig deeper into the problem dynamics'));
  });

  test('Step 6 (check_satisfaction) FORWARD: "Yes" advances to Step 7 (summarize_insights)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'check_satisfaction',
        conversationHistory: [],
      },
      'Yes, I am satisfied with our understanding',
      'sat_yes'
    );

    assert.strictEqual(res.nextStep, 'summarize_insights');
    assert.ok(res.message.includes('Structured Co-Thinking Synthesis'));
  });

  test('Step 7 (summarize_insights) -> Step 8 (choose_action)', async () => {
    const res = await engine.processStep(
      {
        userName: 'Lakshith Reddy',
        step: 'summarize_insights',
        conversationHistory: [],
      },
      'Proceed to choose concrete next action'
    );

    assert.strictEqual(res.nextStep, 'choose_action');
    assert.ok(res.message.includes('Choose Your Next Action'));
    assert.ok(res.options && res.options.length > 0);
  });
});
