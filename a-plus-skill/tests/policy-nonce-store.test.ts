import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileNonceStore,
  MemoryNonceStore,
  createOverrideNonceStoreFromEnv,
  validateOverrideSecurityPosture,
  __resetOverrideNonceStoreForTests
} from '../src/policy/overrideNonceStore.js';

afterEach(() => {
  delete process.env.INSTALL_TOPOLOGY;
  delete process.env.INSTALL_POLICY;
  delete process.env.INSTALL_OVERRIDE_NONCE_STORE;
  delete process.env.INSTALL_OVERRIDE_NONCE_DIR;
  __resetOverrideNonceStoreForTests();
});

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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast for multi-instance topology when memory nonce store is configured', () => {
    process.env.INSTALL_TOPOLOGY = 'multi-instance';
    process.env.INSTALL_OVERRIDE_NONCE_STORE = 'memory';

    expect(() => validateOverrideSecurityPosture()).toThrow(/requires INSTALL_OVERRIDE_NONCE_STORE=file/i);
  });

  it('passes posture validation for multi-instance + file store with valid dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-posture-valid-'));

    try {
      process.env.INSTALL_TOPOLOGY = 'multi-instance';
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;

      expect(() => validateOverrideSecurityPosture()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast when multi-instance nonce dir is not writable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-posture-ro-'));

    try {
      process.env.INSTALL_TOPOLOGY = 'multi-instance';
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;

      chmodSync(dir, 0o555);
      expect(() => validateOverrideSecurityPosture()).toThrow(/must be writable/i);
    } finally {
      chmodSync(dir, 0o755);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast for multi-instance topology when fast policy is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-posture-fast-'));

    try {
      process.env.INSTALL_TOPOLOGY = 'multi-instance';
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;

      expect(() => validateOverrideSecurityPosture({ policy: 'fast' })).toThrow(/does not allow INSTALL_POLICY=fast/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails fast for multi-instance topology when INSTALL_POLICY=fast and no params are passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-posture-fast-env-'));

    try {
      process.env.INSTALL_TOPOLOGY = 'multi-instance';
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;
      process.env.INSTALL_POLICY = 'fast';

      expect(() => validateOverrideSecurityPosture()).toThrow(/does not allow INSTALL_POLICY=fast/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes posture validation with INSTALL_POLICY=balanced and no params are passed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nonce-posture-balanced-env-'));

    try {
      process.env.INSTALL_TOPOLOGY = 'multi-instance';
      process.env.INSTALL_OVERRIDE_NONCE_STORE = 'file';
      process.env.INSTALL_OVERRIDE_NONCE_DIR = dir;
      process.env.INSTALL_POLICY = 'balanced';

      expect(() => validateOverrideSecurityPosture()).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
