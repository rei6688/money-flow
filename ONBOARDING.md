# 👨‍💻 Developer Onboarding - Transaction System V2

**Read This First:** [TRANSACTION_SYSTEM_DOCS.md](./TRANSACTION_SYSTEM_DOCS.md)

---

## 🎯 Your First 30 Minutes

### ⚠️ Current Continuation Context (March 11, 2026)
- Branch handover (current work): [.agent/context/fix-people-account-ui-cleanup.md](./.agent/context/fix-people-account-ui-cleanup.md)
- Read latest handover first: [docs/handovers/PHASE_PEOPLE_SHEET_HANDOVER_2026-03-11.md](./docs/handovers/PHASE_PEOPLE_SHEET_HANDOVER_2026-03-11.md)
- Focus area moved from transaction slide to People Details migration gaps:
  - Sheet Config blank in some entry paths
  - Legacy UUID `/people/:id` links still emitted in some places
  - Cycle picker account/debt mode conflicts
- Do not start coding until you can reproduce all 3 issues in handover checklist.

### Step 1: Understand V2 Architecture (5 min)
```
TransactionSlideV2 = Right-side slide panel (replaces old center modal)

┌─────────────────────────────────────────┐
│  Page: UnifiedTransactionsPage.tsx       │
│  - Manages slideMode state               │
│  - Handles add/edit/duplicate logic      │
│  - Shows loading indicator               │
└─────────────────────────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ TransactionSlideV2   │
         │ - Open/close logic   │
         │ - Form rendering     │
         │ - Validation         │
         └──────────────────────┘
                    ↓
         ┌──────────────────────┐
         │ Single/Bulk Form     │
         │ - React Hook Form    │
         │ - Zod validation     │
         │ - Field sections     │
         └──────────────────────┘
```

### Step 2: Test Add/Edit/Duplicate (10 min)
1. Go to `/transactions`
2. Click **+ Add** button (top-right) → Slide opens, form empty
3. Click **Edit** (pencil icon) → Slide opens, form populated
4. Click **Duplicate** (files icon) → Slide opens, form populated, date = today
5. Submit form → Loading indicator shows → Success toast

### Step 3: Check Console Logs (10 min)
Open DevTools Console → Submit form → See logs:
```
✅ onSingleSubmit called
📋 Form data: { ... }
🎯 Operation: "add" | "edit" | "duplicate"
🔀 Will call: "createTransaction()" or "updateTransaction()"
...
```

### Step 4: Read Key Files (5 min)
- [UnifiedTransactionsPage.tsx](./src/components/transactions/UnifiedTransactionsPage.tsx#L558) - initialSlideData
- [transaction-slide-v2.tsx](./src/components/transaction/slide-v2/transaction-slide-v2.tsx#L215) - onSingleSubmit
- [MemberDetailView.tsx](./src/components/people/v2/MemberDetailView.tsx) - People detail logic
- [types.ts](./src/components/transaction/slide-v2/types.ts#L11) - Form schema

---

## 📚 Learning Path

### 1️⃣ **Beginner** (1-2 hours)
- [ ] Read TRANSACTION_SYSTEM_DOCS.md (all sections)
- [ ] Read DUPLICATE_DEBUG_GUIDE.md
- [ ] Test add/edit/duplicate manually
- [ ] Check console logs for understanding

### 2️⃣ **Intermediate** (2-4 hours)
- [ ] Study UnifiedTransactionsPage.tsx (state management)
- [ ] Study TransactionSlideV2.tsx (component structure)
- [ ] Study single-form validation
- [ ] Run `pnpm build` → verify no errors
- [ ] Test with test ID: `aae9c0be-e0e1-456f-b06e-87500607afe8`

### 3️⃣ **Advanced** (4+ hours)
- [ ] Understand server actions (createTransaction, updateTransaction)
- [ ] Study cashback logic integration
- [ ] Understand RLS database permissions
- [ ] Study bulk mode implementation
- [ ] Study split bill integration

---

## 🚀 Common Tasks

### Add New Form Field
1. **Add to schema** in `types.ts`:
   ```tsx
   export const singleTransactionSchema = z.object({
       myNewField: z.string().optional(),
   })
   ```

2. **Add to form** in `single-form.tsx`:
   ```tsx
   <Controller
     name="myNewField"
     render={({ field }) => <input {...field} />}
   />
   ```

3. **Map to payload** in `transaction-slide-v2.tsx`:
   ```tsx
   const payload = {
     my_new_field: data.myNewField,
   }
   ```

### Debug Form Validation Failure
```javascript
// In DevTools Console, run:
singleForm.getValues()              // Get all current values
singleForm.formState.errors         // See which fields have errors
singleForm.formState.isValid        // Is form valid?
```

### Debug Duplicate Not Creating
1. Open DevTools Console
2. Click duplicate button
3. Check logs:
   - `editingId: undefined` ? ✅
   - `Will call: createTransaction()` ? ✅
   - `Create result - newId: xxx` ? ✅
4. Check Network tab:
   - POST to server action? ✅
   - Response status 200? ✅

### Fix Modal Dialog Appearing
1. Search for `AddTransactionDialog` usage
2. Replace with `TransactionSlideV2`
3. Remove Modal/Dialog wrapper code

---

## 🔍 File Locations Quick Reference

| Task | File |
|------|------|
| **Add operation logic** | `UnifiedTransactionsPage.tsx` (line ~462) |
| **Form rendering** | `single-form.tsx` or `bulk-form.tsx` |
| **Form validation** | `types.ts` (schema definition) |
| **State management** | `UnifiedTransactionsPage.tsx` (line ~60) |
| **Loading indicator** | `UnifiedTransactionsPage.tsx` (line ~630) |
| **Console logs** | `transaction-slide-v2.tsx` (line ~195) |
| **Debug duplicate** | `DUPLICATE_DEBUG_GUIDE.md` |

---

## 🐛 Troubleshooting

### Q: Form won't submit
**A:** Check console logs for validation errors:
```javascript
singleForm.formState.errors
// Example: { source_account_id: { message: "Source account is required" } }
```

### Q: Loading indicator doesn't show
**A:** Verify in UnifiedTransactionsPage:
```tsx
const [isGlobalLoading, setIsGlobalLoading] = useState(false)
// Must be passed to TransactionSlideV2 as onSubmissionStart handler
```

### Q: Duplicate creates edit instead of new transaction
**A:** Check `editingId` logic:
```tsx
// WRONG - will edit instead of duplicate
editingId={slideMode === 'duplicate' ? txn.id : undefined}

// CORRECT
editingId={slideMode === 'edit' ? txn.id : undefined}
```

### Q: Old modal dialog appears
**A:** Search for these imports and remove:
```tsx
import { AddTransactionDialog } from '@/components/moneyflow/add-transaction-dialog'
import { TransactionForm } from '@/components/moneyflow/transaction-form'
```

---

## ✅ Pre-Commit Checklist

Before pushing changes:
```bash
# 1. Build passes
pnpm build
# ✅ "Compiled successfully"

# 2. No lint errors  
pnpm lint
# ✅ All files pass

# 3. No TypeScript errors
npx tsc --noEmit
# ✅ No errors

# 4. Test operations
# Manually: add, edit, duplicate
# Check: loading indicator, console logs, success toast

# 5. Test with ID: aae9c0be-e0e1-456f-b06e-87500607afe8
# Should be able to duplicate without errors
```

---

## 📞 Getting Help

**If stuck:**
1. Check TRANSACTION_SYSTEM_DOCS.md
2. Check DUPLICATE_DEBUG_GUIDE.md
3. Open DevTools Console
4. Look for console.error messages
5. Check Network tab for server errors
6. See HANDOVER_12-2.md for known issues

**For deeper issues:**
- Open browser DevTools
- Reproduce the issue
- Screenshot console logs
- Check Network tab responses
- Review error stack trace

---

## 🎓 Key Concepts

### State Management Pattern
```tsx
const [slideMode, setSlideMode] = useState('add')      // 'add' | 'edit' | 'duplicate'
const [selectedTxn, setSelectedTxn] = useState(null)   // Transaction being edited
const [isSlideOpen, setIsSlideOpen] = useState(false)  // Slide panel visibility

// Handlers set all three when opening slide
const handleEdit = (txn) => {
  setSlideMode('edit')
  setSelectedTxn(txn)
  setIsSlideOpen(true)
}
```

### Form Population Pattern
```tsx
// 1. Compute initialData from selectedTxn
const initialSlideData = useMemo(() => {
  if (!selectedTxn) return undefined
  return {
    type: selectedTxn.type,
    amount: selectedTxn.amount,
    // ... etc
  }
}, [selectedTxn])

// 2. Compute defaultValues from initialData
const defaultFormValues = useMemo(() => {
  if (initialData) {
    return { ...initialData }  // Use data
  }
  return { /* empty defaults */ }
}, [initialData])

// 3. Form resets on open
useEffect(() => {
  if (open) {
    singleForm.reset(defaultFormValues)
  }
}, [open, defaultFormValues])
```

### Operation Routing Pattern
```tsx
// In handler
if (editingId) {
  // UPDATE - only for edit mode
  success = await updateTransaction(editingId, payload)
} else {
  // CREATE - for add and duplicate
  const newId = await createTransaction(payload)
}
```

---

## 🚫 Anti-Patterns

### ❌ Don't Do This:
```tsx
// Creating modal directly
<Dialog open={isAddOpen}>
  <DialogContent>
    <TransactionForm />
  </DialogContent>
</Dialog>

// Using deprecated components
import { AddTransactionDialog } from '...'
import { TransactionForm } from '...'

// Manual form state management
const [amount, setAmount] = useState('')
const [category, setCategory] = useState('')
// Use React Hook Form instead!

// Checking operationMode to decide updateVsCreate
if (operationMode === 'edit') {
  await updateTransaction(...)
}
// Check editingId instead!
```

### ✅ Do This Instead:
```tsx
// Use TransactionSlideV2
<TransactionSlideV2
  open={isSlideOpen}
  operationMode={slideMode}
  editingId={editingId}
  // ...
/>

// Use React Hook Form
const form = useForm({
  resolver: zodResolver(schema),
  defaultValues: initialData
})

// Check editingId
if (editingId) {
  await updateTransaction(editingId, ...)
} else {
  await createTransaction(...)
}
```

---

**Next:** Read [HANDOVER_12-2.md](../.agent/HANDOVER_12-2.md) for known issues  
**Questions?** Check console logs first - they're very detailed! 🚀
