# Phase Handover - People Details, Sheet Config, Cycle UX

Date: 2026-03-11
Owner: Copilot handover snapshot
Status: STOPPED BY REQUEST - handoff for next agent

## 1) Executive Summary

Work across multiple phases fixed many People Detail issues (cycle aggregation, debt formula, header stats, picker behavior, notes actions, URL canonicalization in several views), but 2 critical problems are still inconsistent in real UI:

1. Sheet Config panel still appears blank in some entry flows (especially from /people listing -> details).
2. Some links still open legacy UUID route instead of canonical PocketBase route id.

This handover documents exactly what was done, what remains broken, where to continue, and the data-source confusion between Supabase legacy and PocketBase runtime.

---

## 2) What Was Completed

### 2.1 Data/Integrity + Cycle logic
- Backfill flow implemented and used for PB transaction person relation (`person_id`) to restore People detail transaction visibility.
- Debt-cycle tag resolution moved to debt-first precedence in People views/hook.
- Header/balance formulas corrected (user confirmed formula correctness earlier in thread).

### 2.2 People detail UX & controls
- Added cycle-aware Date Picker context in People controls.
- Added header syncing overlay state (not just table-level).
- Added stats popover tabs (Current vs Entire Year), removed mono number style there.
- Settled display adjusted to avoid showing `-0` behavior.

### 2.3 Notes/Date table behavior
- Date cell changed to `SEQ | dd.MM` format in unified transaction table.
- Open-in-new-tab action moved from Action column to Notes flow area and made visible in active Notes rendering path.

### 2.4 Config fallback attempts (implemented)
- In PB people service, added fallback attempts for missing config:
  - `sheet_link` from `sheet_webhook_links`
  - `google_sheet_url` from latest `person_cycle_sheets.sheet_url`
- Added fallback on manage-sheet UI state for sheet url.
- Added auto-detect `YYYY-MM` from URL/path/query/hash in sheet/script links to prefill cycle/year.

### 2.5 Canonical person route attempts
- Canonical route helper already exists: `getPersonRouteId(...)` in [src/lib/person-route.ts](src/lib/person-route.ts).
- Updated multiple views to use canonical IDs, including parts of unified table and people cards/mobile list.

---

## 3) Known Issues Still Reproducible (Unresolved)

## Issue A - Sheet Config still blank in some contexts

Symptoms:
- Script link field empty, Google Sheet URL empty, Default Bank Account empty in Manage Sheet Configuration despite data expected.

Why this is still likely happening:
1. Data source split remains inconsistent:
   - Some paths load person from PB-only fields.
   - Some paths rely on Supabase hydrations.
   - Some values are cycle-level (`person_cycle_sheets`) but UI expects profile-level defaults.
2. Fallback by `name` in `sheet_webhook_links` can miss (name mismatch, spacing, renamed profile).
3. Linked bank (`sheet_linked_bank_id`) has no robust fallback inference from transactional behavior when explicit fields are missing.

Hot files:
- [src/services/pocketbase/people.service.ts](src/services/pocketbase/people.service.ts)
- [src/components/people/manage-sheet-button.tsx](src/components/people/manage-sheet-button.tsx)
- [src/components/people/person-form.tsx](src/components/people/person-form.tsx)

## Issue B - Legacy UUID URL still appears from some /people paths

Symptoms:
- Opening details from `/people` can still produce old UUID URL (`/people/<supabase-uuid>`).

Why still possible:
1. Not all link emitters were migrated to canonical route id.
2. Revalidate/push URLs in server actions still target `/people/${id}` where `id` may be Supabase UUID.
3. `page.tsx` has canonical redirect support, but upstream emitters still send old IDs and can cause UX inconsistency/open-tab mismatch.

Hot files to audit with global grep:
- `href="/people/` and `router.push('/people/` across `src/components/**`, `src/actions/**`, `src/services/**`
- [src/app/people/[id]/page.tsx](src/app/people/[id]/page.tsx) (canonical redirect logic)

## Issue C - Date cycle default confusion (account cycle selected when no account selected)

Symptoms:
- Cycle picker shows account-like cycle default (e.g., `25.02 - 24.03`) when Accounts filter is not selected.

Likely root cause:
- Date picker receives cycle context props too eagerly, not gated by selected account state.

Hot files:
- [src/components/people/v2/TransactionControlBar.tsx](src/components/people/v2/TransactionControlBar.tsx)
- [src/components/people/v2/MemberDetailView.tsx](src/components/people/v2/MemberDetailView.tsx)
- [src/components/transactions-v2/header/MonthYearPickerV2.tsx](src/components/transactions-v2/header/MonthYearPickerV2.tsx)

---

## 4) Requested by User but Not Fully Landed

1. Unify rule: if debt cycle is chosen, account cycle should be `All Time` until account selected explicitly.
2. Sheet config must be profile-global and always prefilled from canonical source.
3. Complete refactor away from old Supabase UUID route usage in People links/actions.

---

## 5) Architecture & Data Source Map (Critical for Next Agent)

## 5.1 Legacy source (Supabase)

Reference docs:
- [database/SCHEMA.md](database/SCHEMA.md)
- [database/latest_schema.sql](database/latest_schema.sql)

Important legacy tables for this task:
- `people`
- `transactions`
- `person_cycle_sheets`
- `sheet_webhook_links`
- `accounts`

## 5.2 Runtime source (PocketBase)

Reference:
- [scripts/pocketbase/schema.json](scripts/pocketbase/schema.json)
- [src/services/pocketbase/server.ts](src/services/pocketbase/server.ts)

Working PB collections in active flow:
- `people`
- `accounts`
- `transactions`
- `categories`
- `shops`

## 5.3 Current practical truth (as implemented)

- People detail page currently resolves PB person first, then attempts SB hydration fallback.
- Sheet config is currently composed from mixed sources:
  1) `people.sheet_link`, `people.google_sheet_url`, `people.sheet_linked_bank_id`, etc.
  2) fallback `sheet_webhook_links.url`
  3) fallback `person_cycle_sheets.sheet_url`

This mixed strategy works partially but is still not deterministic enough for all entry paths.

---

## 6) Refactor Progress by Domain (CRUD readiness)

## 6.1 People domain
- Read: partially dual-source (PB primary + SB hydration fallback)
- Create/Update: still write/update patterns include legacy route assumptions in some actions
- Delete/Archive: works but route revalidation paths still assume `/people/${id}` old ID in several places

Status: IN PROGRESS

## 6.2 Sheet config domain
- Read: NOT UNIFIED (multi-source fallback, still inconsistent)
- Update: UI writes `people` fields via `updatePersonAction`
- Cycle sync: `person_cycle_sheets` per-cycle entries are used during sync

Status: PARTIALLY MIGRATED / NEEDS DESIGN DECISION

## 6.3 URL route canonicalization
- Canonical helper exists and adopted in many components
- Not yet complete across all emitters and server revalidation references

Status: PARTIAL

## 6.4 Cycle filtering UX
- Many improvements shipped (debt-cycle priority, picker tabs, history behavior)
- Remaining confusion at account-cycle default state when no account selected

Status: PARTIAL

---

## 7) Where Next Agent Should Start (Priority Plan)

## P0 - Make Sheet Config deterministic
1. Choose single authoritative read strategy for profile-level config.
2. Implement explicit precedence contract (example):
   - `people` fields first
   - fallback to latest `person_cycle_sheets` for URL only
   - fallback to `sheet_webhook_links` only when explicit mapping rule exists
3. Add debug logging for final merged config source on People detail page render.
4. Validate with one real person where values currently blank.

## P0 - Finish route canonicalization
1. Global grep all `/people/${...}` emitters.
2. Replace to `getPersonRouteId` where entity available.
3. For server actions `revalidatePath`, include canonical + legacy where needed short-term.

## P1 - Fix account-cycle default leakage
1. Only pass cycle context to MonthYearPicker when account filter is selected.
2. Debt-cycle mode should force account-cycle to all/unset state.

## P2 - Hardening
1. Add deterministic tests for `getPocketBasePersonDetails` merge behavior.
2. Add UI smoke scenario doc for People detail from `/people` list.

---

## 8) Repro Checklist for Next Agent

1. Open `/people` list.
2. Open person detail in new tab from card/list entry.
3. Verify URL id form (PB canonical vs UUID legacy).
4. Open `Manage Sheet` -> `Configurations`.
5. Verify fields:
   - Script Link
   - Google Sheet URL
   - Default Bank Account
6. In detail toolbar, verify cycle picker default with and without selected account.

---

## 9) Files Most Relevant for Continuation

- [src/services/pocketbase/people.service.ts](src/services/pocketbase/people.service.ts)
- [src/components/people/manage-sheet-button.tsx](src/components/people/manage-sheet-button.tsx)
- [src/components/people/v2/MemberDetailView.tsx](src/components/people/v2/MemberDetailView.tsx)
- [src/components/people/v2/TransactionControlBar.tsx](src/components/people/v2/TransactionControlBar.tsx)
- [src/components/transactions-v2/header/MonthYearPickerV2.tsx](src/components/transactions-v2/header/MonthYearPickerV2.tsx)
- [src/components/moneyflow/unified-transaction-table.tsx](src/components/moneyflow/unified-transaction-table.tsx)
- [src/lib/person-route.ts](src/lib/person-route.ts)
- [src/app/people/[id]/page.tsx](src/app/people/[id]/page.tsx)

---

## 10) Important Notes to Avoid Repeating Failed Loops

1. Do not patch only UI state in `manage-sheet-button` without fixing upstream person read merge.
2. Do not assume `name` matching in `sheet_webhook_links` is stable identity.
3. Do not pass account-cycle context unconditionally; gate by selected account.
4. Do not treat “URL canonical redirect exists” as complete route migration.

---

## 11) Handover Closeout

User requested stopping further implementation and producing detailed handover.

This document is the source for next-agent continuation.
