import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
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

export function createOverrideNonceStoreFromEnv(): OverrideNonceStore {
  const mode = process.env.INSTALL_OVERRIDE_NONCE_STORE?.trim().toLowerCase() ?? 'memory';

  if (mode === 'file') {
    const dir = process.env.INSTALL_OVERRIDE_NONCE_DIR?.trim() || './data/override-nonces';
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
