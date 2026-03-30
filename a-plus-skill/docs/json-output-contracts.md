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
  "fetchTimeoutMs": 10000,
  "fetchedAt": "2026-03-30T00:00:00.000Z"
}
```

### Notes
- Exit code `2` remains the strict/fallback signal when `--strict` is used.
- `reason=NONE` is only expected in live mode.

## Consumer guidance
- Prefer checking process exit code first for gate semantics.
- Use JSON fields for dashboards, automations, and downstream heuristics.
- Avoid parsing human-readable text modes when a JSON mode exists.
