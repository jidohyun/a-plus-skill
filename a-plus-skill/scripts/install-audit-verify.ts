import { getAuditVerify } from '../src/application/status/getAuditVerify.js';

function main(): void {
  const result = getAuditVerify();

  if (!result.ok) {
    console.error(`ERROR line=${result.line} reason=${result.reason} path=${result.path}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${result.reason} path=${result.path}`);
}

main();
