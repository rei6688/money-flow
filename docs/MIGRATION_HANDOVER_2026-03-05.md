# PocketBase Migration Handover (2026-03-05)

## 1) Mục tiêu và phạm vi
- Hợp nhất toàn bộ work-in-progress về PocketBase migration + Google Sheets sync vào **1 branch duy nhất**: `feat/pocketbase-migration`.
- Tách và xử lý bug sheet sync riêng (đã merge ngược lại branch migrate).
- Ưu tiên ổn định runtime cho luồng:
  - Accounts details / Cashback performance (PocketBase service layer)
  - People sheet sync (`#nosync`, UI refresh, sheet formatting)

---

## 2) Quá trình đã thực hiện

### 2.1 Cashback / Accounts migration (PocketBase)
- Tạo service layer PocketBase:
  - `src/services/pocketbase/server.ts`
  - `src/services/pocketbase/account-details.service.ts`
  - `src/services/pocketbase/cashback-performance.service.ts`
- Rewire các điểm chính sang PocketBase:
  - `src/app/accounts/[id]/page.tsx`
  - `src/app/cashback/page.tsx`
  - `src/actions/cashback.actions.ts`
  - `src/app/api/cashback/stats/route.ts`
- Dọn trace Supabase ở account detail client:
  - `src/components/accounts/v2/AccountDetailViewV2.tsx` (bỏ realtime channel, dùng polling nhẹ)

### 2.2 Migration data model accounts (split cashback fields)
- Cập nhật mapper trong `scripts/pocketbase/migrate.mjs` để tách từ `cashback_config` sang cột riêng:
  - `cb_type`, `cb_base_rate`, `cb_max_budget`, `cb_is_unlimited`, `cb_rules_json`, `cb_min_spend`, `cb_cycle_type`
- Re-migrate phase accounts đã chạy thành công:
  - xóa + tạo lại 93 records accounts.

### 2.3 Google Sheets sync fixes (đã merge vào branch migrate)
- Server-side filter thống nhất `#nosync/#deprecated`:
  - `src/services/sheet.service.ts`
  - Fix root cause: `syncAllTransactions` trước đó chưa filter.
- UI refresh sau sync:
  - `src/components/people/v2/people-directory-v2.tsx`
  - `src/components/people/sheet-sync-controls.tsx`
- Apps Script people-sync:
  - `integrations/google-sheets/people-sync/Code.js`
  - Thêm guard `shouldExcludeFromSheet(...)`
  - Chuyển conditional format cho `Type=Out/In` chỉ còn cột **B** (không tô full A:J/K)
  - Bump script header/version note lên `7.9`.

---

## 3) Trạng thái hiện tại (Progress)

### Completed
- [x] Hợp nhất sheet-sync work vào migration branch.
- [x] Lọc `#nosync` nhất quán cho single/cycle/all sync.
- [x] Fix highlight đỏ chỉ cột Type (B) trên people sheet.
- [x] Cập nhật docs handover migration.

### In Progress / Partial
- [~] PocketBase migration chưa hoàn tất toàn bộ hệ thống (nhiều service/action khác vẫn dùng Supabase).
- [~] Smoke test authenticated E2E trên app route private chưa fully automated (chủ yếu manual/smoke route).

### Pending
- [ ] Chuẩn hóa auth của `clasp` để tránh lẫn account khi push Apps Script (preflight guard trong `push-sheet.mjs`).
- [ ] Hoàn thiện PocketBase-first cho các luồng people/actions còn dùng Supabase.
- [ ] Tổng hợp test matrix regression đầy đủ trước production deploy.

---

## 4) Issues hiện tại (People + migration dở dang)

### People / Sheet sync
1. **Push script timeout/permission confusion**
   - Có khả năng lẫn auth profile giữa global/local `.clasprc.json`.
   - Cần preflight check account email trước khi `clasp push`.

2. **Google Sheet script deployment drift**
   - Nếu update `integrations/google-sheets/people-sync/Code.js` mà chưa push đúng script ID thì web behavior không đổi.

3. **UI state consistency**
   - Đã thêm `router.refresh()` sau sync, nhưng vẫn cần verify thêm với data lớn và concurrent edits.

### PocketBase migration
1. **Mixed backend state**
   - Một số route/service mới dùng PocketBase, nhưng nhiều luồng khác vẫn Supabase.
   - Cần chiến lược “PB-first + fallback” hoặc cutover theo module để tránh inconsistency.

2. **Data parity validation**
   - Sau re-migrate accounts, cần checklist đối soát field-level (đặc biệt cashback fields split).

3. **Realtime replacement strategy**
   - Realtime Supabase đã được tháo ở account details; hiện dùng polling.
   - Cần đánh giá lại long-term (WebSocket/PocketBase realtime/poll interval).

---

## 5) Kế hoạch chuẩn bị cho Agent tiếp theo

### Phase A - Stabilize tools (nhanh)
- Thêm preflight auth check cho `people-sync/batch-sync push-sheet.mjs`:
  - xác nhận account `clasp` hiện hành,
  - fail sớm nếu mismatch,
  - hướng dẫn relogin 1 account duy nhất.

### Phase B - Migration consistency
- Rà các action/service còn Supabase trong flows liên quan Accounts/Cashback/People.
- Chọn thứ tự cutover theo module, không làm big-bang.

### Phase C - Verification
- Smoke test chuẩn theo checklist:
  - People sync all/current cycle
  - `#nosync` exclusion
  - Type coloring cột B
  - Accounts details / Cashback pages
- Chạy lint/build trước khi merge PR.

---

## 6) Ghi chú vận hành
- Branch làm việc chính: `feat/pocketbase-migration`
- Không cần giữ branch sheet-sync riêng nữa.
- Nếu gặp timeout tooling, ưu tiên:
  1) lưu docs/handover,
  2) commit state hiện tại,
  3) chuyển bước còn lại cho agent sau bằng checklist rõ ràng.
