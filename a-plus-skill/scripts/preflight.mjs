import { existsSync } from 'node:fs';

const missing = [];
if (!existsSync('node_modules/tsx')) missing.push('tsx');
if (!existsSync('node_modules/vitest')) missing.push('vitest');
if (!existsSync('node_modules/typescript')) missing.push('typescript');

if (missing.length > 0) {
  console.error('[preflight] Missing dev dependencies:', missing.join(', '));
  console.error('[preflight] Run: npm ci --include=dev');
  process.exit(1);
}

console.log('[preflight] OK');
