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
  - each item now includes threshold-aware decision narrative
  - each item now includes `topSignals` (top 2 scoring axes)
  - each item now includes concise `why` reason summary
  - README examples updated to match the richer report format
- Recommendation quality tooling improved:
  - added `npm run scoring:calibration` to inspect score distributions and decision counts
  - trend weighting now gives more influence to current active installs vs pure historical download bulk
  - final score weighting now gives slightly more emphasis to fit/stability vs raw trend/security
  - safe default profile now carries meaningful developer-oriented defaults instead of empty arrays
  - reason generation now uses more specific threshold/gate-oriented wording
  - recommendation reasons are now priority-sorted so gate/threshold issues appear before weaker secondary signals
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
  - supports `--json` for automation use cases
- Onboarding / operator workflow improved:
  - README now includes a quickstart path for first-time operators
  - README now includes a recommended troubleshooting order (`maintenance:status` → targeted drill-down)

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
- Keep `docs/json-output-contracts.md` updated as JSON modes evolve

### 3) Choose next major product/feature track (recommended)
The current hardening/ops-status/fast-cap track is in a strong state, collector/report/policy/operator UX have all advanced, and machine-readable outputs are now documented.
A new phase-1 OpenClaw plugin wrapper now also exists at `packages/openclaw-plugin-aplus/` and currently exposes read-mostly tools:
- `aplus_status`
- `aplus_install_summary`
- `aplus_scoring_calibration`
- `aplus_recommend_report`

Next work should likely move to one of these themes:
- recommendation quality 2nd/3rd-pass empirical calibration
- onboarding / end-to-end operator guide polish (including plugin install/use docs)
- install/audit summary interpretation polish
- plugin phase 2 planning (`aplus_audit_verify`, config resolver, text/json output mode split)

## Notes for next session
- Keep policy semantics unchanged:
  - `strict / balanced / fast` meaning fixed
  - strict exit semantics fixed
- Keep commit prefix:
  - `tidying commit:`
- Keep no-push-on-fail rule:
  - push only after review/critical/validation + gate pass
- Treat `ops:status` exit `2` as intentional gate signal, not generic script failure
