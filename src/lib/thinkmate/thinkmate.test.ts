import { describe, it } from 'node:test';
import assert from 'node:assert';
import { questionStreak, originLooksRight, norm } from './state';
import { ModelOutput, ItemKind } from './schemas';
import { canMove, suggestStage, type Stage, type Counts } from './stages';
import { chooseAction, type Signals } from './policy';
import { verificationOf } from './evidence';

describe('ThinkMate v0.1 & v1.0 Core Engine Unit Tests', () => {
  describe('questionStreak', () => {
    it('counts consecutive trailing question-only assistant messages', () => {
      const messages = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', guidance_mode: 'question' },
        { role: 'assistant', guidance_mode: 'question' },
        { role: 'assistant', guidance_mode: 'question' },
      ];
      assert.strictEqual(questionStreak(messages), 3);
    });

    it('resets streak when assistant gives a hint or explanation', () => {
      const messages = [
        { role: 'assistant', guidance_mode: 'question' },
        { role: 'assistant', guidance_mode: 'hint' },
        { role: 'assistant', guidance_mode: 'question' },
      ];
      assert.strictEqual(questionStreak(messages), 1);
    });
  });

  describe('originLooksRight provenance guard', () => {
    it('accepts user origin when claim shares >= 40% meaningful words with user text', () => {
      const userText = 'Students always miss morning workshops because notifications are sent late';
      const claim = 'Students miss morning workshops due to late notifications';
      assert.strictEqual(originLooksRight(claim, userText), true);
    });

    it('rejects user origin and requires downgrade to ai when claim does not share words', () => {
      const userText = 'Maybe we should build an app?';
      const claim = 'Farmers lack irrigation data during dry season';
      assert.strictEqual(originLooksRight(claim, userText), false);
    });
  });

  describe('ModelOutput Schema Validation', () => {
    it('accepts valid model output with proposed items', () => {
      const valid = {
        reply: 'Can you tell me what happens when workshops are announced?',
        guidance_mode: 'question',
        proposed_problem_frame: 'Workshop notifications reach students too late for morning sessions',
        proposed_items: [
          { kind: 'claim', text: 'Workshop alerts are sent after 11 PM', origin: 'user' },
          { kind: 'question', text: 'Which platform do organizers use?', origin: 'ai' },
        ],
      };
      const res = ModelOutput.parse(valid);
      assert.strictEqual(res.reply, valid.reply);
      assert.strictEqual(res.proposed_items.length, 2);
    });

    it('adapts legacy proposed_claims and proposed_questions into proposed_items', () => {
      const legacy = {
        reply: 'What evidence indicates students hear too late?',
        guidance_mode: 'question',
        proposed_claims: [{ text: 'Students miss announcements', origin: 'user' }],
        proposed_questions: ['How do announcements get sent?'],
      };
      const res = ModelOutput.parse(legacy);
      assert.strictEqual(res.proposed_items.length, 2);
      assert.strictEqual(res.proposed_items[0].kind, 'claim');
      assert.strictEqual(res.proposed_items[1].kind, 'question');
    });

    it('rejects output missing reply or with invalid guidance_mode', () => {
      assert.throws(() => {
        ModelOutput.parse({ guidance_mode: 'question' });
      });
      assert.throws(() => {
        ModelOutput.parse({ reply: 'Hello', guidance_mode: 'invalid_mode' });
      });
    });
  });

  describe('Stage Transitions and Suggestions', () => {
    it('permits moving forward by at most one step', () => {
      assert.strictEqual(canMove('orient', 'frame'), true);
      assert.strictEqual(canMove('frame', 'investigate'), true);
    });

    it('refuses skipping ahead two or more steps', () => {
      assert.strictEqual(canMove('orient', 'investigate'), false);
      assert.strictEqual(canMove('orient', 'diverge'), false);
    });

    it('always permits moving backward to any earlier stage', () => {
      assert.strictEqual(canMove('diverge', 'orient'), true);
      assert.strictEqual(canMove('communicate', 'frame'), true);
    });

    it('suggests stages based on milestone counts', () => {
      const unconfirmed: Counts = {
        hasMessages: true,
        frameConfirmed: false,
        claims: 0,
        hypotheses: 0,
        ideas: 0,
        counterarguments: 0,
        experiments: 0,
        evidenceLinked: 0,
        decided: false,
      };
      assert.strictEqual(suggestStage(unconfirmed), 'frame');

      const withEvidence: Counts = {
        hasMessages: true,
        frameConfirmed: true,
        claims: 2,
        hypotheses: 0,
        ideas: 0,
        counterarguments: 0,
        experiments: 0,
        evidenceLinked: 1,
        decided: false,
      };
      assert.strictEqual(suggestStage(withEvidence), 'diverge');
    });
  });

  describe('Guidance Policy Signals & Action Selection', () => {
    const baseSignals: Signals = {
      mode: 'balanced',
      stage: 'investigate',
      directRequest: false,
      frameConfirmed: true,
      frameText: 'A well framed problem statement with sufficient length and clarity.',
      questionStreak: 0,
      stuck: false,
      unsupportedConfirmed: 0,
      ideas: 0,
      turnsSinceSummary: 2,
      decided: false,
      lastAction: null,
    };

    it('direct request always triggers explain or example', () => {
      const s = { ...baseSignals, directRequest: true };
      assert.strictEqual(chooseAction(s), 'explain');
    });

    it('three question replies in a row forces hint or example', () => {
      const s = { ...baseSignals, questionStreak: 3, stuck: false };
      assert.strictEqual(chooseAction(s), 'hint');

      const sStuck = { ...baseSignals, questionStreak: 3, stuck: true };
      assert.strictEqual(chooseAction(sStuck), 'example');
    });

    it('unsupported confirmed claims trigger request_evidence', () => {
      const s = { ...baseSignals, unsupportedConfirmed: 2, lastAction: 'ask' };
      assert.strictEqual(chooseAction(s), 'request_evidence');
    });

    it('guide mode never volunteers expand or example without direct request', () => {
      const s: Signals = {
        ...baseSignals,
        mode: 'guide',
        stage: 'diverge',
        questionStreak: 1,
      };
      assert.strictEqual(chooseAction(s), 'ask');
    });
  });

  describe('Evidence Verification Logic', () => {
    it('recomputes verification status accurately based on relations', () => {
      assert.strictEqual(verificationOf([]), 'unassessed');
      assert.strictEqual(verificationOf(['context']), 'unassessed');
      assert.strictEqual(verificationOf(['supports']), 'supported');
      assert.strictEqual(verificationOf(['contradicts']), 'contradicted');
      assert.strictEqual(verificationOf(['supports', 'contradicts']), 'mixed');
    });
  });
});
