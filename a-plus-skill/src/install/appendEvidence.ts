import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';

export function appendEvidenceLine(path: string, line: string): void {
  const fd = openSync(path, 'a');
  try {
    writeSync(fd, line, undefined, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
