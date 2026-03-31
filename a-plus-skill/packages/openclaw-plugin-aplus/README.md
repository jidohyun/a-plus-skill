# openclaw-plugin-aplus

OpenClaw-native tool plugin wrapper for `a-plus-skill`.

## Phase 1 scope

Read-mostly tools only:
- `aplus_status`
- `aplus_install_summary`
- `aplus_scoring_calibration`
- `aplus_recommend_report`

## Notes

- This package is intentionally separate from the root `a-plus-skill` app to avoid pulling the full OpenClaw runtime dependency into the core repository package.
- The plugin reuses built artifacts from the root project under `dist/src/`.
- The current package entry imports `../../../dist/src/...` from `packages/openclaw-plugin-aplus/src/index.ts`, so the root project must be built before plugin load.
- Recommended workflow:
  1. build root project
  2. install plugin package dependencies separately
  3. link/install this package into OpenClaw

## Expected workflow

```bash
cd /path/to/a-plus-skill
npm run build

cd packages/openclaw-plugin-aplus
npm install
openclaw plugins install -l .
openclaw plugins inspect a-plus-skill --json
```

## Current limitations

- The plugin currently depends on root build output under `dist/src/`.
- Tools currently return JSON payloads serialized as text content.
- Phase 1 does not expose install execution, delivery sending, or override token flows.
