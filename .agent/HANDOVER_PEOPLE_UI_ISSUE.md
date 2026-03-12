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
- **Goal**: If Account filter is blank, the Time/Cycle picker should default to "All" or "All History" instead of persisting a specific cycle tag.
- **Current Blocker**: `MonthYearPickerV2` has complex state synchronization that forces `cycle` mode whenever cycle tags are provided in the context.

### 3. Transaction Slide V2 Issues
- **Problem A (Cascade Clearing)**: Switching accounts sometimes clears the selected **Category**. This is likely due to the `CASCADE` logic in `CategoryShopSection.tsx` which checks compatibility between Category/Shop/Type. If the new account triggers a `type` change (e.g., from Expense to Debt), the category might be deemed incompatible and cleared.
- **Problem B (Category Scroll)**: Reports of categories being cleared during scrolling. This suggests an issue with virtualized lists or state re-renders in the `Combobox` component.
- **Enhancement**: Dropdowns now display **Badges** (e.g., Credit, External) for selected items in the `QuickFilterDropdown` (already implemented in latest commit).

### 4. UI/UX Refinements
- **Header Structure**: The "Cycle Summary" (Progress Bar) and "Balance Breakdown" are now merged into a single cohesive layout.
- **Reward Progress**: The Cashback Performance section is now forced to be always visible (`LUÔN show`) in the header for better visibility of credit card goals.

---

## 🚀 Next Steps for Next Session
1. **Fix Cycle Persistence**: Update `MemberDetailView.tsx` to explicitly clear the cycle tag when `selectedAccountId` is removed.
2. **Audit Transaction Slide**: Review `useEffect` dependencies in `TransactionSlideV2.tsx` to prevent accidental `setValue('category_id', null)`.
3. **Database Audit**: Verify `remaining_principal` calculation logic in Supabase triggers (specifically for transactions with `final_price` or `cashback_share`).

**Last Updated**: 2026-03-12  
**Branch**: `feat/pb-fresh-remigrate-20260312`  
