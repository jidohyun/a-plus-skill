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
The current hardening/ops-status/fast-cap track is in a strong state.
Next work should likely move to a new primary theme, e.g.:
- collector / ClawHub live-data robustness
- report delivery UX/visibility
- policy/install behavior refinement
- operator tooling / maintenance UX

## Notes for next session
- Keep policy semantics unchanged:
  - `strict / balanced / fast` meaning fixed
  - strict exit semantics fixed
- Keep commit prefix:
  - `tidying commit:`
- Keep no-push-on-fail rule:
  - push only after review/critical/validation + gate pass
- Treat `ops:status` exit `2` as intentional gate signal, not generic script failure
