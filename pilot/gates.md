# ThinkMate Pilot Gates

| Gate | Pass condition |
| :--- | :--- |
| **Completion** | At least 80% reach a confirmed problem frame and a chosen idea within 45 minutes |
| **Independence** | Per participant: paired difference = ThinkMate total minus their own baseline total (scale 4-16). Pass if the median difference is at least +1 AND at least 60% of participants have a difference above 0. Show every pair, split by baseline type (n = 4 each). |
| **Acceptance** | At least 70% say they would use it at a real hackathon AND name a situation where they would pick it over ordinary AI |
| **Friction** | At most 25% abandon the guided workflow mainly because it felt too slow or restrictive. Switching to Give me ideas is logged, not counted as failure |
| **Scoring independence** | Second scorer rates every anonymized sheet if possible (16 sheets is about an hour), minimum 50%. Agreement = within 1 point on at least 75% of ratings. Report both scores where they differ |

### Why Paired Design
With so few people (n = 8), a median of two unpaired groups swings on one person. Pairing removes ability differences between people. With n = 8, one person is 12.5 percentage points, so run no significance tests. Commit this table to `/pilot/gates.md` BEFORE session 1.

### Protocol Decision & Alignment
The pilot adheres strictly to a **2-session paired within-subjects design** (n = 8 participants, 16 total sessions):
- Each participant completes exactly two sessions: **ThinkMate plus one assigned baseline** (4 participants paired against Ordinary AI Condition A, 4 participants paired against Socratic AI Condition B).
- This supersedes the earlier Version 4 3-condition proposal to avoid severe participant fatigue during intensive 45-minute thinking sessions.
- The consent script (`consent.md`), prompt protocol (`prompts.md`), rubric anchors (`rubric.md`), schema (`sessions.csv`), and analysis tool (`scripts/analyze.ts`) are 100% aligned to this 2-session paired protocol.
- Analysis gates evaluate individual paired score differences (`ThinkMate - Baseline`) without conflating conditions as if participants had experienced all three.
