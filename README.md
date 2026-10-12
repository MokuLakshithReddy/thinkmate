# ThinkMate — Personal AI Thinking Partner

**ThinkMate** is a production-minded personal AI thinking partner inspired by the collaborative problem-understanding experience of co-thinking. It helps individuals think through difficult technical, strategic, and architectural dilemmas by clarifying goals, decomposing problems, exploring distinct alternatives, challenging unproven assumptions, and turning user-approved conclusions into concrete action plans.

Unlike generic chatbots that rush to generate shallow answers, ThinkMate enforces an adaptive, stateful 5-mode cognitive workflow.

---

## 🚀 Key Features

1. **Stateful 5-Mode Thinking Workflow**:
   - **Understand**: Clarifies the true goal, separates surface symptoms from root constraints, and asks targeted probing questions.
   - **Explore**: Divergent ideation. Generates genuinely distinct architectural approaches with explicit principles, trade-offs, risks, and required dependencies.
   - **Challenge**: Adversarial stress-testing. Audits assumptions, categorizing them as `[VERIFIED FACT]` vs `[UNPROVEN ASSUMPTION]`, modeling failure modes.
   - **Decide**: Convergent evaluation. Weighs alternatives against explicit user criteria and requests explicit acceptance, rejection, or modification.
   - **Act**: Execution planning. Formulates immediate next actions (24–48h), verifiable milestones, stop conditions, and definition of done.

2. **Server-Side Guardrails & State Machine**:
   - Prevents premature convergence (e.g., jumping from *Understand* directly to *Act* without exploring alternatives or securing user approval).
   - Validates state transitions via server-side Zod schemas (`/api/workflow/transition`).

3. **Official Google GenAI Integration**:
   - Powered by `@google/genai` using Gemini 2.5 Flash / Flash Lite.
   - Server-side streaming via Server-Sent Events (SSE) with structured metadata event protocol (`/api/think/stream`).
   - Grounded reasoning: No fabricated citations, statistics, or imaginary benchmarks.
   - Resilient offline simulator fallback for automated tests and offline development.

4. **Structured Insight & Decision Panel**:
   - Collapsible artifact panel categorizing Goals, Assumptions, Options, Decisions, and Action Items.
   - Interactive options-matrix comparison view with side-by-side trade-off inspection.
   - Decision synthesis generator exporting full markdown reports.

5. **Security & Row Level Security (RLS)**:
   - Supabase PostgreSQL schema with RLS policies ensuring users only access their own sessions (`auth.uid() = user_id`).
   - IDOR prevention and ownership verification on all session mutation endpoints.
   - Model API keys and privileged credentials strictly contained on the server.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router with Turbopack)
- **Language**: TypeScript (Strict type checking)
- **Styling**: Tailwind CSS v4 with dark workspace aesthetic (deep navy `#090D16`, subtle cyan accents, slate borders)
- **AI SDK**: `@google/genai` (Official Google GenAI SDK)
- **Database**: Supabase PostgreSQL with Row Level Security
- **Validation**: Zod schema validation
- **Testing**: Node.js Native Test Runner with `tsx` (11 unit & integration tests)

---

## 📁 Project Architecture

```
thinkmate/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── think/stream/route.ts      # Server-Sent Events streaming endpoint
│   │   │   ├── workflow/transition/route.ts # Server state machine validator
│   │   │   ├── sessions/route.ts          # Session CRUD & ownership checks
│   │   │   └── insights/route.ts          # Insight management
│   │   ├── globals.css                    # Dark workspace theme tokens
│   │   ├── layout.tsx                     # App shell layout
│   │   └── page.tsx                       # Main workbench container
│   ├── components/
│   │   ├── layout/                        # AppHeader, SessionSidebar, InsightPanel
│   │   ├── thinking/                      # ModeSelector, ThinkingWorkspace, OptionsMatrix, SuggestedQuestions
│   │   ├── modals/                        # NewSessionModal, SettingsModal, DecisionSummaryModal, TransitionAlertModal
│   │   ├── home/                          # HomeDashboard
│   │   └── ui/                            # Button, Card, Badge, Modal
│   ├── services/
│   │   ├── ai/                            # GeminiThinkingService, prompts, schemas, tests
│   │   ├── db/                            # SupabaseThinkingRepository, client, tests
│   │   └── workflow/                      # WorkflowStateMachine, guardrails, tests
│   ├── lib/                               # Storage helpers, styling utils
│   └── types/                             # Domain types and mode definitions
└── supabase/
    └── migrations/                        # PostgreSQL migration with RLS policies
```

---

## ⚡ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local` and add your Gemini API key:
```bash
cp .env.example .env.local
```
Add your key:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```
*(Note: ThinkMate includes a resilient reasoning simulator, allowing you to run and test the application even before configuring an API key).*

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run Automated Tests
```bash
npm test
```
Runs the 11 unit & integration tests covering AI schemas, state machine transitions, and database ownership verification.

### 5. Build for Production
```bash
npm run build
```

---

## 🔒 Security & Privacy

- **Server-Side AI Proxy**: API keys are never exposed to the client bundle.
- **Row Level Security**: Database rows are protected with PostgreSQL RLS policies in `supabase/migrations/20261012000000_thinkmate_schema.sql`.
- **Ownership Verification**: Endpoints enforce user ownership to block insecure direct-object references (IDOR).
- **Data Erasure**: Built-in "Wipe All Data" action in Settings allows users to clear all sessions and insights immediately.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

