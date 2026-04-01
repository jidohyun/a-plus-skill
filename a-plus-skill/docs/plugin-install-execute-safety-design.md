# Plugin Install Execute Safety Design

## Goal

Define the conditions required before exposing any **install execution** capability as an OpenClaw plugin tool.

This document is intentionally about **safety design**, not implementation.
Current plugin tools remain read-only or planning-only.

## Current status

Already exposed:
- `aplus_status`
- `aplus_install_summary`
- `aplus_scoring_calibration`
- `aplus_recommend_report`
- `aplus_audit_verify`
- `aplus_install_plan`

Not exposed yet:
- install execution
- report delivery send
- override token generation / mutation

That is intentional.

---

## Why install execute is high risk

The install path is not a pure calculation. It currently combines:
- policy decisioning (`strict / balanced / fast`)
- audit integrity gates
- fast-cap logic
- override token validation
- nonce replay protection
- file lock / stale lock recovery
- child-process install execution
- timeout / recovery behavior
- append-only audit evidence

Exposing this directly as a plugin tool means the agent could trigger a write-heavy, side-effecting, operator-sensitive path from conversational context.

---

## Primary risk classes

### 1) Reentrancy / self-call risk
`a-plus-skill` install execution ultimately shells out to OpenClaw install flows.
If a plugin tool runs inside OpenClaw and then invokes OpenClaw install commands again, this can create:
- recursion ambiguity
- nested runtime confusion
- operator misunderstanding about what is installing what
- unexpected lock contention

### 2) Audit / nonce / lock state safety
Install execution depends on file-backed state such as:
- install audit log
- fast-cap state
- strict evidence fail state
- nonce store
- file locks

If plugin runtime path resolution differs from CLI/runtime assumptions, the tool may write to the wrong location or split state unintentionally.

### 3) Approval / confirmation semantics
Conversational tools make it easy to call “just one more tool.”
That is dangerous if the tool can mutate the system without a strong operator acknowledgement model.

### 4) Multi-instance / topology mismatch
The current install flow has topology-sensitive behavior and nonce-store expectations.
A plugin tool must not assume it is running in a safe single-process local-dev environment.

### 5) Recovery ambiguity
If install execution fails or times out, the system must guarantee:
- durable evidence append
- clear operator-visible status
- deterministic retry/recovery semantics

---

## Required safety conditions before any execute tool exists

## A. Explicit execution boundary
Install planning and install execution must stay separate.

Recommended tool split:
- `aplus_install_plan` — read-only, already allowed
- `aplus_install_execute` — future, gated, side-effecting

The planning tool must never silently fall through into execution.

## B. Clear operator acknowledgement model
A future execute tool should require an explicit acknowledgement surface beyond ordinary tool invocation.

Minimum expected properties:
- explicit operator intent
- unambiguous action summary
- visible target slugs / actions
- no silent policy bypass

Possible future models:
- OpenClaw approval/allowlist gate
- explicit `confirm=true` plus operator-only channel restriction
- one-time execution token generated outside the tool

## C. Deterministic path resolution
Before execution is exposed, all stateful paths should be resolved through a shared resolver.

Needed targets:
- audit log path
- fast-cap state path
- strict evidence state path
- nonce dir/store path
- delivery/ops logs if any execution path depends on them

The plugin and CLI must agree on these paths.

## D. Runtime / topology preflight
A future execute tool should fail closed when runtime posture is unsafe.

Examples of required checks:
- unsupported topology
- missing shared nonce directory in multi-instance mode
- invalid override security posture
- audit integrity failure under `strict`
- unresolved path root
- reentrancy risk detected

## E. Idempotency / duplicate-call design
A conversational tool may be called twice accidentally.
Before execution is exposed, duplicate-call semantics must be specified.

Needed design questions:
- what uniquely identifies one requested install action?
- how do we detect duplicate agent calls?
- do we rely only on nonce/override state, or add execution request ids?

## F. Read-before-write discipline
A future execute tool should probably require a planning payload or recompute-and-echo step before mutating.

Example principle:
- compute planned actions
- present/record execution intent
- then execute exactly those actions

Not:
- decide and execute in one opaque step with no operator-readable boundary

---

## Recommended future interface shape

### Planning tool (already aligned)
`aplus_install_plan`
- read-only
- returns candidate slugs, decisions, actions, notes, reasons

### Candidate execution tool (future)
`aplus_install_execute`

Suggested future inputs:
- `policy`
- `profileType`
- `targets` or `slugs`
- `confirm`
- execution request id / approval token
- optional `maxItems`

Suggested future outputs:
- requested targets
- executed targets
- skipped targets
- audit path
- per-item outcomes
- overall execution summary

But this tool should not be implemented until the safety prerequisites in this document are complete.

---

## Recommended readiness checklist

Before exposing install execution, require all of the following:

- [ ] shared path resolver is implemented and used by CLI + plugin
- [ ] reentrancy/self-call behavior is documented and tested
- [ ] execution request acknowledgement model is chosen
- [ ] multi-instance posture checks are enforced
- [ ] duplicate-call/idempotency behavior is defined
- [ ] execution-specific tests exist for timeout/failure/retry/evidence append
- [ ] docs explicitly explain why execution is more restricted than planning
- [ ] review + critical + validation gate passes on the new execution path

---

## Current recommendation

Do **not** expose install execution yet.

The current split is the right one:
- planning visible
- execution withheld

That preserves operator trust while still giving the agent useful planning and diagnostic visibility.
