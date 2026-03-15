# Plan - Installment DB Audit and Migration (2026-03-15)

## Priority
P1 (highest)

## Objective
Determine whether `/installment` is currently reading/writing Supabase, PocketBase, or mixed sources, then prepare a phased migration/refactor plan to PocketBase-first with behavior parity.

## Research checklist
- Trace route/page entry points for `/installment` in App Router.
- Identify all actions/services used by installment UI and dialogs.
- For each read/write path, classify backend:
  - Supabase-only
  - PocketBase-only
  - Mixed/fallback
- Map table/collection dependencies and relation IDs.
- Detect blocking assumptions:
  - UUID-only assumptions
  - `select('*')` anti-patterns
  - missing PB expand fields

## Code map targets
- `src/app/**/installment*`
- `src/components/**/installment*`
- `src/actions/**/*installment*`
- `src/services/**/*installment*`
- `src/services/pocketbase/*`
- `src/lib/supabase/*`

## Deliverables
1. Backend ownership matrix (file -> operation -> DB).
2. Gap list for migration completion.
3. Refactor plan by phase:
   - Phase 1: read-path parity
   - Phase 2: write-path parity
   - Phase 3: cleanup and remove dead Supabase coupling
4. Validation checklist for each phase.

## Success criteria
- No unknown data paths for installment domain.
- Clear migration target state documented.
- Next agent can implement phase-by-phase without re-discovery.

## Risks
- Hidden data coupling via shared transaction helpers.
- Silent ID transform mismatches between UUID and PocketBase IDs.
- Mixed mode regressions if one action path remains Supabase-only.
