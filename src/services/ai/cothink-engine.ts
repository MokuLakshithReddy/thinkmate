import { GoogleGenAI } from '@google/genai';
import { CoThinkerStep, ChoiceOption, WORKFLOW_STAGES } from '@/types';

export interface CoThinkPromptContext {
  userName: string;
  step: CoThinkerStep;
  problemStatement?: string;
  clarifiedObjective?: string;
  conversationHistory: { role: 'user' | 'assistant'; content: string }[];
}

export interface CoThinkStepResponse {
  message: string;
  nextStep: CoThinkerStep;
  options?: ChoiceOption[];
  progressPercent: number;
}

export class CoThinkEngine {
  private ai: GoogleGenAI | null = null;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
  }

  async processStep(
    context: CoThinkPromptContext,
    userMessage: string,
    selectedOptionId?: string
  ): Promise<CoThinkStepResponse> {
    const { step, problemStatement, clarifiedObjective, conversationHistory } = context;

    // Check if we should call live Gemini API or use deterministic high-fidelity co-thinking logic
    if (this.ai) {
      try {
        return await this.generateWithGemini(context, userMessage, selectedOptionId);
      } catch (err) {
        console.warn('Gemini API call failed, falling back to built-in co-thinking logic:', err);
      }
    }

    // High-fidelity flowchart engine matching the exact 8-step flowchart
    return this.runFlowchartStep(step, userMessage, selectedOptionId, context);
  }

  private runFlowchartStep(
    currentStep: CoThinkerStep,
    userMessage: string,
    selectedOptionId?: string,
    context?: CoThinkPromptContext
  ): CoThinkStepResponse {
    switch (currentStep) {
      case 'welcome': {
        if (selectedOptionId === 'resume_sh205' || userMessage.toLowerCase().includes('sh-205')) {
          return {
            nextStep: 'explore_perspectives',
            progressPercent: 50,
            message:
              "Resuming project **SH-205 (Logistics Recovery)**!\n\nPreviously, we established our objective: *Build a multi-modal recovery broker for misplaced supply chain shipments*.\n\nLet's now explore the remaining perspectives and evidence:\n- **Carrier Perspective**: Real-time telematics and API reliability vary across freight carriers.\n- **Warehouse Perspective**: Physical re-scanning adds 4–8 hour dock bottlenecks.\n- **Customer Perspective**: Certainty of arrival matters more than raw speed.\n\nWhich of these perspectives holds the highest uncertainty for you right now?",
            options: [
              { id: 'carrier_api', label: 'Carrier API integration & tracking gaps' },
              { id: 'warehouse_dock', label: 'Warehouse dock scanning & physical verification' },
              { id: 'customer_sla', label: 'Customer SLAs & transparency guarantees' },
            ],
          };
        } else {
          return {
            nextStep: 'describe_problem',
            progressPercent: 12,
            message:
              "Great! Let's start with a completely fresh problem.\n\nDescribe the dilemma, challenge, or situation on your mind. Don't worry about structuring it perfectly—just convey the core tension, what feels difficult, and what you're trying to solve.",
          };
        }
      }

      case 'describe_problem': {
        const problem = userMessage.trim();
        return {
          nextStep: 'clarify_objective',
          progressPercent: 25,
          message:
            `Thank you for sharing that context. Here is how I understand the situation:\n\n> *"${problem}"*\n\nBefore exploring solutions, let's step back and **clarify your primary objective**.\n\nOften in complex dilemmas, the stated problem masks competing goals (e.g. speed vs quality, control vs scalability). What is the single most critical outcome you need to achieve?`,
          options: [
            { id: 'obj_clarify_root', label: 'Isolate root problem without jumping to solutions' },
            { id: 'obj_decouple_risk', label: 'Reduce operational risk while moving fast' },
            { id: 'obj_align_stakeholders', label: 'Align team & stakeholders around clear success metrics' },
          ],
        };
      }

      case 'clarify_objective': {
        return {
          nextStep: 'break_subproblems',
          progressPercent: 40,
          message:
            `Got it. With our objective clarified, let's **break the problem into subproblems** to make it manageable:\n\n1. **Subproblem 1: Root Constraint Identification**\n   What is the immovable bottleneck (time, architecture, cost, or cognitive load)?\n\n2. **Subproblem 2: Boundary & Scope Tensions**\n   What components can be isolated or solved independently without cascading ripple effects?\n\n3. **Subproblem 3: Decision Reversibility**\n   Which choices are two-way doors (easily undone) versus one-way doors (hard to reverse)?\n\nWhich subproblem feels like the heaviest friction point in your current thinking?`,
          options: [
            { id: 'sub_constraint', label: 'Subproblem 1: Immovable constraints & bottlenecks' },
            { id: 'sub_scope', label: 'Subproblem 2: Scope boundaries & architectural coupling' },
            { id: 'sub_reversibility', label: 'Subproblem 3: Reversibility & commitment cost' },
          ],
        };
      }

      case 'break_subproblems': {
        return {
          nextStep: 'explore_perspectives',
          progressPercent: 55,
          message:
            `Now let's **explore different perspectives and evidence**:\n\n- **Perspective A (The Pragmatist / Incrementalist):**\n  Focus on small, high-certainty interventions. Fix immediate friction points without large refactors or massive commitments.\n\n- **Perspective B (The Architect / Structuralist):**\n  Address root-cause design flaws. Invest upfront in modular boundaries and clean abstractions to prevent recurring pain.\n\n- **Perspective C (The User / Stakeholder Lens):**\n  Focus purely on user-facing friction and reliability, ignoring internal elegance until customer confidence is restored.\n\nHow do these perspectives compare to what your team or intuition has been favoring?`,
          options: [
            { id: 'persp_pragmatist', label: 'Lean toward the Pragmatist (low-risk, iterative)' },
            { id: 'persp_architect', label: 'Lean toward the Architect (root-cause structural fix)' },
            { id: 'persp_user', label: 'Lean toward User/Stakeholder confidence first' },
          ],
        };
      }

      case 'explore_perspectives': {
        return {
          nextStep: 'challenge_assumptions',
          progressPercent: 70,
          message:
            `Now let's **challenge the underlying assumptions**:\n\n- **[FACT]:** Moving without clear boundaries increases delivery friction.\n- **[UNPROVEN ASSUMPTION]:** "A complete rewrite or new system will automatically fix our bottlenecks." (In reality, systemic testing or coordination issues often follow teams across frameworks).\n- **[UNPROVEN ASSUMPTION]:** "We must solve everything at once rather than de-risking the single hardest component first."\n\nNotice where our assumptions might be untested hypotheses rather than established facts. How would you test the riskiest assumption before committing resources?`,
          options: [
            { id: 'test_assumption_pilot', label: 'Run a 2-day low-risk spike or prototype' },
            { id: 'test_assumption_audit', label: 'Audit telemetry and benchmark real bottleneck data' },
            { id: 'test_assumption_interview', label: 'Validate directly with affected users/stakeholders' },
          ],
        };
      }

      case 'challenge_assumptions': {
        return {
          nextStep: 'check_satisfaction',
          progressPercent: 82,
          message:
            `We have clarified your objective, decomposed the subproblems, explored multiple perspectives, and stress-tested key assumptions.\n\n**Are you satisfied with our understanding of the problem so far?**\n\nTake a moment to reflect: does this capture the true heart of your dilemma, or is there an important dimension or evidence we should explore further?`,
          options: [
            { id: 'sat_yes', label: 'Yes — I am satisfied with our understanding' },
            { id: 'sat_no', label: 'Not yet — Let\'s explore more perspectives or dig deeper' },
          ],
        };
      }

      case 'check_satisfaction': {
        if (selectedOptionId === 'sat_no' || userMessage.toLowerCase().includes('not yet')) {
          // Loop back to Step 4 (Explore perspectives and evidence) as mandated by the flowchart!
          return {
            nextStep: 'explore_perspectives',
            progressPercent: 55,
            message:
              `Understood. Let's dig deeper into the problem dynamics.\n\nTell me: what specific perspective, counter-argument, or hidden constraint feels missing or unresolved? Let's bring that evidence into the conversation.`,
          };
        } else {
          // Proceed to Step 7 (Summarize insights and options)
          return {
            nextStep: 'summarize_insights',
            progressPercent: 92,
            message:
              `### Structured Co-Thinking Synthesis\n\nHere is what we have established together:\n\n1. **Clarified Objective:** Isolate the true constraint and resolve friction without premature convergence.\n2. **Decomposed Subproblems:** Boundary coupling and reversibility are the primary drivers of risk.\n3. **Validated Perspectives:** Incremental verification (spike-driven) vastly outperforms all-or-nothing commitments.\n4. **Critical Assumption Tested:** Assumptions about tooling solves process problems was tagged as unproven.\n5. **Viable Options:**\n   - **Option A (Strangler / Parallel Spike):** Test the hardest uncertainty in isolation.\n   - **Option B (Guardrail Boundary):** Establish automated lint and contract checks before migrating.\n\nWe are ready to translate this understanding into action.`,
            options: [
              { id: 'action_proceed', label: 'Proceed to choose concrete next action' },
              { id: 'action_revisit', label: 'Revisit a specific insight before locking in' },
            ],
          };
        }
      }

      case 'summarize_insights': {
        return {
          nextStep: 'choose_action',
          progressPercent: 100,
          message:
            `### Choose Your Next Action\n\nTo turn this clear understanding into momentum, select your immediate next step:\n\n1. **Spike Implementation:** Execute a focused 48-hour pilot on the single highest-uncertainty component.\n2. **Architecture Decision Record (ADR):** Document the verified objectives, rejected alternatives, and stop conditions.\n3. **Stakeholder Briefing:** Share the decomposed subproblems and agreed trade-offs with the team.\n\nWhich action will you commit to first?`,
          options: [
            { id: 'act_pilot', label: 'Launch 48-Hour Focused Pilot / Spike' },
            { id: 'act_adr', label: 'Write Architecture Decision Record (ADR)' },
            { id: 'act_briefing', label: 'Conduct Stakeholder / Team Briefing' },
          ],
        };
      }

      case 'choose_action': {
        return {
          nextStep: 'welcome',
          progressPercent: 100,
          message:
            `Action locked in! 🎯\n\nYou have turned a complex dilemma into a verified, actionable next step.\n\nYour session memory and insights have been preserved. Whenever you're ready, we can check in on execution progress or tackle another problem!`,
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
      return this.runFlowchartStep(context.step, userMessage, selectedOptionId, context);
    }

    const stage = WORKFLOW_STAGES[context.step];
    const systemPrompt = `You are Co-Thinker, an expert thinking partner.
Your sole purpose is to help the user deeply understand their problem and identify different perspectives.
You NEVER rush to provide generic advice, preach, or lecture.
Current Stage: "${stage.label}".
Goal of this stage: "${stage.shortDescription}".

Follow this exact workflow:
1. User describes a problem.
2. AI clarifies the objective.
3. Break problem into subproblems.
4. Explore perspectives and evidence.
5. Challenge assumptions (label [FACT] vs [ASSUMPTION]).
6. Ask if the user is satisfied with understanding. If "Not yet", loop back to explore more perspectives.
7. Summarize insights and options.
8. User chooses next action.

Provide a concise, direct, intellectually honest response that fulfills this stage, followed by 2-3 selectable options if helpful.
Format your output as:
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

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
    };
  }
}
