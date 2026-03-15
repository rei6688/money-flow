# Agent Start Prompt - Mini Branch Continuation

## Update 2026-03-15 (Read Before Any Code)

### Current branch and release context
- Active branch used in this handover cycle: `feat/mini-people-sync-flow-ui-check`.
- Latest fixes in branch include:
  - Transaction History modal converted to table view and sticky header support.
  - History diff mapping fix for `Debt Cycle Tag`, `Final Price`, and date key normalization.
  - Money Flow sheet icon tooltip now includes inline quick `Sync` action.
  - Parse/build regression in unified table already hotfixed.

### Mandatory branch naming rule (force)
All new task branches MUST include `ddmmyyyy` in branch name.

Required pattern:
- `agent/<scope>-<ddmmyyyy>-<short-task>`

Valid examples:
- `agent/mini-15032026-history-ux-polish`
- `agent/mini-15032026-sheet-sync-validation`
- `agent/mini-15032026-flow-pill-tuning`

Do not open PRs from branches without `ddmmyyyy`.

## Objective
Continue mini-branch fixes safely from current base branch state, with strict branch isolation and clear handover discipline.

## Mandatory Git Workflow (DO THIS FIRST)
1. `git checkout feat/mini-people-sync-flow-ui-check`
2. `git pull --rebase origin feat/mini-people-sync-flow-ui-check`
3. `git checkout -b agent/mini-<ddmmyyyy>-<task>`

Do NOT code directly on `feat/mini-people-sync-flow-ui-check`.

Suggested branch format:
- `agent/mini-15032026-history-followup`
- `agent/mini-15032026-sheet-qa-pass`

## Read First (required)
1. `.github/copilot-instructions.md`
2. `README.md`
3. `src/components/moneyflow/unified-transaction-table.tsx`
4. `src/components/moneyflow/transaction-history-modal.tsx`
5. `src/actions/history-actions.ts`
6. `src/services/sheet.service.ts`
7. `src/app/api/sheets/manage/route.ts`

## Current State Snapshot
- Base branch: `feat/mini-people-sync-flow-ui-check`
- Notes `EDITED` badge opens Transaction History modal.
- History entries render as `Field | Before | After` table.
- Header row stays visible during long-history scroll.
- Sheet icon uses tooltip-local `Sync` action (no recurring corner hover toast).
- API diagnostics include `requestId` and `stage` for faster production debugging.

## Priority Tasks
### P1 - Validate sheet sync behavior in real scenarios
- Verify quick sync from tooltip action updates expected cycle rows.
- Verify repayment rows without shop still map proper shop source fallback.
- Keep error reporting actionable (`Req`, `Stage`) when failures happen.

### P2 - Continue unified table UX polish only when requested
- Keep Flow/Base/Net semantics and spacing consistent with current design.
- Preserve 13-inch laptop readability and compact segmented badges.
- Do not reintroduce removed history action in Action column.

### P3 - Guard against regressions
- Build and lint must pass after each feature tweak.
- Watch for syntax issues in large callback blocks before commit.

## Constraints
- No extra UX/features outside requested scope.
- Keep edits surgical.
- If blockers occur: document blocker + commit partial progress + update handover.

## Exit Criteria for this session
- New branch pushed (not direct to base branch).
- Focused commits with clear messages.
- Updated handover notes with:
  - done
  - pending
  - blockers
  - exact next command for next agent
