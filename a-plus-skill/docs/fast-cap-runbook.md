# Fast-Cap Tamper Detection Runbook

## Scope
This runbook covers the persisted fast audit-failure cap state:
- `data/fast-audit-fail-cap.json`
- `data/fast-audit-fail-cap.key`

It documents what counts as suspicious state, how to interpret `fast_cap_tampered=true`, and what operators should do before clearing state.

## Threat model
The fast-cap state exists to prevent silent fail-open behavior after repeated audit-integrity failures in `fast` policy.

Primary risks:
1. **Checksum tamper**
   - state JSON exists but checksum no longer matches key + payload
2. **State schema corruption**
   - malformed JSON or missing fields
3. **Key/state desynchronization**
   - key exists while state file is missing
   - state exists while key is missing
4. **Permission/IO interference**
   - state cannot be read due to `EACCES`, partial write, or storage fault
5. **Intentional reset attempt**
   - attacker/operator deletes only one of state/key to suppress prior fail count

## Runtime signals
### `ops:status`
Relevant fields:
- `fast_cap_count`
- `fast_cap_cap`
- `fast_cap_tampered`
- `critical_flags`
- `overall`

### Important interpretations
- `fast_cap_tampered=false`
  - persisted state is internally consistent
- `fast_cap_tampered=true`
  - do **not** treat current fast-cap state as trustworthy
  - in `fast` policy this is a hard unhealthy signal
  - in `balanced` it is at least degraded

## Known tamper reasons in code
Current logic promotes tamper on these conditions:
- `suspicious fast-cap reset: key exists while state missing`
- `fast-cap state read failed`
- `fast-cap state schema invalid`
- `fast-cap checksum mismatch`
- `fast-cap state parse failed`
- `key_missing_for_state` (ops status path)

## Operational response

### Case A — key exists, state missing
This is the most important suspicious-reset case.

Recommended response:
1. Assume local state may have been partially or intentionally reset
2. Check recent file operations / cleanup jobs / deployment hooks
3. Check whether the state file was removed while the key survived
4. Before clearing, confirm there is no ongoing integrity incident

Safe recovery:
- If confirmed to be stale local residue after a controlled cleanup/test run, remove the orphan key and let state regenerate on next write
- If not confirmed, preserve both evidence and host logs first

### Case B — state exists, key missing
Interpretation:
- state can no longer be trusted because checksum validation is impossible

Recommended response:
1. Treat as tamper or destructive cleanup
2. Preserve the state JSON for inspection
3. Do not regenerate key blindly unless you accept loss of trust chain for the current counter

### Case C — checksum mismatch / parse failure
Interpretation:
- strongest evidence of corruption or modification

Recommended response:
1. Preserve both files immediately
2. Snapshot permissions, owner, mtime, and surrounding logs
3. Investigate whether this came from:
   - manual edits
   - partial disk write
   - concurrent external tooling
   - hostile tamper

## Recovery policy
### Allowed quick recovery
Allowed only when all are true:
- root cause is understood
- no active audit integrity incident is underway
- mismatch is explained by test/dev cleanup or a one-off local corruption event
- recovery action is documented in commit/ops notes

### Preferred recovery action
If state is known-bad and trust cannot be preserved:
- remove **both** `fast-audit-fail-cap.json` and `fast-audit-fail-cap.key`
- do not remove just one side
- let next legitimate write recreate a fresh trusted pair

Why:
- deleting only one side intentionally triggers tamper on next read
- deleting both is an explicit reset, not a suspicious partial reset

## What NOT to do
- Do not delete only `fast-audit-fail-cap.json`
- Do not delete only `fast-audit-fail-cap.key`
- Do not hand-edit checksum/state fields in place
- Do not auto-clear tamper in CI without preserving context

## Suggested operator checklist
When `fast_cap_tampered=true` appears:
1. Run `npm run ops:status`
2. Inspect both files:
   - `ls -l data/fast-audit-fail-cap*`
   - `cat data/fast-audit-fail-cap.json`
   - `cat data/fast-audit-fail-cap.key`
3. Determine which tamper class applies
4. Preserve evidence if unexplained
5. Only then choose:
   - keep for investigation
   - remove both files for explicit reset
   - fix permissions/storage and retry

## Future hardening ideas
- emit explicit tamper reason in `ops:status` output
- add dedicated `npm run fast-cap:inspect` helper
- document permission baseline/ownership expectations
- optionally add backup snapshot before explicit reset
