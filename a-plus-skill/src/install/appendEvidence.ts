import { appendFileSync } from 'node:fs';

export function appendEvidenceLine(path: string, line: string): void {
  appendFileSync(path, line, 'utf8');
}
