# Next TODOs

## Completed in this hardening cycle
- Delivery health visibility added to `ops:status`
- `ops:status:gate` connected to CI (`.github/workflows/ops-status-gate.yml`)
- Delivery log parsing hardened:
  - ignore gzip rotated logs
  - classify `delivery_success` separately from failures/unknown events
- Stale/orphan file lock recovery hardened in `withFileLock`
- Evidence append hardening completed in two phases:
  1. abstraction via `src/install/appendEvidence.ts`
  2. durable append via `openSync + writeSync + fsyncSync + closeSync`
- Fast-cap operational visibility improved:
  - `fast_cap_reason` added to `ops:status`
  - `docs/fast-cap-runbook.md` added
  - `npm run fast-cap:inspect` added
  - `fast-cap:inspect` now treats missing state+key pair as `reason="not_initialized"` with exit `0`
- Collector live-data robustness improved:
  - fallback on `UNEXPECTED_CONTENT_TYPE`
  - fallback on `HTML_TOO_LARGE` (content-length and post-read body size)
  - fallback on `EMPTY_HTML`
  - fetch timeout/abort guard with `FETCH_ERROR_TIMEOUT`
  - weekly report now exposes `fallbackReason`
  - parser now supports embedded JSON from `data-skills`, `data-page`, `data-state`, `data-props`
  - `collector-status` now exposes richer diagnostics (`degraded`, `skillCount`, `fetchTimeoutMs`)
- Weekly report explainability improved:
  - header now exposes decision distribution summary
  - header now includes a `takeaway` summary sentence
  - each item now includes natural-language decision narrative
  - each item now includes `topSignals` (top 2 scoring axes)
  - each item now includes concise `why` reason summary
  - README examples updated to match the richer report format
- Report delivery visibility improved:
  - delivery log entries now include `collector_source`, `collector_degraded`, `collector_reason`
  - `delivery:failures` now summarizes by collector source/reason
  - README now documents delivery collector context fields
- Policy/install guidance improved:
  - override pending notes now distinguish `confirmation missing`
  - override pending notes now distinguish `reason missing or too short`
  - balanced block notes now distinguish missing/invalid primary vs strong override token
  - README now documents how to interpret these pending/rejected notes
- Operator tooling / maintenance UX improved:
  - added `npm run maintenance:status`
  - bundles `ops:status:gate`, `collector:status`, `fast-cap:inspect`, `delivery:failures`
  - returns exit `2` when the ops gate fails, otherwise `0`

## Current recommended next work

### 1) Minor ops UX polish (optional)
- Add human-friendly summary mode to `fast-cap:inspect`
- Add quick interpretation examples to README for:
  - `fast_cap_tampered=true`
  - `fast_cap_reason=*`
  - `fast-cap:inspect reason=not_initialized`

### 2) Cross-link and maintenance docs polish (optional)
- Link `docs/fsync-hardening-plan.md` from README or maintenance docs
- Add short operator examples for explicit fast-cap reset vs preserve-for-investigation

### 3) Choose next major product/feature track (recommended)
The current hardening/ops-status/fast-cap track is in a strong state, collector robustness/visibility is in a much better place, and report/policy guidance has also advanced.
Next work should likely move to one of these themes:
- deeper policy/install refinement (e.g. more specific missing-condition notes for balanced block paths)
- operator tooling / maintenance UX
- delivery/collector status integration beyond current summaries

## Notes for next session
- Keep policy semantics unchanged:
  - `strict / balanced / fast` meaning fixed
  - strict exit semantics fixed
- Keep commit prefix:
  - `tidying commit:`
- Keep no-push-on-fail rule:
  - push only after review/critical/validation + gate pass
- Treat `ops:status` exit `2` as intentional gate signal, not generic script failure
