import { GoogleGenAI } from '@google/genai';
import {
  ThinkingAIService,
  ThinkStreamRequest,
  ThinkingStreamEvent,
} from './types';
import { getSystemPrompt } from './prompts';
import { ThinkingMode, Insight, normalizeInsightCategory, normalizeInsightStatus } from '@/types';
import { reportOperationalAlert } from '@/lib/monitoring';
import { z } from 'zod';

const StreamMetadataSchema = z.object({
  suggestedQuestions: z.array(z.string().min(1).max(300)).max(10).optional(),
  insights: z
    .array(
      z.object({
        category: z.enum([
          'tension',
          'tradeoff',
          'assumption',
          'decision',
          'action',
          'goal',
          'uncertainty',
          'option',
          'risk',
          'next_step',
        ]),
        title: z.string().min(1).max(200),
        content: z.string().min(1).max(2000),
        status: z.enum(['proposed', 'accepted', 'rejected']).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(10)
    .optional(),
  suggestedMode: z.enum(['understand', 'explore', 'challenge', 'decide', 'act']).optional(),
});

export class GeminiThinkingService implements ThinkingAIService {
  private defaultApiKey: string | undefined;

  constructor(defaultApiKey?: string) {
    this.defaultApiKey = defaultApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  }

  async generateThinkingStream(
    request: ThinkStreamRequest,
    onEvent: (event: ThinkingStreamEvent) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    if (abortSignal?.aborted) return;
    const activeKey = this.defaultApiKey;

    if (!activeKey) {
      if (process.env.NODE_ENV === 'production') {
        onEvent({
          type: 'error',
          error: 'AI thinking provider is not configured. Please contact the administrator.',
        });
        return;
      }
      // If no API key is supplied in non-production, use the high-fidelity thinking simulator
      await this.runSimulator(request, onEvent, undefined, abortSignal);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey: activeKey });
      const systemInstruction = getSystemPrompt(request.currentMode);
      const modelName = request.model || 'gemini-2.5-flash';

      // Format conversation history for Gemini API
      // In @google/genai: contents format is array of { role: 'user' | 'model', parts: [{ text }] }
      const contents = request.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

      // If the latest message doesn't reflect the current problem statement, prepend context
      if (contents.length === 0) {
        contents.push({
          role: 'user',
          parts: [{ text: `Problem Statement: ${request.problemStatement}` }],
        });
      }

      const responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: 2500,
          temperature: 0.7,
          abortSignal,
        },
      });

      let pendingBuffer = '';
      let jsonMetaBuffer = '';
      let isCapturingJson = false;
      const markerPattern = /```json(?::thinkmate-meta)?/;

      for await (const chunk of responseStream) {
        if (abortSignal?.aborted) {
          if (typeof (responseStream as unknown as { return?: () => Promise<unknown> }).return === 'function') {
            try {
              await (responseStream as unknown as { return: () => Promise<unknown> }).return();
            } catch {}
          }
          break;
        }
        const text = chunk.text;
        if (!text) continue;

        if (isCapturingJson) {
          jsonMetaBuffer += text;
          continue;
        }

        pendingBuffer += text;

        const match = markerPattern.exec(pendingBuffer);
        if (match) {
          // Emitting tokens strictly before the fence
          const preMarker = pendingBuffer.slice(0, match.index);
          if (preMarker && !abortSignal?.aborted) {
            onEvent({ type: 'token', token: preMarker });
          }
          isCapturingJson = true;
          jsonMetaBuffer = pendingBuffer.slice(match.index + match[0].length);
          pendingBuffer = '';
        } else {
          // If pending buffer exceeds maximum marker prefix length (30 chars), emit safe head
          const safeEmitLength = pendingBuffer.length - 30;
          if (safeEmitLength > 0 && !abortSignal?.aborted) {
            const safeToken = pendingBuffer.slice(0, safeEmitLength);
            onEvent({ type: 'token', token: safeToken });
            pendingBuffer = pendingBuffer.slice(safeEmitLength);
          }
        }
      }

      if (abortSignal?.aborted) {
        return;
      }

      // Flush remaining non-marker text if any
      if (!isCapturingJson && pendingBuffer && !abortSignal?.aborted) {
        onEvent({ type: 'token', token: pendingBuffer });
      }

      // Parse metadata block if captured
      if (!abortSignal?.aborted) {
        this.parseAndEmitMetadata(jsonMetaBuffer || pendingBuffer, request.currentMode, onEvent);
      }
    } catch (err: unknown) {
      if (abortSignal?.aborted) return;
      const errMsg = (err as Error)?.message || String(err);
      console.warn('Gemini API call encountered error:', errMsg);
      reportOperationalAlert('AI_PROVIDER_FAILURE', {
        error: errMsg,
        mode: request.currentMode,
        runbook: 'Check Google Gemini API quota, rate limits, and key validity in AI Studio console.',
      });
      if (process.env.NODE_ENV === 'production') {
        onEvent({
          type: 'error',
          error: 'AI thinking provider temporarily unavailable. Please retry in a few moments.',
        });
        return;
      }
      // In development or test environments, fallback to simulator with explicit warning
      await this.runSimulator(request, onEvent, errMsg, abortSignal);
    }
  }

  /**
   * Helper for stream simulation and unit testing of rolling buffer parser.
   */
  static processStreamChunksWithRollingBuffer(
    chunks: string[],
    onToken: (token: string) => void
  ): { capturedJson: string } {
    let pendingBuffer = '';
    let jsonMetaBuffer = '';
    let isCapturingJson = false;
    const markerPattern = /```json(?::thinkmate-meta)?/;

    for (const text of chunks) {
      if (!text) continue;

      if (isCapturingJson) {
        jsonMetaBuffer += text;
        continue;
      }

      pendingBuffer += text;

      const match = markerPattern.exec(pendingBuffer);
      if (match) {
        const preMarker = pendingBuffer.slice(0, match.index);
        if (preMarker) {
          onToken(preMarker);
        }
        isCapturingJson = true;
        jsonMetaBuffer = pendingBuffer.slice(match.index + match[0].length);
        pendingBuffer = '';
      } else {
        const safeEmitLength = pendingBuffer.length - 30;
        if (safeEmitLength > 0) {
          const safeToken = pendingBuffer.slice(0, safeEmitLength);
          onToken(safeToken);
          pendingBuffer = pendingBuffer.slice(safeEmitLength);
        }
      }
    }

    if (!isCapturingJson && pendingBuffer) {
      onToken(pendingBuffer);
    }

    return { capturedJson: jsonMetaBuffer };
  }

  public parseAndEmitMetadata(
    text: string,
    currentMode: ThinkingMode,
    onEvent: (event: ThinkingStreamEvent) => void
  ) {
    if (!text || !text.trim()) {
      return;
    }

    try {
      let jsonStr = text;
      const fenceMatch = text.match(/```json(?::thinkmate-meta)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch && fenceMatch[1]) {
        jsonStr = fenceMatch[1];
      } else {
        const closingMatch = text.match(/([\s\S]*?)```/);
        if (closingMatch && closingMatch[1]) {
          jsonStr = closingMatch[1];
        }
      }

      const parsed = JSON.parse(jsonStr.trim());
      const validation = StreamMetadataSchema.safeParse(parsed);

      if (!validation.success) {
        console.warn(
          '[GeminiThinkingService] Stream metadata rejected by schema validation:',
          validation.error.issues
        );
        return;
      }

      const data = validation.data;
      if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
        onEvent({ type: 'questions', questions: data.suggestedQuestions });
      }
      if (data.insights && data.insights.length > 0) {
        const normalizedInsights = data.insights.map((ins) => ({
          ...ins,
          category: normalizeInsightCategory(ins.category),
          status: normalizeInsightStatus(ins.status),
        }));
        onEvent({ type: 'insights', insights: normalizedInsights as Partial<Insight>[] });
      }
      if (data.suggestedMode) {
        onEvent({ type: 'suggestedMode', mode: data.suggestedMode });
      }
    } catch (err) {
      console.warn('[GeminiThinkingService] Failed to parse stream metadata JSON:', err);
      // Malformed metadata is not emitted as fake synthetic questions to maintain honesty
    }
  }

  private getDefaultQuestionsForMode(mode: ThinkingMode): string[] {
    switch (mode) {
      case 'understand':
        return [
          'What is the primary constraint (time, budget, or reliability)?',
          'What happens if we do nothing for 3 months?',
          'What is the single non-negotiable requirement?',
        ];
      case 'explore':
        return [
          'What would an ultra-conservative approach look like?',
          'What would a radical, zero-compromise solution look like?',
          'Can we hybridize the top two approaches?',
        ];
      case 'challenge':
        return [
          'Which core assumption has the least empirical evidence?',
          'Where is the single point of failure in our favorite option?',
          'What is the catastrophic failure scenario?',
        ];
      case 'decide':
        return [
          'Are we willing to accept this trade-off long term?',
          'Is this decision reversible within 30 days?',
          'Do you approve locking in this decision?',
        ];
      case 'act':
        return [
          'What is the single task to complete in the next 24 hours?',
          'Who is accountable for each milestone?',
          'What signal triggers an immediate rollback?',
        ];
      default:
        return [];
    }
  }

  private async runSimulator(
    request: ThinkStreamRequest,
    onEvent: (event: ThinkingStreamEvent) => void,
    notice?: string,
    abortSignal?: AbortSignal
  ): Promise<void> {
    if (abortSignal?.aborted) return;
    const mode = request.currentMode;
    const problem = request.problemStatement;

    let responseMarkdown = '';
    let questions: string[] = [];
    let insights: Partial<Insight>[] = [];

    if (notice) {
      responseMarkdown += `> [!NOTE]\n> *Running in resilient co-thinking mode (${notice}).*\n\n`;
    }

    switch (mode) {
      case 'understand':
        responseMarkdown += `### Deconstructing the Problem Framing\n\nLet's separate the symptoms from the core friction in this dilemma:\n\n1. **Stated Problem:** ${problem}\n2. **Underlying Dynamics:** In situations like this, tension usually arises from competing optimization targets (e.g. speed to ship vs long-term maintainability, or autonomy vs centralized consistency).\n3. **Clarified Goal:** We must identify what success looks like beyond the immediate technical debate.\n\nTo make meaningful progress, let's nail down these three clarifying questions before evaluating solutions:`;
        questions = [
          'What is the primary constraint: engineering bandwidth, deadline, or risk tolerance?',
          'What specific metric or outcome will tell us this decision was correct in 6 months?',
          'What is the cost of deferring this decision for 4 weeks?',
        ];
        insights = [
          {
            category: 'goal',
            title: 'Isolate Root Constraint',
            content: `Clarified objective: Resolve core friction in "${problem.slice(0, 50)}..." without premature technical commitment.`,
          },
          {
            category: 'uncertainty',
            title: 'Missing Boundary Context',
            content: 'Team capacity and long-term ownership responsibilities have not yet been defined.',
          },
        ];
        break;

      case 'explore':
        responseMarkdown += `### Divergent Architectural & Strategic Approaches\n\nHere are 3 genuinely distinct approaches with explicit trade-offs and risks:\n\n#### Approach A: Incremental Modularization (Conservative)\n- **Principle:** Keep the existing core intact; establish strict domain boundaries and automated CI caching.\n- **Trade-offs:** Retains existing monolithic overhead; avoids sexy rewrites.\n- **Risks:** Scope creep and erosion of discipline without strict lint checks.\n\n#### Approach B: Granular Decoupling (Transformative)\n- **Principle:** Carve out high-velocity components into standalone services or micro-functions.\n- **Trade-offs:** Introduces distributed observability, network hops, and multi-repo friction.\n- **Risks:** Premature fragmentation before domain boundaries stabilize.\n\n#### Approach C: Parallel Spike & Strangler Fig (Empirical)\n- **Principle:** Spin off one small pilot service to measure latency and developer ergonomics in production.\n- **Trade-offs:** Requires running two paradigms concurrently for a transition window.\n- **Risks:** Temporary operational complexity while monitoring two systems.`;
        questions = [
          'Which approach aligns best with your team’s tolerance for operational overhead?',
          'Can we pilot Approach C on a low-risk internal endpoint?',
          'What dependencies make Approach B difficult to execute today?',
        ];
        insights = [
          {
            category: 'option',
            title: 'Approach A: Incremental Modularization',
            content: 'Keep single deployment unit, enforce boundary rules, parallelize builds.',
            metadata: {
              tradeoffs: ['Shared infrastructure persists', 'No greenfield rewrite'],
              risks: ['Discipline erosion without CI rules'],
            },
          },
          {
            category: 'option',
            title: 'Approach B: Granular Decoupling',
            content: 'Extract key domains into independent deployables.',
            metadata: {
              tradeoffs: ['Network latency', 'Distributed tracing overhead'],
              risks: ['Premature fragmentation'],
            },
          },
          {
            category: 'option',
            title: 'Approach C: Strangler Fig Migration',
            content: 'Migrate one non-critical domain first behind an API proxy.',
            metadata: {
              tradeoffs: ['Dual maintenance during migration'],
              risks: ['Data synchronization between legacy and new'],
            },
          },
        ];
        break;

      case 'challenge':
        responseMarkdown += `### Stress-Testing Core Assumptions\n\nLet's stress-test the premises underpinning your current direction:\n\n- **[VERIFIED FACT]:** Complex migrations cause delivery delays if undertaken without clear boundaries.\n- **[UNPROVEN ASSUMPTION]:** "A new architecture will inherently fix our deployment friction." (Often, CI flakiness and poor test design follow teams into microservices).\n- **[UNPROVEN ASSUMPTION]:** "The team will quickly ramp up on new distributed infrastructure without productivity loss."\n\n#### Critical Failure Mode:\nIf we embark on a full rewrite while active feature commitments continue, we risk a 6-month dual-maintenance purgatory where neither system is fully optimized.`;
        questions = [
          'How can we empirically test our top assumption before committing 3 months of work?',
          'What happens if the new architecture introduces unanticipated latency or debugging complexity?',
          'Is our team prepared to maintain two separate operational stacks during migration?',
        ];
        insights = [
          {
            category: 'assumption',
            title: 'Tooling Solves Team Friction',
            content: 'Assumption that changing technology stack automatically solves pipeline latency.',
            metadata: { isFact: false },
          },
          {
            category: 'assumption',
            title: 'Dual-Stack Overhead',
            content: 'Fact: Running two deployment systems in parallel incurs higher operational cognitive load.',
            metadata: { isFact: true },
          },
        ];
        break;

      case 'decide':
        responseMarkdown += `### Decision Synthesis & Multi-Criteria Evaluation\n\nBased on our exploration of options and risk profile, here is the proposed decision direction:\n\n**Proposed Direction: The Strangler Fig Paradigm with Incremental Modularization.**\n\n- **Why this path:** It minimizes existential rewrite risk while immediately unlocking deployment velocity on the highest-friction bottlenecks.\n- **Accepted Trade-offs:** We accept temporary dual-monitoring overhead in exchange for zero downtime and low blast radius.\n\n*Please review this proposal in the Insight Panel. Do you accept this direction, or do you want to modify key parameters?*`;
        questions = [
          'Do you accept this direction as our locked conclusion?',
          'What boundary conditions or caveats should we attach to this decision?',
          'Should we define the rollback criteria before committing?',
        ];
        insights = [
          {
            category: 'decision',
            title: 'Adopt Incremental Strangler Migration',
            content: 'Proceed with low-risk pilot extraction rather than big-bang rewrite.',
            status: 'under_review',
          },
        ];
        break;

      case 'act':
        responseMarkdown += `### Action Plan & Concrete Execution Roadmap\n\nHere is your step-by-step roadmap to execute the approved decision:\n\n#### Phase 1: Immediate Validation (Days 1–3)\n- [ ] Profile CI pipeline stages to quantify exact bottlenecks.\n- [ ] Draft an ADR (Architecture Decision Record) documenting the strangler pattern and stop conditions.\n\n#### Phase 2: Pilot Extraction (Weeks 1–2)\n- [ ] Carve out a single read-only or low-criticality service.\n- [ ] Setup API gateway routing and health checks.\n\n#### Phase 3: Validation & Gate Check (Week 3)\n- [ ] Compare deployment time and test flakiness against baseline.\n- [ ] Stop condition: If operational overhead exceeds 25% team capacity, pause further extraction.`;
        questions = [
          'Who will be the directly responsible owner for the Phase 1 profiling task?',
          'What is our definition of done for the pilot extraction?',
        ];
        insights = [
          {
            category: 'action',
            title: 'Profile CI Pipeline Stages',
            content: 'Instrument test suite runtimes and identify longest-running jobs.',
            metadata: { milestone: 'Phase 1: Days 1-3' },
          },
          {
            category: 'action',
            title: 'Draft Architecture Decision Record (ADR)',
            content: 'Codify agreed boundaries, rollback criteria, and team conventions.',
            metadata: { milestone: 'Phase 1: Days 1-3' },
          },
          {
            category: 'action',
            title: 'Extract Low-Risk Pilot Service',
            content: 'Implement first strangler boundary on a standalone endpoint.',
            metadata: { milestone: 'Phase 2: Weeks 1-2' },
          },
        ];
        break;
    }

    // Stream simulated response in chunks with natural pacing
    const tokens = responseMarkdown.split(' ');
    for (const word of tokens) {
      if (abortSignal?.aborted) return;
      onEvent({ type: 'token', token: word + ' ' });
      await new Promise((res) => setTimeout(res, 12));
    }

    if (abortSignal?.aborted) return;
    onEvent({ type: 'questions', questions });
    onEvent({ type: 'insights', insights });
  }
}
