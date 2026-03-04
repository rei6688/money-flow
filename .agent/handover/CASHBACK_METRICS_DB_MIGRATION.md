# Cashback Metrics Sync - DB Migration Required

**Date**: March 4, 2026  
**Branch**: `feat/understanding-architecture-mar2026`  
**Commit**: `04235f3`  
**Status**: 🚧 **Blocked by DB Migration** (persisted_cycle_tag not populated)

---

## 📋 Context

### What We Fixed
We refactored cashback metrics calculation to sync data between:
- **Header Card** (Cashback Performance section) 
- **Transaction Table** (Est. Cashback / Shared / Profit columns)

Previously, these two sources showed **different values** because:
- Header card used API `/api/cashback/stats` (correct calculation)
- Table used client-side aggregation from `selectedCycleMetrics` useMemo

### Changes Made (Commit 04235f3)

#### 1. Header Card Metrics (AccountDetailHeaderV2.tsx)
- **Primary data source**: `dynamicCashbackStats` from API (not client-side `selectedCycleMetrics`)
- **Calculation method**: Transaction amount × policy rate (via `resolveCashbackPolicy`)
- **Added tooltips**: Show detailed formulas for Est/Shared/Profit
  - Est tooltip: Lists all rules with `[Spent] × [Rate]% = [Earned]`
  - Profit tooltip: Shows `Est - Shared = Profit` with actual numbers
- **Progress bar**: Uses API `earned` value instead of client calculation

#### 2. Cycle Dropdown Enhancements (MonthYearPickerV2.tsx)
- **Search functionality**: Filter cycles by label/value
- **Scrollable list**: max-h-220px with overflow-y-auto
- **Auto-select**: Automatically enter cycle mode for credit card accounts
- **Always visible**: Cycle tab shows even when no cycles exist (for credit cards)

#### 3. Service Layer Fixes (cashback.service.ts)
- **Cycle range resolution**: Changed ref date from day 25 → day 1 of month
- **Transaction types**: Added 'service' to eligible spend types (3 query locations)
- **TypeScript**: Fixed cashback_entries query result typing

#### 4. UI Alignment
- Account card: 105px → **120px** height
- Credit Health card: 105px → **120px** height
- Cashback Performance: auto height (unchanged)

---

## 🚨 Critical Issue: DB Schema Mismatch

### Problem
**API query returns 0 transactions despite UI showing correct data.**

**Logs from `getAccountSpendingStats`**:
```
[getAccountSpendingStats] Transactions found by persisted_cycle_tag: 0
[getAccountSpendingStats] Transactions found by tag column: 0
[getAccountSpendingStats] Trying date range: { start: '2026-02-26T17:00:00.000Z', end: '2026-03-26T16:59:59.999Z' }
[getAccountSpendingStats] Transactions found by date range: 0
[getAccountSpendingStats] Eligible transactions: 0
[getAccountSpendingStats] Earned so far: 0
```

### Root Cause
**`persisted_cycle_tag` field is `NULL` for most/all transactions in current DB.**

#### Why UI Works
1. Server component loads ALL transactions via `loadTransactions()`
2. Passes to `AccountDetailViewV2` as `initialTransactions` prop
3. Client-side filter: `tx.persisted_cycle_tag || tx.derived_cycle_tag`
4. Shows correct data in table

#### Why API Fails
1. API `/api/cashback/stats?cycleTag=2026-02` queries DB directly
2. Filters by `persisted_cycle_tag = '2026-02'`
3. No transactions match → returns 0 for all metrics

### SQL Queries Used (cashback.service.ts:636-695)
```typescript
// Query 1: By persisted_cycle_tag
let txnsQuery = supabase
  .from('transactions')
  .select('...')
  .eq('persisted_cycle_tag', resolvedCycleTag)

// Query 2: By legacy tag column
const { data: legacyTagTxns } = await supabase
  .from('transactions')
  .select('...')
  .eq('tag', resolvedCycleTag)

// Query 3: Fallback to date range
const { data: dateTxns } = await supabase
  .from('transactions')
  .select('...')
  .gte('occurred_at', cycleRange.start.toISOString())
  .lte('occurred_at', cycleRange.end.toISOString())
```

**All 3 queries return 0 results** → suggests `persisted_cycle_tag` not populated in current DB.

---

## ✅ Solution After DB Migration

### Option 1: Populate persisted_cycle_tag (Recommended)
Run a migration to backfill `persisted_cycle_tag` for all existing transactions:

```sql
-- Migration: Backfill persisted_cycle_tag
UPDATE transactions
SET persisted_cycle_tag = (
  -- Calculate cycle tag based on account's statement day
  -- For calendar cycles: YYYY-MM
  -- For statement cycles: YYYY-MM (where MM = end month)
  SELECT 
    CASE 
      WHEN a.cb_cycle_type = 'calendar_month' THEN
        TO_CHAR(t.occurred_at, 'YYYY-MM')
      WHEN a.statement_day IS NOT NULL THEN
        -- Calculate statement cycle end month
        -- Example: statement_day=25, occurred_at=2026-02-26 → cycle=2026-03
        TO_CHAR(
          (t.occurred_at + INTERVAL '1 day' * (a.statement_day - 1))::DATE,
          'YYYY-MM'
        )
      ELSE
        TO_CHAR(t.occurred_at, 'YYYY-MM')
    END
  FROM accounts a
  WHERE a.id = t.account_id
)
WHERE persisted_cycle_tag IS NULL OR persisted_cycle_tag = '';
```

**Verify**:
```sql
SELECT 
  count(*) as total,
  count(persisted_cycle_tag) as tagged,
  count(*) - count(persisted_cycle_tag) as missing
FROM transactions
WHERE account_id IN (SELECT id FROM accounts WHERE type = 'credit_card');
```

### Option 2: Add derived_cycle_tag to API Query
If `persisted_cycle_tag` migration is complex, modify API to also check `derived_cycle_tag`:

```typescript
// cashback.service.ts:636
let txnsQuery = supabase
  .from('transactions')
  .select('...')
  .or(`persisted_cycle_tag.eq.${resolvedCycleTag},derived_cycle_tag.eq.${resolvedCycleTag}`)
```

**Cons**: `derived_cycle_tag` might not exist either (not in schema yet).

### Option 3: Compute Cycle Tag in Query
Use date range calculation as primary method:

```typescript
// Replace tag-based queries with date range only
const { data: txns } = await supabase
  .from('transactions')
  .select('...')
  .eq('account_id', accountId)
  .gte('occurred_at', cycleRange.start.toISOString())
  .lte('occurred_at', cycleRange.end.toISOString())
```

**Cons**: Requires accurate cycle range calculation for all edge cases (statement vs calendar).

---

## 🧪 Testing After Migration

### Pre-Migration State (Current)
- ❌ Header card shows: Est=0, Shared=0, Profit=0, Earned %=0%
- ✅ Transaction table shows: Est=500k, Shared=300k, Profit=200k (client-side filter works)
- ❌ API response: `{ earnedSoFar: 0, sharedAmount: 0, netProfit: 0 }`

### Expected After Migration
1. **Run migration** to populate `persisted_cycle_tag`
2. **Verify DB**: `SELECT count(*) FROM transactions WHERE persisted_cycle_tag IS NOT NULL`
3. **Test API**: 
   ```bash
   curl "http://localhost:3002/api/cashback/stats?accountId=0ece401d-36eb-4414-a637-03814c88c216&cycleTag=2026-02"
   ```
   Expected response:
   ```json
   {
     "earnedSoFar": 500000,
     "sharedAmount": 300000,
     "netProfit": 200000,
     "currentSpend": 18480000,
     "activeRules": [...]
   }
   ```
4. **Reload UI**: Header card should show matching values with table
5. **Hover tooltips**: Should display detailed calculation formulas

### Test Cases
- [ ] Cycle selection shows correct metrics (Est/Shared/Profit match table)
- [ ] Progress bar shows correct percentage (earned/cap)
- [ ] Tooltips display detailed formulas with actual numbers
- [ ] Cycle dropdown search filters correctly
- [ ] Auto-select enters cycle mode for credit card accounts
- [ ] Metrics sync when switching between cycles

---

## 📁 Files Changed

| File | Changes | Lines |
|------|---------|-------|
| `src/components/accounts/v2/AccountDetailHeaderV2.tsx` | Metrics calculation refactor, tooltips | +120, -80 |
| `src/components/accounts/v2/AccountDetailTransactions.tsx` | Cycle mode auto-select | +15, -8 |
| `src/components/transactions-v2/header/MonthYearPickerV2.tsx` | Search, scroll, auto-focus | +45, -12 |
| `src/components/transactions-v2/header/TransactionHeader.tsx` | Conditional cycle tags | +8, -3 |
| `src/services/cashback.service.ts` | Cycle range fix, service type | +21, -11 |

**Total**: 5 files, +209 insertions, -114 deletions

---

## 🔗 Related Issues

### Upstream Dependencies
- **DB Migration**: Self-hosted migration in progress
- **Schema**: `persisted_cycle_tag` column exists but not populated
- **Data**: Existing transactions need backfill

### Downstream Impact
- **Cashback analytics**: Blocked until metrics calculate correctly
- **Reports**: Any cycle-based reporting relies on this fix
- **User trust**: Showing 0 values erodes confidence in cashback tracking

### Alternative Workaround (Temporary)
If migration is delayed, revert header to use client-side calculation:

```typescript
// AccountDetailHeaderV2.tsx:1127
const cycleEstCashback = selectedCycleMetrics?.est ?? 0; // Remove API fallback
const cycleShared = selectedCycleMetrics?.shared ?? 0;
const cycleProfit = selectedCycleMetrics?.profit ?? 0;
```

But keep in mind: client calculation uses `cashback_entries` which might also be incomplete.

---

## 📝 Next Steps for Migration Agent

1. **Verify schema**: Check if `persisted_cycle_tag` column exists in target DB
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'transactions' AND column_name = 'persisted_cycle_tag';
   ```

2. **Check data**: Count how many transactions need backfill
   ```sql
   SELECT 
     type,
     count(*) as total,
     count(persisted_cycle_tag) as tagged
   FROM transactions
   GROUP BY type;
   ```

3. **Run backfill**: Choose Option 1 migration above if >90% transactions missing tag

4. **Validate**: Test API endpoint returns non-zero values

5. **Deploy**: Merge branch after confirming metrics sync correctly

---

## 🆘 Troubleshooting

### "Still showing 0 after migration"
- Check server console logs: `[getAccountSpendingStats]` should show non-zero transaction count
- Verify query in DB: Does `SELECT count(*) FROM transactions WHERE persisted_cycle_tag = '2026-02'` return >0?
- Check date range: Is `cycleRange` calculation matching transaction `occurred_at`?

### "Tooltips not showing formulas"
- Check `activeRules` in API response: Should contain array of rules
- Ensure `dynamicCashbackStats` is not null in component
- Verify TooltipProvider wraps component tree

### "Progress bar stuck at 0%"
- Check `earned` value: Should be from `dynamicCashbackStats?.earnedSoFar`
- Verify `effectiveCap`: Should be `maxCashback` or sum of `activeRules[].max`
- Check isQualified flag: If false and minSpend >0, shows "Spend" instead of "Earned"

---

**Priority**: 🔴 HIGH - Blocks cashback feature UX  
**Assignee**: DB Migration Agent  
**ETA**: After self-hosted DB migration completes
