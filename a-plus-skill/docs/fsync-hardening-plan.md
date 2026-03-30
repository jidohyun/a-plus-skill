# fsync Hardening Plan

## Goal
Add stronger durability for evidence append paths without changing existing strict/balanced/fast policy semantics, fail-window behavior, or exact error families relied on by tests and operators.

## Current evidence paths

### 1) Ops evidence (`appendInstallOpsEvent` in `src/index.ts`)
Used by `enforceAuditIntegrityPolicy(...)`.

Behavior requirements today:
- primary write failure must be observable via `primaryWrite.ok === false`
- fallback write must still run when primary fails
- strict mode must preserve fail-window semantics:
  - first `1..N` failures => base strict gate error only
  - `N+1` => `ops_evidence_write_failed ... window=...`
- strict state read/write faults must continue surfacing exact families:
  - `strict_evidence_state_fault=parse_error`
  - `strict_evidence_state_fault=read_error:<CODE>`
  - `fail_state_write_failed=<...>`
- balanced mode must continue warn-only on evidence primary/fallback failure

### 2) Install audit evidence (`writeInstallAuditEvent` in `src/install/openclawInstaller.ts`)
Behavior requirements today:
- append failure must warn and not crash install flow
- audit chain/hash semantics must remain unchanged
- bootstrap anchor/marker/fuse/latch sequencing must remain unchanged
- locking behavior must remain compatible with stale/orphan lock recovery

## Why the naive fsync patch failed
The quick change replaced `appendFileSync(...)` with open/write/fsync helpers.
Tests failed because current failure injection mocks target `appendFileSync` directly in several strict evidence tests. That means the patch changed the failure surface without updating the test/semantics contract.

So this is not just an I/O swap. It is a contract-preserving refactor.

## Safe implementation strategy

### Phase A — refactor behind one append primitive
Introduce a small append helper module or exported local helper used by both:
- `appendInstallOpsEvent`
- `writeInstallAuditEvent`

Helper shape should return structured failures, for example:
- `ok: true`
- `ok: false, error: <message>`

Important: existing callers must keep their current semantics.

### Phase B — preserve current test fault injection contract
Before switching to durable append internals, update tests to mock the new helper/primitive instead of `appendFileSync`.
This keeps failure semantics stable while allowing implementation change underneath.

### Phase C — durable append internals
Implement durable append with:
1. `openSync(file, 'a')`
2. `writeSync(...)`
3. `fsyncSync(fd)`
4. `closeSync(fd)`

Optional later hardening:
- fsync parent directory for file creation cases
- feature flag/env gate if cross-platform quirks appear

## Invariants that must not change
- exact strict fail-open/fail-closed progression
- `ops_evidence_write_failed` emission timing
- invalid strict mode fail-fast behavior in ops status
- existing audit hash chain semantics
- install flow should not start failing closed in balanced mode due to audit append durability changes

## Required test updates before implementation

### `tests/audit-integrity-gate.test.ts`
Move failure injection from raw `appendFileSync` mocking to the new append helper used by ops evidence writes.
Coverage must still prove:
- strict window 1..N base error only
- strict N+1 emits `ops_evidence_write_failed`
- strict state parse/read/write faults still surface exact messages
- balanced warns stronger when both primary/fallback writes fail

### `tests/install-flow.test.ts`
Add or preserve tests showing:
- install audit event append still succeeds normally
- stale lock recovery still works
- append failure still warns without crashing install flow

## Recommended next coding step
1. Add shared append helper abstraction
2. Repoint tests to mock that abstraction
3. Re-run tests to ensure behavior unchanged
4. Only then switch helper internals to `writeSync + fsyncSync`
5. Full gate run

## Non-goal for now
Do not mix this work with policy changes, fast-cap semantics, or strict state schema changes.
