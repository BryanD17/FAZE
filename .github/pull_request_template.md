## Agent

<!-- e.g. AGENT 04 — AUTH. Put "n/a" for a follow-up fix or docs-only PR. -->

**Agent number:** AGENT \_\_
**Branch:** `agent/agent-NN-<short-name>`

## What changed

<!-- What a reviewer needs to know in three sentences. Not a file list —
     git already has that. Why this change, and what it enables next. -->

## Evidence per acceptance criterion

<!-- One entry per [ ] box in the agent, in order. Paste REAL output:
     CLI output, SQL result sets, test summaries, file:line references, or a
     described manual test naming what you clicked and what you saw.
     "Looks fine" and "implemented and working" are not evidence (§1.8). -->

| #   | Criterion | Evidence |
| --- | --------- | -------- |
| 1   |           |          |
| 2   |           |          |

## Verification run locally

- [ ] `npm run lint` and `npm run format:check` pass
- [ ] `npm run typecheck` passes
- [ ] `npm -w @faze/client run build` exits 0
- [ ] `npm test` passes
- [ ] `npm run db:migrate` applies cleanly from an empty database

## ⛔ Blocked items

<!-- Anything a human must do, the EXACT step, and who must do it.
     "Bryan: create a Kaggle API token at kaggle.com/settings and save it to
     ~/.kaggle/kaggle.json". Never silently pass; never invent a key. -->

- [ ] None

## Ledger

- [ ] `FAZE_Master_Prompt_V1.txt` PROGRESS LEDGER updated
- [ ] `LEDGER NOTES` has a dated line
- [ ] `APPENDIX A-NN` filled in with the evidence above
