import { accessSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InstallTopology, Policy } from '../types/index.js';

export interface OverrideNonceStore {
  consume(nonce: string, exp: number, now: number): boolean;
  gc(now: number): void;
}

export class MemoryNonceStore implements OverrideNonceStore {
  private readonly usedNonces = new Map<string, number>();

  consume(nonce: string, exp: number, now: number): boolean {
    this.gc(now);
    if (this.usedNonces.has(nonce)) {
      return false;
    }

    this.usedNonces.set(nonce, exp);
    return true;
  }

  gc(now: number): void {
    for (const [nonce, exp] of this.usedNonces.entries()) {
      if (exp < now) {
        this.usedNonces.delete(nonce);
      }
    }
  }

  clear(): void {
    this.usedNonces.clear();
  }
}

export class FileNonceStore implements OverrideNonceStore {
  private readonly dir: string;

  constructor(dir = './data/override-nonces') {
    this.dir = ensureNonceDirWritable(dir);
  }

  consume(nonce: string, exp: number, now: number): boolean {
    this.gc(now);

    const path = this.filePath(nonce);
    const payload = JSON.stringify({ exp });

    try {
      writeFileSync(path, payload, { flag: 'wx' });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        return false;
      }

      throw error;
    }
  }

  gc(now: number): void {
    const files = readdirSync(this.dir, { withFileTypes: true });

    for (const entry of files) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const path = join(this.dir, entry.name);
      try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw) as { exp?: unknown };
        const exp = typeof parsed.exp === 'number' ? parsed.exp : Number.NaN;

        if (!Number.isFinite(exp) || exp < now) {
          unlinkSync(path);
        }
      } catch {
        unlinkSync(path);
      }
    }
  }

  private filePath(nonce: string): string {
    const safe = nonce.replace(/[^A-Za-z0-9_-]/g, '_');
    return join(this.dir, `${safe}.json`);
  }
}

let storeSingleton: OverrideNonceStore | null = null;

function resolveTopology(raw?: string): InstallTopology {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'local-dev' || normalized === 'single-instance' || normalized === 'multi-instance') {
    return normalized;
  }

  return 'single-instance';
}

function resolveNonceStoreMode(raw?: string): 'memory' | 'file' {
  return raw?.trim().toLowerCase() === 'file' ? 'file' : 'memory';
}

function resolveNonceDir(raw?: string): string {
  return raw?.trim() || './data/override-nonces';
}

function resolvePolicy(raw?: string): Policy {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'balanced' || normalized === 'fast') {
    return normalized;
  }

  return 'balanced';
}

function ensureNonceDirWritable(dir: string): string {
  const resolvedDir = resolve(dir);

  try {
    mkdirSync(resolvedDir, { recursive: true });
    accessSync(resolvedDir, fsConstants.R_OK | fsConstants.W_OK);

    const probePath = join(resolvedDir, '.nonce-store-write-test');
    writeFileSync(probePath, String(Date.now()), { flag: 'w' });
    unlinkSync(probePath);
  } catch (error) {
    throw new Error(
      `[security] override nonce directory must be writable: ${resolvedDir} (${error instanceof Error ? error.message : String(error)})`
    );
  }

  return resolvedDir;
}

export function validateOverrideSecurityPosture(params?: { topology?: InstallTopology; policy?: Policy }): void {
  const topology = params?.topology ?? resolveTopology(process.env.INSTALL_TOPOLOGY);
  const policy = params?.policy ?? resolvePolicy(process.env.INSTALL_POLICY);
  const mode = resolveNonceStoreMode(process.env.INSTALL_OVERRIDE_NONCE_STORE);

  if (topology === 'multi-instance') {
    if (mode !== 'file') {
      throw new Error(
        '[security] INSTALL_TOPOLOGY=multi-instance requires INSTALL_OVERRIDE_NONCE_STORE=file to enforce replay protection across instances'
      );
    }

    const dir = resolveNonceDir(process.env.INSTALL_OVERRIDE_NONCE_DIR);
    ensureNonceDirWritable(dir);

    if (policy === 'fast') {
      throw new Error('[security] INSTALL_TOPOLOGY=multi-instance does not allow INSTALL_POLICY=fast');
    }
  }
}

export function createOverrideNonceStoreFromEnv(): OverrideNonceStore {
  const mode = resolveNonceStoreMode(process.env.INSTALL_OVERRIDE_NONCE_STORE);

  if (mode === 'file') {
    const dir = resolveNonceDir(process.env.INSTALL_OVERRIDE_NONCE_DIR);
    return new FileNonceStore(dir);
  }

  return new MemoryNonceStore();
}

export function getOverrideNonceStore(): OverrideNonceStore {
  if (!storeSingleton) {
    storeSingleton = createOverrideNonceStoreFromEnv();
  }

  return storeSingleton;
}

export function __resetOverrideNonceStoreForTests(): void {
  if (storeSingleton instanceof MemoryNonceStore) {
    storeSingleton.clear();
  }

  storeSingleton = null;
}
