# Money Flow 3 - Handover Note (2026-03-12)

This document outlines the current status of the People Details UI refactor and remaining issues as of the end of the current session.

## 🏗️ Phase Status: Phase 15 - People UI Refactor & Data Consistency

### 1. Calculation & Data Display Items (CRITICAL)
- **Problem**: The People Details Header showed an incorrect `REMAINS` balance (366,034) even when `Net Lend` exactly matched `Total Repay`. 
- **Cause**: The `use-person-details.ts` hook was preferring the server-side `remainingPrincipal` from the `debt_tags` table. The server-side logic (likely a PostgreSQL trigger or FIFO logic) was calculating principal based on the **Original Amount** instead of the **Net Amount** (Original - Cashback), leading to a discrepancy equal to the cashback amount.
- **Fix (Partial)**: Refactored the hook to prefer the local Net-aware calculation (`lend - repay`) when displaying balances.
- **Action Required**: The server-side trigger/logic in Supabase must be audited to ensure `remaining_principal` is correctly calculated after cashback deductions.

### 2. Date Picker & Cycle Filter
- **Problem**: The Cycle filter remains active/selected even when the Account filter is cleared. This creates a state where the user sees a specific cycle's data without knowing which account it belongs to (or if it's a global cycle, which is non-existent in the current schema). 
- **Symptoms**: Observed on `People Details` and `Account Details` (/accounts/[id]?tag=2026-01). Clicking "All" -> "Apply" in the picker often fails to reset the URL param.
- **Goal**: If Account filter is blank, the Time/Cycle picker should default to "All" or "All History" instead of persisting a specific cycle tag.
- **Current Blocker**: `MonthYearPickerV2` has complex state synchronization that forces `cycle` mode whenever cycle tags are provided in the context.

### 3. Statement Cycle Logic Bug
- **Problem**: Credit Cards with a defined `statement_day` (e.g., VPBank Lady, day 20) should group transactions into billing cycles (e.g., 20.A to 19.B).
- **Issue**: Some views (Account Detail Header) currently show standard calendar months (e.g., `2026-02`) even for these cards. The logic in `calculateCycleTag` (in `migrate.mjs`) and the frontend equivalent needs to be consistently applied across all pages.
- **Reference**: VPBank Lady has `statement_day: 20`. A transaction on 2026-01-21 should belong to the Feb 2026 cycle (Tag: `2026-02`).

### 4. Account Data Corruption (Legacy IDs)
- **Problem**: The `cashback_config` (json) in the `accounts` collection contains Supabase UUIDs in the `cat_ids` fields.
- **Impact**: Reward mapping fails because the app expects 15-character PocketBase IDs for category matching.
- **Evidence**: See "Vpbank Lady" config where `cat_ids` still use UUIDs like `f312074c-24ed-4e68-a198-bdf99f53452a`.

### 5. Transaction Slide V2 Issues
- **Problem A (Cascade Clearing)**: Switching accounts sometimes clears the selected **Category**. This is likely due to the `CASCADE` logic in `CategoryShopSection.tsx` which checks compatibility between Category/Shop/Type. If the new account triggers a `type` change (e.g., from Expense to Debt), the category might be deemed incompatible and cleared.
- **Problem B (Category Scroll)**: Reports of categories being cleared during scrolling. This suggests an issue with virtualized lists or state re-renders in the `Combobox` component.
- **Enhancement**: Dropdowns now display **Badges** (e.g., Credit, External) for selected items in the `QuickFilterDropdown` (already implemented in latest commit).

### 6. UI/UX Refinements
- **Header Structure**: The "Cycle Summary" (Progress Bar) and "Balance Breakdown" are now merged into a single cohesive layout.
- **Reward Progress**: The Cashback Performance section is now forced to be always visible (`LUÔN show`) in the header for better visibility of credit card goals.

### 7. Connection Timeout Error (PocketBase)
- **Problem**: Occasional `TypeError: fetch failed` with `ConnectTimeoutError` (UND_ERR_CONNECT_TIMEOUT) when opening account links in a new tab.
- **Details**: `GET /accounts/[id]` takes up to 27s and sometimes times out (default 10s).
- **Potential Cause**: Networking issues or excessive cold-start/latency from the PocketBase API (`api-db.reiwarden.io.vn`). Need to check if request batching or optimized fetching can reduce this.

---

## 🛠️ Account Re-migration Plan (Next Agent)
The current account data is inconsistent. A clean re-migration is required.

**Steps**:
1. **Script Preparation**: 
   - Path: `scripts/pocketbase/migrate.mjs`
   - **Update**: Modify the `mapper` for `accounts` to recursively map any `cat_ids` found in `cashback_config` from Supabase UUIDs to the new PocketBase 15-char IDs. You can use the `toPocketBaseId(id, 'categories')` helper.
2. **Cleanup**:
   - Wipe the `accounts` collection in PocketBase.
   - **Warning**: Ensure you rotate/backup IDs if they are used as foreign keys in `transactions` to avoid breaking relationships. (Actually, `migrate.mjs` uses `toPocketBaseId` which is deterministic, so relinking should work if the logic is identical).
3. **Execution**:
   - Run: `node scripts/pocketbase/migrate.mjs --phase=accounts --cleanup=phase`
4. **Validation**:
   - Open PocketBase Admin and verify `cashback_config` has 15-character IDs in all `cat_ids` arrays.

---

## 🚀 Next Steps for Next Session
1. **Fix Cycle Persistence**: Update `MemberDetailView.tsx` and `AccountDetailView.tsx` (if same logic) to explicitly clear the cycle tag when no specific account is selected.
2. **Implement Re-migration**: Follow the plan above to fix corrupted `cat_ids`.
3. **Audit Transaction Slide**: Review `useEffect` dependencies in `TransactionSlideV2.tsx` to prevent accidental `setValue('category_id', null)`.
4. **Database Audit**: Verify `remaining_principal` calculation logic in Supabase triggers (specifically for transactions with `final_price` or `cashback_share`).

**Last Updated**: 2026-03-12  
**Branch**: `feat/pb-fresh-remigrate-20260312`  
