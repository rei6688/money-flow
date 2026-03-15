# Plan - Service Page and Monthly Vercel Cron Research (2026-03-15)

## Priority
P2 (after Installment)

## Objective
Research service-related pages/actions and identify why monthly cron on Vercel is not running as expected.

## Scope
- Service page/module code ownership and data source mapping.
- Scheduled job design in current repo.
- Vercel cron configuration, route handler expectations, and auth/secret checks.

## Research checklist
- Locate all cron-related configs/files:
  - `vercel.json`
  - `src/app/api/**` scheduler endpoints
  - scripts triggered by schedule
- Confirm expected cadence (monthly) vs actual implementation.
- Verify runtime requirements for cron handler:
  - method, auth token, environment variables
  - timezone/date-cutoff logic
- Check logs/guard clauses that could early-return and appear as no-op.
- Document local reproduction commands and dry-run strategy.

## Deliverables
1. Cron topology diagram (trigger -> endpoint -> action -> side effects).
2. Failure hypotheses ranked by likelihood.
3. Fix options:
   - minimal patch
   - robust observability + retry model
4. Post-fix validation playbook.

## Success criteria
- A concrete reason why monthly cron is not working is documented.
- A low-risk implementation plan is ready for execution.

## Risks
- Missing environment secrets in Vercel project.
- Cron endpoint protected by auth path not configured in scheduler.
- Monthly logic tied to local timezone assumptions.
