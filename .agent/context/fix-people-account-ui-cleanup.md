# Handover — fix/people-account-ui-cleanup (2026-03-13)

## Scope
- Account details page UI enhancements (account header actions).
- Unified transaction table Notes Flow actions (add PocketBase open icon).
- Tailwind v4 source scanning fix to stop CSS parse error from stray `w-[var(...)]` tokens.

## Current Status
- Implemented UI updates and build passes.
- Pending: decide whether to keep `next-env.d.ts` change from build and whether to commit untracked artifacts.

## Changes Made
### 1) Tailwind source scanning fix
- File: `src/app/globals.css`
- Added:
  - `@layer theme, base, components, utilities;`
  - `@tailwind utilities source(none)` before `@import "tailwindcss"`
  - Keep `@source "../**/*.{ts,tsx,js,jsx,mdx}";`
- Rationale: disable default root scan (`**/*`) to avoid invalid arbitrary class (`w-[var(...)]`) from non-code files.

### 2) Account details header actions
- File: `src/components/accounts/v2/AccountDetailHeaderV2.tsx`
- Updates:
  - Removed Back icon before account image.
  - Added copy Account ID icon and ID tooltip icon after account name.
  - Added PocketBase open icon after Edit.
- PocketBase URL:
  - `https://api-db.reiwarden.io.vn/_/#/collections?collection=pvl_acc_001&filter=<accountId>&sort=-%40rowid`

### 3) Notes Flow column — Unified Transaction Table
- File: `src/components/moneyflow/unified-transaction-table.tsx`
- Added PocketBase open icon (Database) next to existing copy + open web icons.
- PocketBase URL:
  - `https://api-db.reiwarden.io.vn/_/#/collections?collection=pvl_txn_001&filter=<txnId>&sort=-%40rowid`

## Tests
- `npm run build`
  - Passed.
  - Warnings:
    - `baseline-browser-mapping` outdated.
    - `Dynamic server usage` for `/batch` due to cookies (expected in current setup).

## Open Items / Decisions Needed
- `next-env.d.ts` changed by build (`./.next/dev/types/routes.d.ts` → `./.next/types/routes.d.ts`). Decide whether to commit or revert.
- Untracked files present:
  - `Money Flow 3 Onboarding and Branch Cleanup`
  - `scripts/pocketbase/migrate-accounts-add-missing-fields.mjs`
- Existing PR (if needed to update): `rei6688/money-flow` PR #257.

## Notes
- If CSS parse error still appears, check for stray `w-[var(...)]` tokens in non-code files and ensure default root scan is disabled via `@tailwind utilities source(none)`.
