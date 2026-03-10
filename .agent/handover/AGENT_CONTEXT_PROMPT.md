# Money Flow 3 - Context Understanding Prompt

## Objective
Read and understand the Money Flow 3 project structure, codebase rules, current issues, database schema, and new PocketBase collections. This is purely for context gathering and understanding—**no coding at this stage**. Produce a comprehensive summary covering the project scope, current state, and requirements for the next phase of PocketBase migration and refactoring.

## Step 1: Understand Project Foundation

Read the following files to establish baseline knowledge:
- **/.github/copilot-instructions.md** – Project stack, architecture, business logic, UI rules, essential services, transaction system, cashback engine, server actions pattern, data flow patterns, integration notes, and common pitfalls
- **/README.md** – High-level project status, Phase notes, and overall project context
- **/.agent/README.md** – Transaction Slide V2 architecture
- **/.cursorrules** – Detailed coding standards (sections 1-6)
- **/.agent/CASHBACK_GUIDE_VI.md** – Complete cashback flow walkthrough

## Step 2: Assess Current PocketBase Migration State

Read these handover documents created by the previous agent:
- **/.agent/handover/POCKETBASE_MIGRATION_PROGRESS.md** (593 lines)
  - What has been completed (Accounts 100%, Sidebar Search, Dev Port)
  - What is partially complete (Categories/Shops UI, Sidebar hybrid search)
  - What is pending (People pages, Categories/Shops CRUD, Batch system, Installments)
  - Collection schemas available in PocketBase
  - Migration patterns and service layer architecture
  - Next priority tasks for continuation
  
- **/.agent/handover/POCKETBASE_API_REFERENCE.md** (637 lines)
  - Authentication patterns (pbAuth)
  - Core helper functions for PocketBase operations
  - Filter/sort syntax and pagination
  - ID resolution patterns (3-tier strategy: direct ID → toPocketBaseId(uuid) → slug filter)
  - Error handling and fallback mechanisms
  - Field mapping conventions (slug field stores Supabase UUID, app returns id: record.slug || record.id)
  - Performance optimization techniques
  - Common use cases and testing examples

## Step 3: Database Schema & Collections

Understand the current state:
- **PocketBase API Base:** https://api-db.reiwarden.io.vn
- **Supabase:** Still used for authentication (signInWithPassword, signUp) and fallback data
- **Environment Variables Required:**
  - POCKETBASE_URL
  - POCKETBASE_DB_EMAIL
  - POCKETBASE_DB_PASSWORD
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

### Collections Migrated (✅ Phase 1 Complete)
**accounts**
- PocketBase ID (auto-generated)
- slug field (stores original Supabase UUID for backward compatibility)
- Related fields: name, image_url, type, status, linked_account_id, owner_id
- CRUD: Full PocketBase implementation
- Location: src/services/pocketbase/account-details.service.ts
- Collections count: 91 records with slug backfill confirmed

**transactions**
- Connected to accounts, people, shops, categories
- Supports transaction_lines for installments (is_installment flag prevents double-counting)
- Supports cashback_entries relationships
- Location: src/services/transaction.service.ts
- Status: Reads from PocketBase with Supabase fallback

**cashback_cycles**
- Related to accounts, cashback_entries
- Tracks spent_amount for historical cycle data
- Location: src/services/pocketbase/account-details.service.ts
- Status: Fully migrated

**cashback_entries**
- Stores cashback policy metadata (policySource, rate, ruleMaxReward, levelId, levelName)
- Related to transactions, accounts
- Location: Integrated with transaction service
- Status: Fully migrated

### Collections Partially Migrated (⚠️ Phase 1 Incomplete)
**people**
- Schema may need slug field addition
- Read operations: PocketBase with Supabase fallback
- CRUD (create/update/delete): Still uses Supabase service
- Location: src/services/people.service.ts (needs migration)
- Collections count: 27 records, backfill attempted but schema mismatch possible
- Priority: HIGH

**shops**
- Schema may need slug field addition
- Read operations: PocketBase with Supabase fallback
- CRUD (create/update/delete): Still uses Supabase service
- Location: src/services/shop.service.ts (needs migration)
- Collections count: 29 records, backfill attempted but schema mismatch possible
- Priority: HIGH (shared with categories)

**categories**
- Schema may need slug field addition
- Read operations: PocketBase with Supabase fallback
- CRUD (create/update/delete): Still uses Supabase service
- Location: src/services/category.service.ts (needs migration)
- Collections count: 31 records, backfill attempted but schema mismatch possible
- Priority: HIGH (shared with shops)

### Collections Pending (❌ Not Started)
**batch_masters, batch_items**
- Bulk import system (MBB, VIB parsers)
- Location: src/services/batch.service.ts, src/app/batch/** pages
- Status: Not migrated, still uses Supabase
- Priority: MEDIUM (Phase 2)

**installments** (part of transactions)
- Parent-child relationships via transaction_lines
- Location: src/app/installments/** pages
- Status: UI not fully migrated, service layer ready
- Priority: MEDIUM (Phase 2)

## Step 4: Current Issues & Limitations

### Resolved Issues (Phase 1 Fixed)
- ✅ Login UX: Email trimming on blur, password visibility toggle
- ✅ PocketBase 404 errors: Implemented 3-tier ID resolution (direct → hash → slug filter)
- ✅ Sidebar performance: Created /api/sidebar/search endpoint (1 call vs 4)
- ✅ Dev port conflicts: Auto port selection (3001-3005 priority, 3000 as last resort)
- ✅ recharts 3.6.0 error: Locked to exact "3.5.1" version
- ✅ Vercel build failures: Fixed getCategoriesWithSource/getShopsWithSource references
- ✅ react-remove-scroll-bar warning: Created postinstall fix script

### Known Limitations & Schema Questions
- **Slug field availability:** People, Shops, Categories backfill scripts reported success (27/29/31 records) but validation reads return 0 — **verify PocketBase schema has slug field before coding**
- **Batch import logic:** Deduplication on `transaction_date + amount + details` might need PocketBase query adjustment
- **Installment handling:** Transaction service correctly handles `is_installment` flag, but UI pages haven't been fully migrated
- **Categories/Shops delete:** Requires target reassignment logic (when deleting category, reassign transactions to default category)

### Hybrid Approach Notes
- **Sidebar search:** Currently hybrid (accounts from PB, people/shops/categories from Supabase direct queries) until slug field verification
- **Account service:** Fully PocketBase with Supabase fallback via executeWithFallback()
- **ID resolution strategy:** All account lookups use resolvePocketBaseAccountRecord() to handle both direct PB IDs and Supabase UUIDs

## Step 5: Code Architecture & Patterns

### Service Layer Pattern
All PocketBase service files located in `src/services/pocketbase/`:
```
account-details.service.ts (1055 lines, fully migrated)
├── resolvePocketBaseAccountRecord(id) – 3-tier ID lookup
├── getPocketBaseAccountDetails(id) – Account with stats
├── getPocketBaseAccountCycleOptions(id) – Cycle dropdown
├── getPocketBaseAccountSpendingStatsSnapshot(id, date) – Cashback stats
├── loadPocketBaseTransactionsForAccount(id) – Related transactions
└── mapAccount/Category/Person/Shop(record) – Returns slug || id

[Pending implementations]
people.service.ts (to be created)
├── getPocketBasePeople()
├── getPocketBasePersonDetails(id, resolver)
├── createPocketBasePerson/updatePocketBasePerson/deletePocketBasePerson
└── resolvePersonRecord(id)

categories-shops.service.ts (extend account-details.service.ts)
├── updatePocketBaseCategory/Shop
├── deletePocketBaseCategory/Shop (with reassignment)
└── Support bulk archive/unarchive operations

batch.service.ts (to be created)
└── Extend for PocketBase batch masters & items
```

### Server Actions Pattern
All mutations follow strict pattern from `src/actions/*-actions.ts`:
```typescript
export async function myAction(input: T): Promise<{ success: boolean; error?: string; data?: R }> {
  try {
    // PocketBase calls wrapped with executeWithFallback(pbCall, sbCall, name)
    const result = await myService.doSomething(input)
    revalidatePath('/path') // REQUIRED after mutations
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
```

### Fallback & Error Handling Pattern
Key helper: `isPocketBase400Or404(error)` returns true for:
- HTTP 400/404 status
- "fetch failed" error message
- `error.code === 'UND_ERR_SOCKET'` (network error)
- `error.cause.code === 'UND_ERR_SOCKET'`

Wrapper: `executeWithFallback(pbCall, sbCall, name)` catches errors and falls back to Supabase on recoverable errors.

### ID Resolution Strategy
**3-tier approach** (documented in POCKETBASE_API_REFERENCE.md):
1. Try direct PocketBase ID lookup
2. Convert Supabase UUID using toPocketBaseId(uuid) and try hash-based lookup
3. Filter by slug='uuid' to find record by stored Supabase UUID

All account-related functions use `resolvePocketBaseAccountRecord(id)` before querying.

## Step 6: Files to Review (Code Implementation Files)

### Phase 1 Complete (Reference Implementation)
- **src/services/pocketbase/account-details.service.ts** – Template for people/categories/shops services
- **src/app/accounts/page.tsx** – How to use resolved account IDs in UI
- **src/app/accounts/[id]/page.tsx** – Detail page with account resolver
- **src/actions/account-actions.ts** – Server actions pattern with executeWithFallback
- **src/components/navigation/sidebar-search.tsx** – Client component using API endpoint
- **src/app/api/sidebar/search/route.ts** – Lightweight API endpoint pattern
- **src/lib/pocketbase/fallback-helpers.ts** – Error handling and fallback helpers

### Phase 1 Incomplete (Need Migration)
- **src/services/people.service.ts** – Create PocketBase version using account service as template
- **src/services/category.service.ts** – Create PocketBase version with CRUD
- **src/services/shop.service.ts** – Create PocketBase version with CRUD
- **src/services/batch.service.ts** – Create PocketBase version for bulk import
- **src/app/people/page.tsx** – Needs UI updates for PocketBase data
- **src/app/people/[id]/page.tsx** – Needs ID resolver integration
- **src/app/categories/page.tsx** – UI partially ready, needs CRUD server actions
- **src/app/shops/page.tsx** – UI partially ready, needs CRUD server actions

## Step 7: Build & Deploy Status

### Current Status
- ✅ `pnpm build` passes (9.4s compilation, 52 routes, no TypeScript errors)
- ✅ Vercel build passes (after pnpm-lock.yaml sync and getCategoriesWithSource fix)
- ✅ Dev server runs on auto-selected port (3001 by default, respects 3001-3005 preference)
- ✅ All source files committed (commit 767a08f with .gitignore cleanup)

### Pre-Deploy Checklist
Before each commit:
1. Run `pnpm lint` – must pass (auto-fixes many issues)
2. Run `pnpm build` – must succeed without TS errors
3. Run Google Sheets sync if updating people/batch integrations: `pnpm sheet:people` or `pnpm sheet:batch`
4. Run `git status` to verify no .next or .env.local changes are staged
5. Commit and push to `feat/pb-refactor-clean-<YYYYMMDD>` branch format

## Step 8: Summary Questions for Verification

After reading all materials, answer these to validate understanding:

1. **ID Resolution:** When you see a Supabase UUID in an account URL, what are the 3 steps to find the PocketBase record?
2. **Schema Verification:** Before starting People migration, what must you confirm about the slug field in PocketBase?
3. **Fallback Pattern:** How is executeWithFallback() used and what network errors trigger PocketBase → Supabase fallback?
4. **Collections Status:** Which collections (accounts, people, shops, categories, transactions, batch) are 100% migrated to PocketBase vs pending?
5. **Priority Sequence:** What are the top 3 focus areas for Phase 2 (in order of priority)?

## Output Format

Provide a comprehensive summary (500-1000 words) covering:
- **Project Overview:** Stack, architecture, data sources (PocketBase + Supabase)
- **Migration Status:** What's done (Phase 1), what's in progress (Phase 1 incomplete), what's pending (Phase 2+)
- **Schema Understanding:** Collections available, slug field strategy, ID resolution approach
- **Current Issues:** Resolved, known limitations, questions needing resolution
- **Code Patterns:** Service layer, server actions, error handling, ID resolution
- **Next Phase Requirements:** Top 3 priorities with specific files/functions to migrate
- **Build & Deployment:** Current status, pre-commit checklist, branch naming convention

**Do not write any code. Focus on understanding and analysis only.**
