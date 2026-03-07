import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FileNonceStore,
  MemoryNonceStore,
  createOverrideNonceStoreFromEnv,
  __resetOverrideNonceStoreForTests
} from '../src/policy/overrideNonceStore.js';

describe('override nonce store', () => {
  it('memory store consumes nonce only once', () => {
    const store = new MemoryNonceStore();
    const now = 100;

    expect(store.consume('nonce-a', now + 60, now)).toBe(true);
    expect(store.consume('nonce-a', now + 60, now)).toBe(false);
  });

  it('file store blocks nonce reuse across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-store-'));

    try {
      const now = 100;
      const first = new FileNonceStore(dir);
      expect(first.consume('nonce-b', now + 60, now)).toBe(true);

      const second = new FileNonceStore(dir);
      expect(second.consume('nonce-b', now + 60, now)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('file store removes expired nonces via gc and allows reuse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-store-'));

    try {
      const store = new FileNonceStore(dir);
      expect(store.consume('nonce-c', 150, 100)).toBe(true);
      expect(store.consume('nonce-c', 150, 100)).toBe(false);

      store.gc(151);

      expect(store.consume('nonce-c', 300, 151)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('createOverrideNonceStoreFromEnv uses file mode when configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-store-env-'));

    try {
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;

      const store = createOverrideNonceStoreFromEnv();
      expect(store).toBeInstanceOf(FileNonceStore);
    } finally {
      delete process.env.INSTALL_OVERRIDE_NONCE_STORE;
      delete process.env.INSTALL_OVERRIDE_NONCE_DIR;
      __resetOverrideNonceStoreForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
