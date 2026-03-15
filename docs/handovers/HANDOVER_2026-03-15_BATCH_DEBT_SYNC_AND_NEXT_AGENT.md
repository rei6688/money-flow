# Handover 2026-03-15 - Batch, Debt Sync, and Next-Agent Roadmap

## Completed in this cycle
- Fixed Batch header sync flow so current phase checklist refreshes immediately after sync.
- Renamed header action from Sync to Sync Master.
- Hardened People cycle sheet sync against stale `sheet_linked_bank_id` (PocketBase 404 fallback to manual bank info).
- Improved debt-cycle allocation matching so custom tags (for example `25-02-24-03`) are treated as canonical tags, not untagged waterfall.
- Aligned flow badges in transaction table to a consistent right-justified visual line.

## Files changed in this cycle
- `src/components/batch/batch-page-client-v2.tsx`
- `src/components/batch/BatchMasterChecklist.tsx`
- `src/services/sheet.service.ts`
- `src/services/debt.service.ts`
- `src/components/moneyflow/unified-transaction-table.tsx`

## Important runtime observation
- A stale account reference in People sheet settings can throw PocketBase 404 during cycle sync.
- Without try/catch fallback, the entire sync route reports `Sync failed`.

## Next-agent priority (strict)
1. Installment
2. Service
3. Bot

Do not reorder unless explicitly approved by user.

## Mandatory branch naming rule
All new branches MUST include `ddmmyyyy`:
- Pattern: `agent/<scope>-<ddmmyyyy>-<short-task>`
- Example: `agent/installment-15032026-db-audit`

## Read-first plan pack
- `docs/plans/INSTALLMENT_DB_AUDIT_PLAN_2026-03-15.md`
- `docs/plans/SERVICE_CRON_RESEARCH_PLAN_2026-03-15.md`
- `docs/plans/BOT_QA_REFACTOR_PLAN_2026-03-15.md`

## Suggested execution sequence for next agent
- Phase A: complete installment source-of-truth mapping and migration strategy.
- Phase B: diagnose service page ownership + cron schedule path on Vercel, produce reliability fix plan.
- Phase C: design bot Q&A-only architecture over transaction/cashback/card-config context (Vietnamese-first prompts).

## Non-goals (explicit)
- Do not implement bot-based transaction submission.
- Do not add new payment execution workflows in bot.
