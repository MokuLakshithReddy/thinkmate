import { GoogleGenAI } from '@google/genai';
import { CoThinkerStep, ChoiceOption, WORKFLOW_STAGES } from '@/types';

export interface CoThinkPromptContext {
  userName?: string;
  step: CoThinkerStep;
  problemStatement?: string;
  clarifiedObjective?: string;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
  activeSessionTitle?: string;
  isDemo?: boolean;
  model?: string;
}

export interface CoThinkStepResponse {
  message: string;
  nextStep: CoThinkerStep;
  options?: ChoiceOption[];
  progressPercent: number;
  executionMode: 'gemini' | 'simulator' | 'error';
  modelName?: string;
  simulatedNotice?: string;
}

export class CoThinkEngine {
  private ai: GoogleGenAI | null = null;
  private hasApiKey: boolean = false;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
      this.hasApiKey = true;
    }
  }

  async processStep(
    context: CoThinkPromptContext,
    userMessage: string,
    selectedOptionId?: string
  ): Promise<CoThinkStepResponse> {
    // If explicitly marked as an isolated interactive demo request
    if (context.isDemo) {
      const simulated = this.runFlowchartStep(context.step, userMessage, selectedOptionId, context);
      return {
        ...simulated,
        executionMode: 'simulator',
        simulatedNotice: 'Interactive Demo Mode: Running deterministic offline thinking simulator.',
      };
    }

    // If Gemini client is available, attempt real live model generation
    if (this.ai && this.hasApiKey) {
      try {
        const liveResult = await this.generateWithGemini(context, userMessage, selectedOptionId);
        return liveResult;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.warn('Gemini API call failed:', errorMessage);

        // In production, return an explicit retryable provider error instead of faking success
        if (process.env.NODE_ENV === 'production') {
          return {
            message: 'The AI thinking provider is temporarily unavailable. Please retry in a few moments.',
            nextStep: context.step,
            progressPercent: this.getProgressPercent(context.step),
            executionMode: 'error',
            simulatedNotice: `AI provider error: ${errorMessage}. Please retry.`,
          };
        }

        // In non-production development/test fallback:
        const simulated = this.runFlowchartStep(context.step, userMessage, selectedOptionId, context);
        return {
          ...simulated,
          executionMode: 'simulator',
          simulatedNotice: `Development Fallback: Live model call failed (${errorMessage}). Running deterministic flowchart engine.`,
        };
      }
    }

    // No API key configured
    if (process.env.NODE_ENV === 'production') {
      return {
        message: 'The AI thinking provider is not configured on this server.',
        nextStep: context.step,
        progressPercent: this.getProgressPercent(context.step),
        executionMode: 'error',
        simulatedNotice: 'Configuration error: GEMINI_API_KEY is not set.',
      };
    }

    // Non-production offline fallback
    const simulated = this.runFlowchartStep(context.step, userMessage, selectedOptionId, context);
    return {
      ...simulated,
      executionMode: 'simulator',
      simulatedNotice: 'Offline Demo Mode: Running deterministic co-thinking simulator (no GEMINI_API_KEY detected).',
    };
  }

  private getProgressPercent(step: CoThinkerStep): number {
    const percentages: Record<CoThinkerStep, number> = {
      welcome: 0,
      describe_problem: 12,
      clarify_objective: 25,
      break_subproblems: 37,
      explore_perspectives: 50,
      challenge_assumptions: 65,
      check_satisfaction: 75,
      summarize_insights: 88,
      choose_action: 100,
    };
    return percentages[step] ?? 50;
  }

  private runFlowchartStep(
    currentStep: CoThinkerStep,
    userMessage: string,
    selectedOptionId?: string,
    context?: CoThinkPromptContext
  ): Omit<CoThinkStepResponse, 'executionMode' | 'simulatedNotice'> {
    const problem = context?.problemStatement || (currentStep === 'describe_problem' ? userMessage.trim() : '');
    const objective = context?.clarifiedObjective || (currentStep === 'clarify_objective' ? userMessage.trim() : '');

    switch (currentStep) {
      case 'welcome': {
        // If resuming an actual session
        if (selectedOptionId?.startsWith('resume_')) {
          return {
            nextStep: 'explore_perspectives',
            progressPercent: 50,
            message: `Resuming session: **${context?.activeSessionTitle || 'Saved Session'}**.\n\nPreviously established objective:\n> *"${objective || 'Explore problem perspectives and evidence'}"*\n\nLet's evaluate remaining perspectives and uncertainties. Which area feels most critical right now?`,
            options: [
              { id: 'persp_constraints', label: 'Explore technical and operational constraints' },
              { id: 'persp_users', label: 'Evaluate end-user and stakeholder expectations' },
              { id: 'persp_tradeoffs', label: 'Weigh architectural and execution trade-offs' },
            ],
          };
        }

        // Fresh session kickoff
        return {
          nextStep: 'describe_problem',
          progressPercent: 12,
          message:
            "Let's deconstruct your problem together.\n\nDescribe the dilemma, challenge, or situation on your mind. Don't worry about structuring it perfectly—convey what is happening, what feels difficult, and what outcome you need.",
        };
      }

      case 'describe_problem': {
        const trimmed = userMessage.trim();
        // Guardrail: Do not advance if message is too vague or empty
        if (trimmed.length < 8) {
          return {
            nextStep: 'describe_problem',
            progressPercent: 15,
            message:
              "To help you think through this effectively, please provide a bit more context. What specific situation, technical challenge, or dilemma are you trying to resolve?",
          };
        }

        return {
          nextStep: 'clarify_objective',
          progressPercent: 25,
          message:
            `Thank you for sharing that context. Here is how I understand the situation:\n\n> *"${trimmed}"*\n\nBefore exploring solutions, let's step back and **clarify your primary objective**.\n\nIn complex dilemmas, the initial problem description often masks competing goals (e.g. shipping quickly vs long-term maintainability, control vs scalability). What is the single most critical outcome you need to achieve?`,
          options: [
            { id: 'obj_clarify_root', label: 'Isolate the core bottleneck without premature solutions' },
            { id: 'obj_decouple_risk', label: 'De-risk the highest uncertainty while moving fast' },
            { id: 'obj_align_tradeoffs', label: 'Evaluate clear trade-offs before committing resources' },
          ],
        };
      }

      case 'clarify_objective': {
        const objText = userMessage.trim() || 'Achieve resolution on primary constraint';
        return {
          nextStep: 'break_subproblems',
          progressPercent: 40,
          message:
            `Target Objective: **${objText}**.\n\nWith our objective clarified, let's **break the problem into subproblems** to make it manageable:\n\n1. **Subproblem 1: Core Constraint Identification**\n   What is the immovable bottleneck (time, architecture, capacity, or cognitive load)?\n\n2. **Subproblem 2: Boundary & Scope Decoupling**\n   What components can be isolated or solved independently without cascading side-effects?\n\n3. **Subproblem 3: Reversibility & Blast Radius**\n   Which choices are two-way doors (easy to undo) versus one-way doors (hard to reverse)?\n\nWhich subproblem represents the heaviest uncertainty for you right now?`,
          options: [
            { id: 'sub_constraint', label: 'Subproblem 1: Immovable constraints & bottlenecks' },
            { id: 'sub_scope', label: 'Subproblem 2: Scope boundaries & architectural coupling' },
            { id: 'sub_reversibility', label: 'Subproblem 3: Reversibility & commitment cost' },
          ],
        };
      }

      case 'break_subproblems': {
        const problemSummary = problem ? ` regarding "${problem.slice(0, 60)}..."` : '';
        return {
          nextStep: 'explore_perspectives',
          progressPercent: 55,
          message:
            `Now let's **explore different perspectives and evidence**${problemSummary}:\n\n- **Perspective A (The Pragmatist / Incrementalist):**\n  Focus on small, high-certainty interventions. Fix immediate friction points without large rewrites or high upfront commitments.\n\n- **Perspective B (The Structuralist / Architect):**\n  Address root-cause design flaws. Invest upfront in clean boundaries and decoupled abstractions to prevent recurring pain.\n\n- **Perspective C (The User / Stakeholder Lens):**\n  Focus purely on user-facing friction and reliability, deferring internal cleanup until customer confidence is restored.\n\nWhich perspective aligns closest with your intuition, or is there another angle we should evaluate?`,
          options: [
            { id: 'persp_pragmatist', label: 'Lean toward the Pragmatist (low-risk, iterative)' },
            { id: 'persp_architect', label: 'Lean toward the Structuralist (root-cause structural fix)' },
            { id: 'persp_user', label: 'Lean toward User/Stakeholder confidence first' },
          ],
        };
      }

      case 'explore_perspectives': {
        const problemExcerpt = problem ? ` regarding "${problem.slice(0, 60)}..."` : '';
        return {
          nextStep: 'challenge_assumptions',
          progressPercent: 70,
          message:
            `Now let's **challenge the underlying assumptions**${problemExcerpt}:\n\n- **[USER-PROVIDED CLAIM]:** Primary objective is "${objective || 'Resolve core bottleneck'}".\n- **[TESTABLE HYPOTHESIS]:** "The chosen intervention will address the root friction without disproportionate side-effects."\n- **[UNVERIFIED ASSUMPTION]:** "All critical constraints are known upfront." (Hidden operational or team dependencies often emerge late).\n\nNotice where our current thinking relies on unverified hypotheses rather than proven evidence. How would you test your riskiest assumption before committing major effort?`,
          options: [
            { id: 'test_assumption_pilot', label: 'Run a focused, low-risk prototype or spike' },
            { id: 'test_assumption_audit', label: 'Gather empirical baseline data and verify metrics' },
            { id: 'test_assumption_interview', label: 'Validate directly with core stakeholders / users' },
          ],
        };
      }

      case 'challenge_assumptions': {
        return {
          nextStep: 'check_satisfaction',
          progressPercent: 82,
          message:
            `We have clarified your objective, decomposed subproblems, explored multiple perspectives, and stress-tested key assumptions.\n\n**Are you satisfied with our understanding of the problem so far?**\n\nTake a moment to reflect: does this capture the true heart of your dilemma, or is there an important dimension or evidence we should explore further?`,
          options: [
            { id: 'sat_yes', label: 'Yes — I am satisfied with our understanding' },
            { id: 'sat_no', label: 'Not yet — Let\'s explore more perspectives or dig deeper' },
          ],
        };
      }

      case 'check_satisfaction': {
        const isNotSatisfied =
          selectedOptionId === 'sat_no' ||
          userMessage.toLowerCase().includes('not yet') ||
          userMessage.toLowerCase().includes('more perspectives') ||
          userMessage.toLowerCase().includes('dig deeper');

        if (isNotSatisfied) {
          // Flowchart loopback to Step 4 (Explore perspectives and evidence)
          return {
            nextStep: 'explore_perspectives',
            progressPercent: 55,
            message:
              `Understood. Let's dig deeper into the problem dynamics.\n\nWhat specific perspective, counter-argument, or hidden constraint feels missing or unresolved? Let's bring that evidence into the conversation.`,
          };
        }

        // Forward transition to Step 7 (Summarize insights and options)
        return {
          nextStep: 'summarize_insights',
          progressPercent: 92,
          message:
            `### Structured Co-Thinking Synthesis\n\nHere is what we have established together:\n\n1. **Clarified Objective:** ${objective || 'Resolve primary constraint with balanced trade-offs'}\n2. **Decomposed Subproblems:** Identified core friction points and isolated bounded areas of uncertainty.\n3. **Examined Perspectives:** Weighed immediate pragmatic resolution against deeper structural solutions.\n4. **Assumptions Tested:** Isolated unverified assumptions that require quick empirical validation.\n5. **Viable Paths:**\n   - **Path A (Targeted Verification):** Test the hardest uncertainty in a bounded proof-of-concept.\n   - **Path B (Structured Rollout):** Establish explicit verification criteria and guardrails before full commitment.\n\nWe are ready to translate this understanding into action.`,
          options: [
            { id: 'action_proceed', label: 'Proceed to choose concrete next action' },
            { id: 'action_revisit', label: 'Revisit a specific insight before locking in' },
          ],
        };
      }

      case 'summarize_insights': {
        return {
          nextStep: 'choose_action',
          progressPercent: 100,
          message:
            `### Choose Your Next Action\n\nTo turn this clear understanding into momentum, select your immediate next step:\n\n1. **Targeted Spike:** Execute a focused, timeboxed validation on the single highest-uncertainty area.\n2. **Decision Record:** Document the clarified objective, rejected alternatives, and stop conditions.\n3. **Stakeholder Alignment:** Review the decomposed problem structure and agreed trade-offs with affected parties.\n\nWhich action will you commit to first?`,
          options: [
            { id: 'act_pilot', label: 'Execute Timeboxed Focused Spike / Prototype' },
            { id: 'act_adr', label: 'Document Decision Record & Guardrails' },
            { id: 'act_briefing', label: 'Align with Stakeholders on Problem Scope' },
          ],
        };
      }

      case 'choose_action': {
        return {
          nextStep: 'welcome',
          progressPercent: 100,
          message:
            `Action locked in! 🎯\n\nYou have turned a complex dilemma into a verified, actionable next step.\n\nYour session insights have been saved. Whenever you're ready, we can check in on execution progress or tackle another problem!`,
          options: [
            { id: 'start_new', label: 'Start on another problem' },
            { id: 'review_summary', label: 'Review full decision summary' },
          ],
        };
      }
    }
  }

  private async generateWithGemini(
    context: CoThinkPromptContext,
    userMessage: string,
    selectedOptionId?: string
  ): Promise<CoThinkStepResponse> {
    if (!this.ai) {
      throw new Error('GoogleGenAI client not initialized');
    }

    const stage = WORKFLOW_STAGES[context.step];
    const systemPrompt = `You are Co-Thinker, an expert AI thinking partner.
Your sole purpose is to help the user deeply understand their problem, decompose complexity, and identify different perspectives.
You NEVER rush to provide generic advice, preach, or lecture.

CURRENT CONTEXT:
- Current Flowchart Stage: "${stage.label}" (Step ${stage.number}/8)
- Goal of this stage: "${stage.shortDescription}"
- Active Problem: "${context.problemStatement || 'User is describing their problem now'}"
- Clarified Objective: "${context.clarifiedObjective || 'To be clarified'}"

STRICT FLOWCHART PROTOCOL:
1. User describes a problem.
2. AI clarifies the objective.
3. Break problem into subproblems.
4. Explore perspectives and evidence.
5. Challenge assumptions (label [FACT] vs [ASSUMPTION]).
6. Ask if the user is satisfied with understanding. If user says "Not yet", loop back to explore more perspectives.
7. Summarize insights and options.
8. User chooses next action.

CRITICAL INSTRUCTIONS:
- Directly incorporate the user's specific dilemma and vocabulary.
- Never output generic placeholder text.
- Provide a concise, direct, intellectually honest response that fulfills the current stage.
- Conclude with 2-3 selectable options formatted as:
[MESSAGE_CONTENT]
OPTIONS:
- id: <short_id> | label: <option_label>
`;

    const contents = context.conversationHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    contents.push({
      role: 'user',
      parts: [{ text: userMessage + (selectedOptionId ? ` [Selected Option: ${selectedOptionId}]` : '') }],
    });

    const modelToUse = context.model || 'gemini-2.5-flash';
    const response = await this.ai.models.generateContent({
      model: modelToUse,
      contents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.6,
      },
    });

    const text = response.text || '';
    const fallback = this.runFlowchartStep(context.step, userMessage, selectedOptionId, context);

    // Extract options if provided
    const options: ChoiceOption[] = [];
    const lines = text.split('\n');
    let messageText = '';
    let parsingOptions = false;

    for (const line of lines) {
      if (line.trim().startsWith('OPTIONS:')) {
        parsingOptions = true;
        continue;
      }
      if (parsingOptions && line.trim().startsWith('- id:')) {
        const match = line.match(/- id:\s*([^|]+)\|\s*label:\s*(.*)/);
        if (match) {
          options.push({ id: match[1].trim(), label: match[2].trim() });
        }
      } else if (!parsingOptions) {
        messageText += line + '\n';
      }
    }

    return {
      message: messageText.trim() || fallback.message,
      nextStep: fallback.nextStep,
      options: options.length > 0 ? options : fallback.options,
      progressPercent: fallback.progressPercent,
      executionMode: 'gemini',
      modelName: modelToUse,
    };
  }
}
