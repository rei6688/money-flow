# Phase 1: Categories & Shops Service Refactoring

**Status**: Implementation phase  
**Date**: March 8, 2026  
**Collections**: categories, shops (foundation tables, no FK dependencies)

---

## Schema Comparison: Supabase → PocketBase

### Categories

**Supabase Schema:**
```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  color TEXT,
  parent_id UUID REFERENCES categories(id),
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**PocketBase Expected Structure:**
- Collection Name: `categories` (or similar, e.g., `pvl_cat_001`)
- Fields:
  - `id` (String, auto-generated) - PK
  - `name` (String) - Required, unique
  - `icon` (String, optional) - Icon identifier
  - `color` (String, optional) - Hex color code
  - `parent_id` (String/Relation, optional) - Self-reference
  - `is_archived` (Boolean) - Defaults to false
  - `created` (DateTime) - Auto timestamp
- Indexes: Likely on `name`, possibly on `is_archived`
- Expand: `parent_id` (to resolve parent category)

### Shops

**Supabase Schema:**
```sql
CREATE TABLE shops (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  image_url TEXT,
  category TEXT,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**PocketBase Expected Structure:**
- Collection Name: `shops` (or similar)
- Fields:
  - `id` (String, auto-generated) - PK
  - `name` (String) - Required, unique
  - `image_url` (String, optional) - Merchant logo/image
  - `category` (String, optional) - Shop category
  - `is_archived` (Boolean) - Defaults to false
  - `created` (DateTime) - Auto timestamp
- No FK relationships (can update independently)

---

## Implementation Plan

### Phase 1a: Create PB Category Service

**File**: `src/services/pocketbase/category.service.ts`

Implement:
- `getPocketBaseCategories()` - Fetch all non-archived with parent expansion
- `getPocketBaseCategoryById(id)` - Single lookup
- `createPocketBaseCategory(data)` - Create with metadata tracking
- `updatePocketBaseCategory(id, data)` - Update fields
- `deletePocketBaseCategory(id)` - Soft delete (set is_archived)

**Key Mapping:**
- Supabase: `created_at` → PocketBase: `created`
- Supabase: `parent_id` FK → PocketBase: `expand=parent_id`
- All fields are 1:1 mapped

### Phase 1b: Create PB Shop Service

**File**: `src/services/pocketbase/shop.service.ts`

Similar structure to categories.

### Phase 1c: Update Parent Services with Fallback

**Files**:
- `src/services/category.service.ts`
- `src/services/shop.service.ts`

Add PB-first, SB-fallback pattern:
```typescript
import { executeWithFallback } from '@/lib/pocketbase/fallback-helpers'
import { getPocketBaseCategories } from './pocketbase/category.service'

export async function getCategories() {
  return executeWithFallback(
    () => getPocketBaseCategories(),
    () => getSupabaseCategories(),
    'categories.list'
  )
}
```

---

## Supabase Helper Functions (Keep & Reference)

These remain for fallback:

```typescript
// src/services/category.service.ts (fallback)
async function getSupabaseCategories() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_archived', false)
    .order('name')

  if (error) throw error
  return data || []
}

// src/services/shop.service.ts (fallback)
async function getSupabaseShops() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('is_archived', false)
    .order('name')

  if (error) throw error
  return data || []
}
```

---

## Testing Strategy

### API Level Tests

**Categories Endpoint:**
```bash
# Test 1: List all categories
curl "https://api-db.reiwarden.io.vn/api/collections/categories/records?perPage=100"

# Test 2: List with filter (archived false)
curl "https://api-db.reiwarden.io.vn/api/collections/categories/records?filter=is_archived=false&perPage=100"

# Test 3: Single category
curl "https://api-db.reiwarden.io.vn/api/collections/categories/records/{id}"

# Test 4: Create category (requires auth)
curl -X POST "https://api-db.reiwarden.io.vn/api/collections/categories/records" \
  -H "Content-Type: application/json" \
  -d '{"name","New Category","icon":"...","color":"...","is_archived":false}'
```

### Service Level Tests

**getCategories():**
- Should return array of categories
- Should have `id`, `name`, `icon`, `color`, `is_archived`, `parent_id` fields
- Should exclude archived categories
- Should use PB first (check [source:PB] logs)
- Should fallback to SB if PB fails (check [source:SB] logs)

### UI Level Tests (After implementation)

**Component: CategorySelect / CategoryForm**
```
1. Open form/selector
2. Verify categories dropdown loads
3. Check that categories appear correctly
4. Test filter (archived/non-archived)
5. Test create new category
6. Verify fallback works (simulate PB down)
```

**Pages:**
- `/transactions` → Category dropdown should work
- `/accounts/[id]` → If shows category in header
- `/categories` → If dedicated category mangement page exists

---

## Execution Checklist

### Before Starting Code
- [ ] Verify PB API accessible: `https://api-db.reiwarden.io.vn/_/`
- [ ] Confirm collections exist: categories, shops
- [ ] Check field names match assumptions
- [ ] Note any differences (e.g., `pvl_cat_001` vs `categories`)

### Code Implementation
- [ ] Implement `getPocketBaseCategories()` in category.service.ts
- [ ] Implement `getPocketBaseShops()` in shop.service.ts
- [ ] Add fallback pattern to parent services
- [ ] Test API directly (curl commands)
- [ ] Type checking: `tsc --noEmit` (should pass)
- [ ] Console logs work: `[source:PB]` and `[source:SB]`

### Manual Testing
- [ ] Create `.env.test` with PB credentials (optional)
- [ ] Run service functions standalone
- [ ] Check fallback with mock error injection
- [ ] Verify type safety (no `any` types)

### UI Verification
- [ ] Load at least one page that uses categories/shops
- [ ] Check Network tab for API calls (see [source:PB] logs)
- [ ] Verify UI renders correctly
- [ ] Test error scenarios (PB down)

### Documentation
- [ ] Update git commit with what was implemented
- [ ] Note any schema differences found
- [ ] Record collection IDs if different from assumed names

---

## Reporting Template (After Phase 1 Complete)

```markdown
## Phase 1 Completion Report

### What Was Implemented
- [ ] getPocketBaseCategories()
- [ ] getPocketBaseShops()
- [ ] Fallback pattern in category.service.ts
- [ ] Fallback pattern in shop.service.ts

### API Tests Results
- [ ] Categories endpoint: ✅/❌
- [ ] Shops endpoint: ✅/❌
- [ ] Fallback tested: ✅/❌

### UI Verification
- [ ] Categories load in [page 1]: ✅/❌
- [ ] Categories load in [page 2]: ✅/❌
- [ ] Shops load in [page 3]: ✅/❌

### Problems Encountered
- [List any blockers, schema differences, unexpected issues]

### Next Phase Readiness
- [ ] Zero TypeScript errors
- [ ] Fallback pattern proven to work
- [ ] Ready to move to Phase 2 (Accounts)
```

---

## Schema Differences to Watch For

1. **Collection IDs**: May not be `categories` / `shops`
   - Check admin panel URL provided: `pvl_cat_001` pattern?
   - Update service calls with correct collection ID

2. **Field Names**:
   - `created_at` → `created` (PB default)
   - `parent_id` vs `category_parent_id`?
   - Any JSON fields for metadata?

3. **Expansion Syntax**:
   - PB: `expand=parent_id,created_by` (comma-separated)
   - Supabase: `LEFT JOIN categories parent...`

4. **Filter Syntax**:
   - PB: `filter=is_archived=false && name~"search"`
   - Supabase: `WHERE is_archived = false AND name ILIKE '%search%'`

5. **Constraints**:
   - Is `name` truly unique in PB?
   - Can `parent_id` be null (self-referencing)?

---

## Success Criteria for Phase 1

✅ **Minimum Viable**:
- Both services implemented
- At least one page loads category/shop data correctly
- Zero TypeScript errors
- Fallback pattern validates (logs show PB then SB)

✅ **Full Success**:
- All pages that use categories/shops work
- Fallback tested with PB unavailable
- Create/update/delete tested
- Schema differences documented
- Git commit is clean and descriptive

---

## Next Phase Dependency

Phase 2 (Accounts) depends on:
- ✅ Category service working (used in getAccountCategories)
- ✅ Shop service working (used in transaction queries)
- ✅ Fallback pattern proven stable

Once Phase 1 is complete and verified, proceed to Phase 2.
