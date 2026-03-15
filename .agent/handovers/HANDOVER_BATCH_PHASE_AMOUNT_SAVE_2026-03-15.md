# Handover - Batch Phase Amount Save + Render Loop Fix (2026-03-15)

## Context
- Scope: Batch checklist flow for phase-based execution (MBB/VIB).
- Main user issue:
  - Amount entered in a phase disappeared after switching phase.
  - Could not run Step 1 Fund / Step 2 Send To Sheet due to "0 amount".
  - New regression after UX refactor: React runtime error `Maximum update depth exceeded`.

## Progress Summary
- Implemented phase-level editing UX for amounts.
- Removed per-row AMT edit button.
- Added phase-level Save to persist all changed amounts in DB.
- Added guard: must save dirty phase amounts before Step 1/Step 2.
- Added fallback mapping for migrated data to avoid UI amount showing as zero when linkage by `master_item_id` is missing.
- Fixed infinite render loop caused by dirty-state effect callback churn.

## Files Updated
- `src/components/batch/BatchMasterChecklist.tsx`

## Detailed Changes

### 1) Phase-level amount edit/save
- Added phase edit mode with header controls:
  - `Edit` button to enter/exit phase edit mode.
  - `Save` button to persist changed amounts for the current phase.
- Added local draft state:
  - `draftAmounts` map keyed by master item id.
  - `hasDirtyAmounts` computed by comparing draft vs current item amount.
- Save flow:
  - Iterates changed rows and calls `upsertBatchItemAmountAction(...)`.
  - Calls refresh after successful save.

### 2) Prevent losing amount when switching phases
- In `refreshChecklist()`, existing batch-item lookup no longer relies only on `master_item_id`.
- Added fallback matching tuple:
  - `receiver_name` + `bank_number` + `bank_name`.
- Goal: tolerate migration/misaligned linkage and still hydrate amount/status from DB rows.

### 3) Fund/Sheet guards
- Added phase dirty-state map on parent.
- `requestGlobalFund()` and `handleGlobalToSheet()` now block with explicit toast if current phase has unsaved edits.
- This prevents stale in-memory values from producing false `0 amount` step errors.

### 4) Fix for Maximum update depth exceeded
- Root cause:
  - Child effect called parent state callback repeatedly with unstable callback identity and redundant updates.
- Fix:
  - Added stable parent callback `handlePhaseDirtyChange` with `React.useCallback`.
  - Parent update is now idempotent (`return prev` when value unchanged).
  - Child `PeriodSection` now passes `(phase.id, dirty)` and tracks last sent dirty state via `lastDirtyRef` to avoid repeated notifications.
  - Removed callback from effect dependency paths that were causing ping-pong re-renders.

## Validation / Tests Run
- Type check:
  - `pnpm -s exec tsc --noEmit` -> PASS (`TSC_OK`).
- Test run:
  - `pnpm test -- --run` -> FAIL due to script arg forwarding (`test: --: unexpected operator`).
  - `pnpm vitest run` -> PASS (1 file, 13 tests passed).

## Current Status
- Done:
  - Phase-level amount editing and save workflow.
  - AMT button removal.
  - Dirty guard before Step 1/2.
  - Render loop regression fixed.
  - Save-blank issue hardened: UI now fails fast when action returns `success: false` instead of showing fake success.
  - Upsert action now prioritizes amount persistence even if `target_account_id` relation is invalid in migrated PB data.
  - Type check + vitest run passed.
- Pending user validation:
  - Manual browser verify: edit amount -> Save -> switch phase -> switch back -> amount remains.
  - Manual browser verify: Step 1 Fund and Step 2 To Sheet no longer blocked by false zero amounts.

## Suggested Next Checks
1. In UI, test one phase with 3+ items edited and saved in one batch.
2. Confirm DB rows in `batch_items` reflect updated amounts after Save.
3. Execute Step 1 then Step 2 and capture `[BatchDebug]` logs for one successful run.
4. If still any mismatch, inspect PB `batch_items` records for duplicate/legacy rows with same receiver tuple.

## Update (Latest - Save Appears Blank)
- Symptom observed:
  - User clicked Edit -> Save but amount still appeared blank in phase UI.
- Root cause candidate addressed:
  - Frontend save loop did not validate action result payload (`success: false` path was ignored), causing false-positive "Saved" UX.
  - Backend upsert could fail due to relation mismatch on `target_account_id`, leaving amount unsaved.
- Fix implemented:
  - Frontend now throws and surfaces error when `upsertBatchItemAmountAction` returns unsuccessful result.
  - Backend update/create paths now retry with amount-only payload when relation field causes failure, so amount persistence is not blocked.
- Validation:
  - `pnpm -s exec tsc --noEmit` PASS
  - `pnpm vitest run` PASS

## Update (Latest - DB Saved But UI Still Blank)
- Symptom observed:
  - User confirmed `batch_items.amount` persisted (example amount=454) but checklist row still displayed blank.
- Root cause confirmed:
  - `refreshChecklist()` picked only `periodBatches[0]` and searched item inside that single batch.
  - In datasets with multiple batches/month or mismatched phase markers, the saved item can live in another batch, so UI hydration missed it.
- Fix implemented:
  - Reworked item hydration to search matching batch item across:
    1) phase-preferred month batches,
    2) fallback all month batches.
  - Keep phase/period preference but do not hard-lock to first batch.
  - Normalize amount using `Number(existingItem?.amount || 0)` before binding to UI row.
- Validation:
  - `pnpm -s exec tsc --noEmit` PASS
  - `pnpm vitest run` PASS

## Update (Final Investigation Pass)
- User evidence:
  - PB record clearly persisted (`batch_items.id=skc96b3nddrmd73`, `amount=1212`) but UI still blank and blocked Step 1 with `Cannot fund Phase with 0 amount`.
- Additional root cause addressed:
  - Hydration matching was still too strict for some migrated rows (bank field normalization mismatch).
  - Step 1/2 pre-check relied on phase UI totals only, so mapping miss caused false zero blocking before hitting server logic.
- Final fixes:
  - Relaxed migrated-row matching heuristic in checklist hydration:
    - exact `master_item_id`, OR
    - normalized `receiver_name` + (`bank_number` OR `target_account_id`) with soft `bank_name` check.
  - Step 1 and Step 2 totals now use fallback max between:
    - phase UI derived total, and
    - actual selected `batch.batch_items` total from loaded DB payload.
  - This removes false zero blockers even when one UI mapping edge case remains.
- Validation:
  - `pnpm -s exec tsc --noEmit` PASS
  - `pnpm vitest run` PASS

## Update (Post-Fix UX + Step2 Sheet Integrity)
- User confirmed Step 1 funding works again.
- New requests implemented:
  - Add compact "created transactions" mini-lines above checklist for quick open in transactions page.
  - Improve amount pill readability (`68,888` less heavy; unit text larger).
  - Add batch-step awareness for transaction editing safety.
- Critical Step2 bug fixed:
  - Root cause: sheet action sent full batch payload instead of only current phase items, causing count mismatch/ghost rows.
  - Fix: `sendBatchToSheetAction` now accepts `batchItemIds` (current phase only) and PB action filters by those IDs.
  - Added effective-item filtering (`amount > 0`) and count now reflects actually sent rows.
  - Added note prefix with phase label (`Phase 1/2 ...`) and bank number fallback from expanded target account if item field is empty.
- Batch transaction metadata hardening:
  - Added `metadata.batch_step = 'step1'` for funding txns.
  - Added `metadata.batch_step = 'step3'` for confirmed batch item txns.
  - Transaction table now shows `BATCH S1` / `BATCH S3` badge and warns before editing these txns.
- Validation:
  - `pnpm -s exec tsc --noEmit` PASS
  - `pnpm vitest run` PASS

## Update (Final User Debug Pass - IMG1/IMG2/IMG3)
- IMG1: Step1 transaction line not visible in batch UI.
  - Added deterministic phase-batch resolver in checklist UI.
  - Added fallback display map for just-created Step1 txn IDs per phase.
  - Added server-side fallback in `getChecklistDataAction`: if `batches.funding_transaction_id` is missing, lookup by transaction metadata (`batch_id`, `batch_step=step1`, `type=batch_funding`) and attach as `funding_transaction`.
- IMG2: Sheet account number blank and note format mismatch.
  - PB sheet payload now expands `master_item_id` and uses bank-number fallback chain:
    - `batch_items.bank_number` -> expanded target account number -> expanded master bank number.
  - Enforced note format:
    - `Tên + Phase Label + Tháng/Năm + Bank`
    - e.g. `Vcb Signature Phase 1 Feb2026 by Mbb`.
  - Step2 still limited to current phase item IDs to prevent ghost lines.
- GAS consistency check (`integrations/google-sheets/batch-sync/Code.js`):
  - Updated mapping to accept PB payload aliases (`bank_number/account_number/account_no`, `note/payment_detail/content`, etc.).
  - Bumped script marker to version 1.7.
  - Deployed to both scripts:
    - `pnpm run sheet:batch:1` (MBB) -> pushed
    - `pnpm run sheet:batch:2` (VIB) -> pushed
- Checkbox/confirm behavior clarification:
  - Checklist intentionally shows selection checkbox only for non-confirmed rows with valid `batch_item_id`.
  - Confirmed rows show status icon and are locked from pending bulk selection.
  - Account detail pages still have active pending-batch confirmation paths via:
    - `/api/batch/pending-items`
    - `/api/batch/confirm-item`
    - components: `account-detail-header`, `confirm-money-received`, `accounts/v2/AccountDetailViewV2`, dashboard pending panel.
- Validation:
  - `pnpm -s exec tsc --noEmit` PASS
  - `pnpm vitest run` PASS

## Notes
- `.env.local` in local workspace currently contains sensitive tokens/credentials; rotate compromised secrets if they were shared externally.
