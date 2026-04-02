# JSON Output Contracts

This document defines the current machine-readable output contracts for operator-facing scripts.
These outputs are intended for automation, cron, wrappers, and downstream tooling.

## Stability note
- Field additions are expected over time.
- Existing top-level field names documented here should be treated as stable unless explicitly called out in release notes.
- Consumers should ignore unknown fields.

## 1) `npm run maintenance:status -- --json`

### Shape
```json
{
  "summary": {
    "overall": "healthy|degraded|nonhealthy",
    "severity": "info|medium|high|critical",
    "issue_count": 0,
    "ops_gate_code": 0,
    "collector_mode": "live|fallback|unknown",
    "fast_cap_reason": "none|not_initialized|...",
    "delivery_failures": 0,
    "primary_issue": "none|ops_gate_fail|fast_cap_attention|collector_fallback|delivery_failures",
    "recommended_action": "..."
  },
  "checks": [
    {
      "label": "ops_status_gate|collector_status|fast_cap_inspect|delivery_failures",
      "ok": true,
      "code": 0,
      "stdout": "...",
      "stderr": "..."
    }
  ]
}
```

### Notes
- Process exit code remains the authoritative gate signal.
- `summary.primary_issue` is the prioritized issue chosen by current rules.
- `checks[*].stdout` and `checks[*].stderr` are raw command outputs and may contain multiline text.

## 2) `npm run install:summary -- --json`

### Shape
```json
{
  "summary": {
    "hours": 24,
    "path": ".../data/install-events.jsonl",
    "records": 12
  },
  "counters": {
    "actions": [{ "key": "auto-install", "count": 7 }],
    "statuses": [{ "key": "installed", "count": 6 }],
    "notes": [{ "key": "hold override pending: confirmation missing", "count": 2 }],
    "errors": [{ "key": "INSTALL_TIMEOUT", "count": 1 }]
  },
  "recent_events": [
    {
      "ts": "2026-03-30T00:00:00.000Z",
      "slug": "demo/tool",
      "action": "auto-install",
      "status": "installed",
      "degraded": false,
      "error": "none",
      "notes": []
    }
  ]
}
```

### Notes
- Empty/missing audit log returns `records=0` with empty arrays.
- Counters are sorted descending by `count`.
- `recent_events` is newest-first and limited to 3 events.

## 3) `npm run scoring:calibration -- --json`

### Shape
```json
{
  "summary": {
    "policy": "strict|balanced|fast",
    "source": "live|fallback",
    "degraded": false,
    "skill_count": 12,
    "sample_quality": "normal|limited",
    "note": "..."
  },
  "distributions": {
    "fit": { "min": 0, "p50": 0, "p90": 0, "max": 0, "avg": 0 },
    "trend": { "min": 0, "p50": 0, "p90": 0, "max": 0, "avg": 0 },
    "stability": { "min": 0, "p50": 0, "p90": 0, "max": 0, "avg": 0 },
    "security": { "min": 0, "p50": 0, "p90": 0, "max": 0, "avg": 0 },
    "final": { "min": 0, "p50": 0, "p90": 0, "max": 0, "avg": 0 }
  },
  "decision_counts": {
    "recommend": 0,
    "caution": 0,
    "hold": 0,
    "block": 0
  }
}
```

### Notes
- `sample_quality=limited` means calibration should be interpreted conservatively.
- Percentiles are approximate order-statistic picks from the current sample.

## 4) `npm run collector:status -- --json`

### Shape
```json
{
  "mode": "live|fallback",
  "degraded": false,
  "reason": "NONE|UNEXPECTED_CONTENT_TYPE|HTML_TOO_LARGE|EMPTY_HTML|FETCH_ERROR_TIMEOUT|...",
  "threshold": 3,
  "skillCount": 12,
  "skill_count": 12,
  "fetchTimeoutMs": 10000,
  "fetch_timeout_ms": 10000,
  "fetchedAt": "2026-03-30T00:00:00.000Z",
  "fetched_at": "2026-03-30T00:00:00.000Z"
}
```

### Notes
- Exit code `2` remains the strict/fallback signal when `--strict` is used.
- `reason=NONE` is only expected in live mode.
- Snake-case aliases are included to make downstream JSON consumers easier to standardize.

## 5) OpenClaw plugin tools (phase 1)

Implementation location (current plan):
- `packages/openclaw-plugin-aplus/`


### `aplus_status`
In `format=json`, plugin tools now return an additive envelope:

```json
{
  "tool": "aplus_status",
  "format": "json",
  "generatedAt": "2026-04-01T01:00:00.000Z",
  "data": {
    "summary": {
    "overall": "healthy|degraded|nonhealthy",
    "severity": "info|medium|high|critical",
    "issue_count": 0,
    "ops_gate_code": 0,
    "collector_mode": "live|fallback|unknown",
    "fast_cap_reason": "none|not_initialized|...",
    "delivery_failures": 0,
    "primary_issue": "none|ops_gate_fail|fast_cap_attention|collector_fallback|delivery_failures",
    "recommended_action": "..."
    },
    "checks": []
  }
}
```

### `aplus_install_summary`
Returns the same payload shape as `install:summary --json`.

### `aplus_scoring_calibration`
Returns the same payload shape as `scoring:calibration --json`.

### `aplus_recommend_report`
Returns a read-only recommendation/report payload:

```json
{
  "policy": "strict|balanced|fast",
  "profileType": "developer|automation|assistant",
  "source": "live|fallback",
  "degraded": false,
  "fallbackReason": "NONE|...",
  "fetchedAt": "2026-03-30T00:00:00.000Z",
  "results": [],
  "report": "..."
}
```

### `aplus_audit_verify`
Returns the audit verification payload:

```json
{
  "ok": true,
  "line": 0,
  "reason": "OK verified=12 lastHash=...",
  "path": ".../data/install-events.jsonl",
  "verifiedCount": 12,
  "lastHash": "..."
}
```

### `aplus_install_plan`
Returns a planning-only install view:

```json
{
  "policy": "strict|balanced|fast",
  "profileType": "developer|automation|assistant",
  "source": "live|fallback",
  "degraded": false,
  "fallbackReason": "NONE|...",
  "fetchedAt": "2026-03-30T00:00:00.000Z",
  "items": [
    {
      "slug": "demo/tool",
      "decision": "hold",
      "installAction": "confirm-install",
      "canInstall": false,
      "finalScore": 52,
      "securityScore": 48,
      "notes": ["hold override pending: confirmation missing"],
      "reasons": []
    }
  ]
}
```

### Notes
- Phase 1/2/4 plugin tools are intentionally read-mostly except for metadata enrichment in JSON mode.
- All plugin tools accept `format=json|summary` (default: `json`).
- In `format=json`, plugin tools return an additive envelope with `tool`, `format`, `generatedAt`, and `data`.
- Read-only plugin tools now resolve runtime config with precedence: tool input > plugin config > env > defaults.
- Current resolved keys: `policy`, `profileType`, `hours`, `format`.
- In `summary` mode, tools return compact human-readable text instead of the full JSON payload.
- `aplus_recommend_report` does **not** perform install or delivery side effects.
- `aplus_audit_verify` does not modify audit state; it only verifies the current chain.
- Plugin tool payloads should evolve additively; consumers should ignore unknown fields.

## Consumer guidance
- Prefer checking process exit code first for gate semantics.
- Use JSON fields for dashboards, automations, and downstream heuristics.
- Avoid parsing human-readable text modes when a JSON mode exists.
