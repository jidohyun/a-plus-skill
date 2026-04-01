import { getInstallAuditPath, verifyInstallAuditFile } from '../../install/auditIntegrity.js';

export type AuditVerifyResult = {
  ok: boolean;
  line: number;
  reason: string;
  path: string;
  verifiedCount: number;
  lastHash: string;
};

export function getAuditVerify(path = getInstallAuditPath()): AuditVerifyResult {
  const result = verifyInstallAuditFile(path);
  return {
    ok: result.ok,
    line: result.line,
    reason: result.reason,
    path,
    verifiedCount: result.verifiedCount,
    lastHash: result.lastHash
  };
}
