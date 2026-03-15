# Plan - Bot Refactor to Q&A Only (2026-03-15)

## Priority
P3 (after Installment and Service)

## Product direction
Bot should become a conversational assistant that answers based on user financial context (transactions, cashback state, card config). It should NOT submit transactions.

## Explicit non-goal
- Remove/disable transaction submission tasks from bot flow.

## Target user experience
- Vietnamese-first Q&A, for example:
  - "bao hiem xai the gi" -> suggest best card policy from current config.
  - "thang nay the X da du dieu kien cashback chua" -> status based on cycle spending.

## Research checklist
- Inventory current bot modules/routes/prompts/tools.
- Classify intents:
  - keep: advisory Q&A
  - remove: create/update transaction intents
- Define data context assembly for answers:
  - recent transactions
  - cycle spend and cashback policies
  - card-level limits/rules
- Define grounding strategy to reduce hallucination:
  - deterministic retrieval layer
  - strict response templates for critical advice

## Technical design outputs
1. Intent policy table (allowed vs blocked intents).
2. Data retrieval contract for Q&A engine.
3. Prompt/system-guard design for Vietnamese advisory responses.
4. Migration steps to sunset submit-txn pathways safely.

## Suggested phases
- Phase 1: audit and deprecate submit intents behind feature flags.
- Phase 2: implement advisory-only retrieval and answer formatting.
- Phase 3: QA with Vietnamese scenario library.

## Success criteria
- Bot can answer cashback/card-config questions using real data.
- Bot no longer creates or submits transactions.
- Documentation includes known limitations and confidence boundaries.

## Risks
- Missing normalized cashback metadata for some historical transactions.
- Conflicting card policies if source config is inconsistent.
- User expectation mismatch if advisory confidence is not surfaced.

## Latest Delivery Notes (2026-03-15)
- Transaction Slide V2 cashback panel updated with visible Total Profit and in-card Earn Breakdown by rule.
- Added Show all rules toggle for breakdown list to inspect all rule lines without tooltip.
