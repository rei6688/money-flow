# Money Flow 3 - Handover Task Continuation Prompt

## Prerequisite
Before starting this task, you MUST have completed the **AGENT_CONTEXT_PROMPT.md** (context understanding phase). This prompt assumes you have full understanding of:
- Project stack, architecture, and business logic
- Current PocketBase migration status (Phase 1 complete, Phase 2+ pending)
- Schema, ID resolution strategy, and error handling patterns
- Service layer and server actions conventions

## Objective
Continue the PocketBase migration from Phase 1 to Phase 2 by:
1. Completing People pages and CRUD migration
2. Completing Categories & Shops CRUD and bulk operations
3. Fixing identified schema issues (slug field verification)
4. Refactoring data access patterns where needed
5. Ensuring all changes follow existing code patterns and business logic rules

All work must be on a clean feature branch: **`feat/pb-refactor-clean-<YYYYMMDD>`** (use current date at branch creation time, e.g., `feat/pb-refactor-clean-20260310`).

## Phase 2: Migration Checklist

### PRIORITY 1 - People Migration (Target: Complete)

**Status Review:**
- Current: Read operations use PocketBase with Supabase fallback
- Current: CRUD operations still use Supabase
- Current: People pages exist but use old data patterns
- Issue: Slug field may not exist in PocketBase schema — **verify first**

**Tasks:**

#### 1.1 Verify Schema & Backfill (if needed)
```
Location: src/services/pocketbase/
Task:
  □ Check PocketBase collections > people schema for 'slug' field
  □ If slug field missing: Create migration or alter collection
  □ If slug field exists: Run validation script to ensure all 27 people records have slug values
  □ Commands available from previous agent: scripts/pb-backfill-slugs.ts, scripts/check-pb-slugs.ts
```

#### 1.2 Create PocketBase People Service
```
Location: src/services/pocketbase/people.service.ts (NEW FILE, ~600-800 lines)
Template: Reference src/services/pocketbase/account-details.service.ts for patterns
Functions needed:
  □ getPocketBasePeople() 
    - Fetch all people records with minimal data {id, name, phone, email, image_url}
    - Include executeWithFallback for network errors
  
  □ getPocketBasePersonDetails(id)
    - Use resolvePocketBaseRecord(id) for ID resolution
    - Return detailed person object with related debt, transactions
  
  □ createPocketBasePerson(input)
    - Validate input (name required)
    - Generate slug from Supabase person ID if exists
    - Handle image_url upload if provided
    - Return: {success, data: createdPerson, error?}
  
  □ updatePocketBasePerson(id, input)
    - Use resolver for ID lookup
    - Allow bulk field updates
    - Prevent name field removal
    - Return: {success, data: updatedPerson, error?}
  
  □ deletePocketBasePerson(id)
    - Check for linked transactions/debts
    - Archive instead of delete if has dependencies
    - Return: {success, archived: boolean, error?}
  
  □ resolvePocketBasePersonRecord(id)
    - Implement 3-tier strategy (see POCKETBASE_API_REFERENCE.md)
    - Used internally by all person functions
  
  □ Helper functions: mapPerson(record)
    - Return {id: record.slug || record.id, ...personFields}

Implementation notes:
  • All PocketBase calls MUST use executeWithFallback(pbCall, sbCall, name)
  • Error handling: isPocketBase400Or404 checks catch recoverable errors
  • Field mapping: Always use slug || id pattern for backward compatibility
  • Transactions aggregation: Use debt.service.ts for person debt calculation
  • Rate limiting: PocketBase default 5 req/sec per collection, batch queries if needed
```

#### 1.3 Update Server Actions
```
Location: src/actions/people-actions.ts (MODIFY EXISTING)
Current: Uses Supabase service functions directly
Changes:
  □ Import getPocketBasePeople, getPocketBasePersonDetails, etc. from new service
  □ Wrap all calls with executeWithFallback() for network resilience
  □ Update createPerson(rawInput):
    - Call createPocketBasePerson first, fallback to Supabase
    - Revalidate '/people' after creation
  □ Update updatePerson(id, input):
    - Call updatePocketBasePerson first, fallback to Supabase
    - Revalidate '/people' and '/people/[id]'
  □ Update deletePerson(id):
    - Call deletePocketBasePerson first, fallback to Supabase
    - Handle archive case (don't revalidate if archived)
  □ All functions return: {success: boolean, error?: string, data?: T}
```

#### 1.4 Update UI Pages
```
Locations: src/app/people/page.tsx and src/app/people/[id]/page.tsx
Current: Uses old data loading patterns
Changes:
  □ /people/page.tsx:
    - Change: const people = await getPocketBasePeople()
    - Pass data to client component for filters/search
    - Keep existing UI but update data source
  
  □ /people/[id]/page.tsx:
    - Add resolver: const person = await getPocketBasePersonDetails(params.id)
    - Handle 404 if person not found
    - Pass person data to detail component
```

#### 1.5 Test & Validate
```
Manual test cases:
  □ Navigate to /people, verify all people load correctly
  □ Click person detail, verify ID resolution works (both direct PB ID and slug)
  □ Create new person, verify stored in PocketBase with slug field
  □ Update person name, verify changes persist and ID resolution still works
  □ Delete person with no transactions, verify removed
  □ Try delete person with transactions, verify archived instead
  □ Check network resilience: Stop PocketBase, verify fallback to Supabase works
```

---

### PRIORITY 2 - Categories & Shops CRUD (Target: Complete)

**Status Review:**
- Current: Read operations use PocketBase with Supabase fallback
- Current: CRUD operations still use Supabase
- Current: UI components partially ready
- Issue: Slug field may not exist in PocketBase schema — **verify with people migration**
- Issue: Delete operations require target reassignment logic
- Issue: Need bulk archive/unarchive support

**Tasks:**

#### 2.1 Extend Account Details Service
```
Location: src/services/pocketbase/account-details.service.ts (ADD TO EXISTING)
Current functions: createPocketBaseCategory/Shop already exist
New functions needed:
  
  □ updatePocketBaseCategory(id, input)
    - Use resolvePocketBaseRecord(id) for ID lookup
    - Allow: name, color_code, description, archive status updates
    - Prevent category removal if transactions exist
    - Return: {success, data: updatedCategory, error?}
  
  □ deletePocketBaseCategory(id, targetCategoryId?)
    - Use resolvePocketBaseRecord(id) for ID lookup
    - Logic:
      * If transactions exist AND no targetCategoryId: return error asking for target
      * If targetCategoryId provided: reassign all transactions to target category first
      * Then mark category as archived or deleted
    - Return: {success, reassignedCount: number, error?}
  
  □ updatePocketBaseShop(id, input)
    - Similar to category but no transaction reassignment needed
    - Allow: name, image_url, description, archive status
    - Return: {success, data: updatedShop, error?}
  
  □ deletePocketBaseShop(id)
    - Use resolvePocketBaseRecord(id) for ID lookup
    - Check for linked transactions (auto-assign to default shop if exists)
    - Return: {success, reassignedCount?: number, error?}
  
  □ bulkUpdateCategoriesArchiveStatus(categoryIds[], archived: boolean)
    - Archive or unarchive multiple categories in batch
    - Use PocketBase parallel requests (Promise.all)
    - Return: {success, updatedCount: number, failedIds: string[], error?}
  
  □ bulkUpdateShopsArchiveStatus(shopIds[], archived: boolean)
    - Same pattern as categories
    - Return: {success, updatedCount: number, failedIds: string[], error?}

Implementation notes:
  • All calls use executeWithFallback() for resilience
  • Transaction reassignment: Use transaction.service.ts updateTransaction()
  • Archive pattern: Set archive_date and archived: true instead of delete
  • Default shop/category: Defined in constants (check .agent/schema/refund_constants.ts)
```

#### 2.2 Update Server Actions
```
Locations: 
  - src/actions/category-actions.ts (MODIFY)
  - src/actions/shop-actions.ts (MODIFY)

Changes for category-actions.ts:
  □ Import updatePocketBaseCategory, deletePocketBaseCategory from service
  □ Update updateCategory(id, input):
    - Call updatePocketBaseCategory first, fallback to Supabase
    - Revalidate '/categories', '/transactions'
  
  □ Update deleteCategory(id, targetId?):
    - Call deletePocketBaseCategory(id, targetId), fallback to Supabase
    - Handle reassignment response
    - Revalidate multiple paths
  
  □ Add bulkArchiveCategories(ids[], archived: boolean):
    - Call bulkUpdateCategoriesArchiveStatus()
    - Revalidate '/categories'
    - Return: {success, updatedCount, failedIds, error}

Changes for shop-actions.ts:
  □ Import updatePocketBaseShop, deletePocketBaseShop from service
  □ Similar update/delete/bulkArchive pattern
  □ Revalidate '/shops', '/transactions'
```

#### 2.3 Update UI Components
```
Locations: src/app/categories/page.tsx, src/app/shops/page.tsx
Current: Display-only, no CRUD UI
Changes:
  □ Categories page:
    - Add "Edit" button → opens dialog with updateCategory action
    - Add "Delete" button → shows warning + reassignment picker
    - Add "Archive" button → calls bulkArchiveCategories
    - Don't call getCategoriesWithSource (broken), use getCategories + getPocketBaseCategories instead
  
  □ Shops page:
    - Add "Edit" button → opens dialog with updateShop action
    - Add "Delete" button → shows confirmation
    - Add "Archive" button → calls bulkArchiveShops
    - Update to use getPocketBaseShops service instead of fallback pattern
```

#### 2.4 Test & Validate
```
Manual test cases:
  □ Navigate to /categories, verify all categories load correctly
  □ Edit category name, verify changes persist in PocketBase
  □ Try delete category with transactions, verify reassignment dialog
  □ Delete category with target selected, verify transactions reassigned
  □ Try delete category without transactions, verify deletion succeeds
  □ Select multiple categories, bulk archive, verify archived flag set
  □ Bulk unarchive, verify archived flag cleared
  □ Same tests for shops (except no reassignment logic)
  □ Verify slug field exists on all created categories/shops
```

---

### PRIORITY 3 - Schema Verification & Bug Fixes

**Status Review:**
- Issue: Slug field backfill reported success (27/29/31) but validation reads 0 — schema mismatch
- Issue: Categories/Shops UI pages reference getCategoriesWithSource that doesn't exist
- Issue: Batch deduplication logic may need adjustment for PocketBase queries

**Tasks:**

#### 3.1 Verify Slug Field Exists
```
Locations: PocketBase dashboard > collections
Steps:
  □ Navigate to https://api-db.reiwarden.io.vn/_/ (PocketBase console)
  □ Verify each collection schema:
    - accounts: has slug field (TEXT, no validation) ✓ Confirmed in Phase 1
    - people: has slug field? Create if missing
    - shops: has slug field? Create if missing
    - categories: has slug field? Create if missing
  
  □ For any missing fields:
    - Create migration or use PocketBase web UI to add field
    - Field type: TEXT
    - Field properties: Allow empty (un-checked), Allow multiple (unchecked)
    - Default: empty string or null
  
  □ Run validation scripts
    - scripts/check-pb-slugs.ts for each collection
    - Should show count > 0 if schema correct
```

#### 3.2 Fix API Debug Route
```
Location: src/app/api/debug/data-source/route.ts
Current: Fixed in Phase 1 but verify
Expected:
  □ Function calls use getCategories/getShops (not broken functions)
  □ Returns source metadata showing which DB provided each collection
  □ Test: GET /api/debug/data-source should return JSON with data sources
```

#### 3.3 Verify Test Coverage
```
Locations: All new service files should include test patterns
Requirements:
  □ Mock executeWithFallback for unit tests
  □ Test ID resolution with both direct IDs and slugs
  □ Test error handling (400/404 and network errors)
  □ Test fallback behavior when PocketBase fails
  □ Don't commit tests in Phase 2 (optional, can be deferred to Phase 3)
```

---

### PRIORITY 4 - Batch Import System (Phase 2.5 - If Time)

**Status Review:**
- Current: Uses Supabase entirely
- Collections: batch_masters, batch_items
- Integrations: MBB, VIB parsers in src/integrations/google-sheets/
- Issue: Deduplication on `transaction_date + amount + details` needs PocketBase query

**Tasks (DEFER to Phase 3 if time constraints):**

```
If proceeding:
  □ Create src/services/pocketbase/batch.service.ts (~600 lines)
  □ Implement getBatchMasters(), createBatchItem(), processBatchImport()
  □ Update src/actions/batch-actions.ts with executeWithFallback()
  □ Update src/app/batch/** pages to use new service
  □ Test batch import deduplication with PocketBase queries
  □ Verify Google Sheets sync still works after migration
```

---

## Code Quality & Deployment

### Pre-Commit Checklist
Before pushing each commit:
```
□ Run: pnpm lint
  - Must pass with no errors
  - Auto-fix common issues: pnpm lint --fix
  - Check: No unused imports, trailing commas, proper formatting

□ Run: pnpm build
  - Must succeed without TypeScript errors
  - Verify: 52+ routes compiled
  - Check build time < 15s (indicates clean incremental build)

□ Run: git status
  - Verify: No .next or .env.local in staged changes
  - Verify: Only source files staged (no build artifacts)

□ Google Sheets sync (if updating people/batch integrations)
  - Command: pnpm sheet:people
  - Command: pnpm sheet:batch
  - Required before committing sheet-related changes

□ Verify changes
  - Run: git diff --cached | head -200
  - Ensure: No unexpected file changes
  - Check: All services use executeWithFallback pattern
```

### Commit Message Format
Follow conventional commits for clarity:
```
feat(pocketbase): Complete people migration with CRUD operations
  - Create getPocketBasePeople service
  - Add people server actions with fallback
  - Update /people pages with ID resolver
  - Verify slug field exists in schema
  
fix(pocketbase): Fix schema slug field for shops collection
  
refactor(people): Align people service pattern with accounts
```

### Branch Naming Convention
**Required format: `feat/pb-refactor-clean-<YYYYMMDD>`**

Examples:
- `feat/pb-refactor-clean-20260310` (started March 10, 2026)
- `feat/pb-refactor-clean-20260315` (started March 15, 2026)

Use the date when you CREATE the branch (at start of work), not current date.

### Deployment Notes
- Vercel builds automatically on push to feat/* branches
- Check Vercel dashboard after each push: https://vercel.com/
- If build fails: Review error logs, fix locally, re-commit, re-push
- All environment variables must match: POCKETBASE_URL, POCKETBASE_DB_EMAIL, POCKETBASE_DB_PASSWORD, NEXT_PUBLIC supabase keys

---

## Common Patterns to Follow

### Error Handling Template
```typescript
// In service layer
export async function getPocketBaseData(id: string) {
  try {
    // Try PocketBase first
    const pbResult = await pocketbaseList('collection', { filter: ... })
    return pbResult
  } catch (error) {
    if (isPocketBase400Or404(error)) {
      // Fallback to Supabase
      const sbResult = await supabaseSelect('table', { filter: ... })
      return sbResult
    }
    throw error // Unknown error, re-throw
  }
}

// Or use wrapper
export async function getDataWithFallback(id: string) {
  return executeWithFallback(
    () => getPocketBaseData(id),
    () => getSupabaseData(id),
    'getDataWithFallback'
  )
}
```

### ID Resolution Template
```typescript
// In service layer
async function resolvePocketBaseRecord(id: string) {
  // Step 1: Try direct ID
  let record = await pocketbaseGetById('collection', id)
  if (record) return record
  
  // Step 2: Try hashed UUID conversion
  const hashedId = toPocketBaseId(id)
  record = await pocketbaseGetById('collection', hashedId)
  if (record) return record
  
  // Step 3: Try slug filter (for Supabase UUID)
  const records = await pocketbaseList('collection', { 
    filter: `slug="${id}"`,
    limit: 1
  })
  if (records.length > 0) return records[0]
  
  return null // ID not found
}
```

### Server Action Template
```typescript
export async function myMutation(input: InputType): Promise<ActionResult<OutputType>> {
  try {
    // Use PocketBase service
    const result = await myService.doOperation(input)
    
    // Revalidate affected paths
    revalidatePath('/affected-page')
    revalidatePath('/other-page')
    
    return { success: true, data: result }
  } catch (err) {
    console.error('myMutation error:', err)
    return { success: false, error: err.message }
  }
}
```

---

## Validation & Testing

### Manual Testing Scenarios
After each function implementation:

1. **Happy Path:** Normal operation with valid data
   - Create person → verify stored in PocketBase → verify appears in list
   - Edit category → verify changes persist → verify ID resolution still works

2. **Edge Cases:** Boundary conditions
   - Delete record with related data → verify proper handling
   - Update with missing required fields → verify error returned
   - Create duplicate record → verify deduplication or error response

3. **Network Resilience:** Fallback behavior
   - Stop PocketBase (or simulate network error)
   - Perform operation → should fallback to Supabase
   - Verify: Function completes (doesn't fail)
   - Verify: User sees appropriate response (success or error message)

4. **ID Resolution:** Both direct and slug-based lookups
   - Test with direct PocketBase ID → should work
   - Test with Supabase UUID (stored in slug field) → should work
   - Test with invalid ID → should return null or 404

---

## Handover Artifacts Available

Use these resources during implementation:

1. **POCKETBASE_MIGRATION_PROGRESS.md** (593 lines)
   - Collection schemas and field definitions
   - Service layer patterns for reference
   - Next steps and priority ordering

2. **POCKETBASE_API_REFERENCE.md** (637 lines)
   - Complete API helper function documentation
   - ID resolution patterns with examples
   - Error handling and fallback mechanisms
   - Performance optimization techniques
   - Testing examples and common use cases

3. **Account Details Service** (src/services/pocketbase/account-details.service.ts)
   - 1055-line reference implementation
   - Use as template for people/categories/shops services
   - Shows ID resolver, field mapping, all service patterns

4. **Previous Commits**
   - Branch: feat/pb-refactor-clean-20260308
   - Review commits d2f02ef (Phase 1) and cbb4bd7 + 767a08f (cleanup)
   - Study patterns and implementation approaches

---

## Success Criteria for Phase 2 Completion

### Code Quality
- ✅ All new services follow account-details.service.ts pattern
- ✅ All PocketBase calls use executeWithFallback()
- ✅ All ID lookups use resolvePocketBase*Record() pattern
- ✅ All field mappings return slug || id for backward compatibility
- ✅ pnpm lint passes without errors
- ✅ pnpm build succeeds with no TypeScript errors

### Functionality
- ✅ People: Full CRUD (create, read, update, delete, list)
- ✅ Categories: Full CRUD + bulk archive/unarchive
- ✅ Shops: Full CRUD + bulk archive/unarchive
- ✅ Category delete: Reassignment logic with UI prompt
- ✅ ID resolution: Works with both direct PB IDs and Supabase UUIDs
- ✅ Fallback: Network errors trigger Supabase fallback, operation completes

### Testing
- ✅ Manual test all CRUD operations for each collection
- ✅ Verify ID resolution with both ID types
- ✅ Test fallback behavior (stop PocketBase, verify Supabase handles request)
- ✅ Test edge cases: delete with relations, update with missing fields
- ✅ Verify Vercel build passes after each push

### Documentation
- ✅ Commit messages follow conventional format
- ✅ Code comments explain non-obvious ID resolution or error handling
- ✅ Update handover notes if discovering new issues or schema changes
- ✅ Record any blockers or pending decisions for next phase

---

## Final Notes

- **You are building on solid Phase 1 foundation.** Account migration is complete and working. Use it as your reference for consistency.
- **Schema verification is critical.** Don't start coding people/categories/shops CRUD until slug field existence is confirmed.
- **Network resilience matters.** Every service function must handle PocketBase unavailability elegantly.
- **User experience first.** Always consider what happens when network fails or data is invalid.
- **Commit frequently.** Small, focused commits with clear messages help next agent understand your work.

**When complete, provide a final handover summary similar to POCKETBASE_MIGRATION_PROGRESS.md showing Phase 2 completion status, any schema changes made, and remaining work for Phase 3 (Batch, Installments).**
