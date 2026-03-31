# OpenClaw Plugin Migration Plan for a-plus-skill

## Goal

Turn `a-plus-skill` into an **OpenClaw-native tool plugin** without breaking the current CLI/operator workflow.

The right first milestone is **not** “full plugin replacement.”
The right first milestone is:

- keep existing CLI scripts working
- extract reusable use-case/library surfaces
- add a thin OpenClaw plugin bridge on top
- expose only low-risk, read-mostly tools first

## Non-goals for phase 1

Do **not** do these in the first plugin phase:

- direct install execution tool
- direct report delivery/send tool
- override token generation/injection tool
- policy bypass / semantics changes
- replacing the existing `npm run ...` operator flow

## Constraints to preserve

- `strict / balanced / fast` policy meaning must stay unchanged
- strict exit semantics must stay unchanged
- existing JSON output contracts should remain additive / compatibility-minded
- existing CLI scripts should remain available
- current operator workflow (`review + critical + validation`, no push on FAIL) must remain intact

---

## Current codebase diagnosis

`a-plus-skill` is currently closer to a **single orchestrator app + operational scripts** than a plugin.

### Strengths

- Domain logic is already fairly modular in `src/*`
  - collector
  - recommender
  - policy
  - install
  - report
  - delivery
- JSON/reporting surfaces already exist and are useful for plugin tool responses
- test coverage is broad enough to support incremental refactors

### Main structural issue

`src/index.ts` currently mixes too many responsibilities:

- profile loading
- collector fetch
- policy decision
- audit integrity gate
- strict/fast state handling
- install execution
- report rendering
- report delivery

This is too large to map directly into safe OpenClaw tools.

---

## Recommended target architecture

Refactor toward four layers:

### 1) domain/core
Pure calculations and rendering logic.

Examples:
- scoring
- decision calculation
- reason generation
- report rendering

### 2) application/use-cases
Reusable orchestration functions that call domain + infrastructure.

Examples:
- `getCollectorStatus()`
- `getInstallSummary()`
- `getScoringCalibration()`
- `getOpsStatus()`
- `getMaintenanceStatus()`
- `runRecommendationBatch({ install, deliver, ... })`

### 3) infrastructure
Adapters for external side effects.

Examples:
- filesystem/data-path access
- env loading
- fetch/HTTP
- child-process install execution
- delivery senders
- nonce/file-lock stores

### 4) interfaces
Thin wrappers only.

Examples:
- CLI scripts
- OpenClaw plugin tools

---

## Recommended phase 1 plugin shape

### Plugin type
**Tool plugin**

This matches the product better than a channel/provider plugin.

### Phase 1 public tools

#### 1. `aplus_status`
Purpose:
- top-level operational health summary

Backed by:
- maintenance status + ops status use-case functions

Expected output:
- overall health
- severity
- issue count
- primary issue
- recommended action
- section summaries

#### 2. `aplus_install_summary`
Purpose:
- summarize recent install/audit activity

Backed by:
- install summary use-case

Expected output:
- counters
- action/status/note/error breakdown
- recent events

#### 3. `aplus_scoring_calibration`
Purpose:
- inspect score distribution / decision balance

Backed by:
- scoring calibration use-case

Expected output:
- distributions
- decision counts
- sample quality note

#### 4. `aplus_recommend_report`
Purpose:
- generate recommendation/report output

Backed by:
- recommendation batch use-case

Phase 1 safety rule:
- default `install=false`
- default `deliver=false`

Expected output:
- collector meta
- policy
- recommendation list
- rendered report or structured report payload

### Optional phase 1 tool
#### 5. `aplus_audit_verify`
Purpose:
- verify audit integrity state

This is read-oriented and may be safe to expose, but it is optional in the first increment.

---

## What must be refactored before plugin entry is added

## A. Split `src/index.ts`
Introduce reusable orchestration functions instead of a single monolithic `main()`.

Suggested target modules:

- `src/application/recommend/runRecommendationBatch.ts`
- `src/application/status/getCollectorStatus.ts`
- `src/application/status/getInstallSummary.ts`
- `src/application/status/getScoringCalibration.ts`
- `src/application/status/getOpsStatus.ts`
- `src/application/status/getMaintenanceStatus.ts`

### Critical rule
The plugin entry must **not** become another copy of the current app orchestration.

---

## B. Add config resolution layer
Current behavior is heavily coupled to `process.env`.
That is convenient for CLI, but not sufficient for plugin use.

Add a single resolver such as:

```ts
resolveRuntimeConfig({ toolInput, pluginConfig, env })
```

Recommended precedence:
1. tool input
2. plugin config
3. env
4. defaults

This prevents CLI and plugin from silently drifting into different behaviors.

---

## C. Remove script-to-script orchestration
Some scripts currently orchestrate by spawning other scripts.
That is acceptable for shell convenience but poor for plugin internals.

Phase 1 refactor rule:
- scripts become thin wrappers over shared application functions
- plugin tools call the same application functions directly

This is especially important for:
- `maintenance-status.mjs`
- `ops-status.mjs`
- any script using subprocess chaining for internal composition

---

## D. Normalize data path resolution
A major plugin risk is cwd-dependent state.

Current logic uses `process.cwd()` for files like:
- audit logs
- fast-cap state
- strict evidence state
- install ops events
- delivery logs

That is dangerous in plugin runtime where cwd may differ.

Add explicit path resolution helpers, for example:

```ts
resolveDataPaths({ rootDir, env, pluginConfig })
```

The data-path strategy must be deterministic and shared by:
- CLI
- plugin tools
- tests

---

## Suggested implementation phases

## Phase 0 — planning lock
Deliverables:
- this migration document
- agreement on phase 1 tool surface
- agreement that install/delivery execution are deferred

## Phase 1 — application extraction
Deliverables:
- `src/application/*` use-case modules
- `src/index.ts` simplified to batch entry wrapper
- no behavior change intended

Definition of done:
- current CLI behavior still works
- no policy semantic drift
- tests remain green

## Phase 2 — CLI wrapper cleanup
Deliverables:
- `scripts/*.mjs` call shared application functions
- subprocess chaining reduced or removed for internal composition
- JSON outputs preserved

Definition of done:
- CLI output compatibility maintained
- maintenance/status tools share same internal logic as future plugin tools

## Phase 3 — plugin skeleton
Deliverables:
- separate plugin package metadata for OpenClaw plugin discovery
- plugin manifest
- plugin entry file registering initial tools

Suggested files:
- `packages/openclaw-plugin-aplus/openclaw.plugin.json`
- `packages/openclaw-plugin-aplus/src/index.ts`

Definition of done:
- plugin registers 4 read-mostly tools
- tools call shared application functions / built root artifacts
- plugin entry contains no business-heavy orchestration
- root `a-plus-skill` package does not need to depend on the full `openclaw` runtime package

## Phase 4 — contract stabilization
Deliverables:
- plugin tool response docs
- clear JSON/text response modes if needed
- README/operator documentation for plugin usage

Definition of done:
- tool outputs are documented enough for automation consumers
- additive evolution expectations are explicit

## Phase 5 — side-effect tool evaluation (later)
Possible future tools:
- install planning tool
- install execute tool
- report delivery tool

Prerequisites before any of those:
- reentrancy analysis complete
- install self-call behavior understood
- audit/nonce/lock safety reviewed under plugin runtime
- explicit operator/allowlist safety model defined

---

## Recommended first PR sequence

### PR 1
**Refactor only:** carve out application/use-case functions from existing status/report logic.

Scope:
- no plugin files yet
- no behavior changes intended
- scripts still pass

### PR 2
**Thin CLI cleanup:** make scripts use the new application layer directly.

Scope:
- reduce subprocess chaining
- preserve JSON outputs and exit codes

### PR 3
**Plugin skeleton:** add OpenClaw plugin manifest + entry + 2 low-risk tools first.

Recommended first 2 tools:
- `aplus_status`
- `aplus_install_summary`

### PR 4
Add remaining low-risk tools:
- `aplus_scoring_calibration`
- `aplus_recommend_report`

### PR 5+
Only after confidence builds:
- audit verify tool
- install planning tool
- maybe side-effect tools behind stronger safeguards

---

## Risks to monitor closely

### 1. Self-invoking install path / reentrancy risk
If install logic shells out to OpenClaw commands, plugin runtime may create recursion or operational ambiguity.

**Phase 1 response:** do not expose install execution as a tool.

### 2. `process.env` global coupling
Plugin tool calls should not depend on implicit global mutable state more than necessary.

**Phase 1 response:** central config resolver.

### 3. cwd-sensitive file paths
Audit and state files must not silently relocate under plugin execution.

**Phase 1 response:** explicit path resolution layer.

### 4. overloading plugin entry with app logic
If plugin entry starts reimplementing orchestration, maintainability will regress immediately.

**Phase 1 response:** plugin entry stays thin.

### 5. read/write tool boundary confusion
Users will assume a tool can safely be called by the agent.

**Phase 1 response:** expose observation/report tools first, delay write-heavy tools.

---

## Review/gate discipline for this migration

For each implementation increment, preserve the established flow:

1. plan
2. implementation
3. `review + critical + validation`
4. push only if PASS

Additional migration-specific checks:
- no policy semantic drift
- no strict exit semantic drift
- no JSON contract break without explicit documentation
- no install execution exposure in phase 1

---

## Immediate next action

Start with **PR 1: application extraction**.

Concretely:
- identify the smallest read-only use-cases to extract first
- likely start with:
  - collector status
  - install summary
  - scoring calibration
  - maintenance status composition

That gives the fastest path to a real OpenClaw plugin without touching the highest-risk install/delivery paths first.
