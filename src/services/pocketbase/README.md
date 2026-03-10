# PocketBase Services

This directory contains PocketBase-specific service implementations following a systematic 6-phase refactoring plan.

## Directory Structure

```
src/services/pocketbase/
├── category.service.ts          # Phase 1: Foundation tables (no deps)
├── shop.service.ts              # Phase 1: Foundation tables (no deps)
├── account.service.ts           # Phase 2: Foundational accounts (FK source)
├── people.service.ts            # Phase 3: People & relationships
├── transaction.service.ts       # Phase 4: Transaction core (complex)
├── transaction-fallback.ts      # Phase 4: Multi-variant query fallback
├── transaction-lines.service.ts # Phase 4c: Transaction lines & splits
├── cashback.service.ts          # Phase 5: Cashback & analytics
├── batch.service.ts             # Phase 6: Bulk operations
└── split-bill.service.ts        # Phase 6: Split bill operations
```

## Phase Status

- **Phase 0**: ✅ Done - Setup infrastructure (fallback helpers, ID mappers)
- **Phase 1**: ⏳ Pending - Category, Shop, People (read-only)
- **Phase 2**: ⏳ Pending - Accounts with FK expansion
- **Phase 3**: ⏳ Pending - People relationships
- **Phase 4**: ⏳ Pending - Transactions (read + write)
  - **4a**: Read-only with fallback
  - **4b**: Dual-write (PB + SB)
  - **4c**: Refund chains & installments
- **Phase 5**: ⏳ Pending - Cashback & analytics
- **Phase 6**: ⏳ Pending - Batch & split bills

## Key Patterns

### 1. Fallback Pattern (ALL reads must use this)
```typescript
// src/services/category.service.ts
import { executeWithFallback } from '@/lib/pocketbase/fallback-helpers'

export async function getCategories() {
  return executeWithFallback(
    () => getPocketBaseCategories(),
    () => getSupabaseCategories(),
    'categories.select'
  )
}
```

### 2. Multi-Attempt Pattern (For schema drift handling)
```typescript
// For transaction reads that may face PB 400 errors
import { executeWithAttempts } from '@/lib/pocketbase/fallback-helpers'

const attempts = [
  () => pbQuery({ sort: '-date', expand: [...] }),
  () => pbQuery({ sort: '-date', expand: ['account_id'] }),
  () => pbQuery({ sort: '-date' }), // No expand
]

const result = await executeWithAttempts(attempts, 'load:transactions', sbQuery)
```

### 3. Dual-Write Pattern (For mutations)
```typescript
// src/services/transaction.service.ts
export async function createTransaction(input) {
  // Primary: Write to Supabase (generates UUID)
  const sbResult = await supabase.from('transactions').insert([input]).select().single()
  
  // Secondary: Async write to PocketBase (fire-and-forget)
  createPocketBaseTransaction(sbResult.id, input)
    .catch(err => console.error('[source:PB] Secondary write failed:', err))
  
  return sbResult
}
```

### 4. Source Tracking (For debugging)
```typescript
import { logSource } from '@/lib/pocketbase/fallback-helpers'

logSource('PB', 'categories.select')
logSource('SB', 'categories.fallback', { count: 50 })
```

## Logging Convention

All PocketBase service functions must emit structured logs:

```
[source:PB] action - Starting PB operation
[source:PB] action - success - Operation completed
[source:SB] action - Falling back to Supabase (reason)
[source:SB] action - success (fallback) - Fallback completed
```

Example output:
```
[source:PB] categories.select
[source:PB] categories.select - success
[source:SB] accounts.load - Falling back to Supabase (400 Bad Request)
[source:SB] accounts.load - success (fallback)
```

## How to Implement a Service

### Step 1: Copy the stub function
All Phase X services have stubs with `throw new Error('..not yet implemented')`.

### Step 2: Implement the PocketBase helper
```typescript
// src/services/pocketbase/category.service.ts
export async function getPocketBaseCategories() {
  const records = await pocketbaseList('categories', {
    sort: '-created',
    expand: ['...'] // If needed
  })
  
  return records.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type,
    // ... map all fields from PB record
  }))
}
```

### Step 3: Update the parent service with fallback
```typescript
// src/services/category.service.ts
import { executeWithFallback } from '@/lib/pocketbase/fallback-helpers'
import { getPocketBaseCategories } from './pocketbase/category.service'

export async function getCategories() {
  return executeWithFallback(
    () => getPocketBaseCategories(),
    () => {
      console.log('[source:SB] categories.select')
      const supabase = createClient()
      return supabase.from('categories').select('*')
    },
    'categories.select'
  )
}
```

### Step 4: Test thoroughly
- ✅ Verify returned data structure matches expected type
- ✅ Test with PocketBase unavailable (should fallback)
- ✅ Check console logs show correct sources
- ✅ Run TypeScript check: `tsc --noEmit`
- ✅ Test in UI components that use this service

## Database Schema References

See `docs/collections/` for:
- `SCHEMA.md` - PocketBase collection field definitions
- `FK_DEPENDENCIES.md` - Foreign key relationships
- `MIGRATION_NOTES.md` - Known schema differences from Supabase

## Common Issues & Solutions

### Issue: "Property X does not exist on type 'SelectQueryError'"
**Solution**: Use explicit type casting in Supabase fallback
```typescript
const { data: raw } = await supabase.from('items').select('*')
const items = (raw ?? []) as Array<Record<string, any>>
```

### Issue: "400 Bad Request" from PocketBase
**Solution**: Use multi-attempt fallback, remove problematic sort/expand fields
```typescript
const attempts = [
  { sort: '-date', expand: [...] },    // Full
  { sort: '-date', expand: [] },       // No expand
  { sort: '-date' },                   // Minimal
]
```

### Issue: Type mismatch between PB and Supabase records
**Solution**: Create explicit mapper functions
```typescript
function mapPBAccount(pbRecord: any): Account {
  return {
    id: pbRecord.id,
    name: pbRecord.name,
    // ... careful mapping of all fields
  }
}
```

## Next Steps

1. **Get PB schema** from admin (export collections as JSON)
2. **Document** in `docs/collections/SCHEMA.md`
3. **Start Phase 1** - Implement category, shop, people read services
4. **Add fallback** to category.service.ts, shop.service.ts, people.service.ts
5. **Test thoroughly** before moving to Phase 2

## References

- Full plan: `docs/PB_MIGRATION_PLAN.md`
- Fallback helpers: `src/lib/pocketbase/fallback-helpers.ts`
- ID mapping: `src/lib/pocketbase/id-mapper.ts`
- Supabase baseline: `database/SCHEMA.md`
