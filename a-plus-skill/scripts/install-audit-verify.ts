import { getInstallAuditPath, verifyInstallAuditFile } from '../src/install/auditIntegrity.js';

function main(): void {
  const file = getInstallAuditPath();
  const result = verifyInstallAuditFile(file);

  if (!result.ok) {
    console.error(`ERROR line=${result.line} reason=${result.reason} path=${file}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${result.reason} path=${file}`);
}

main();
