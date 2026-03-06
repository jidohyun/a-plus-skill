import { spawn } from 'node:child_process';
import type { InstallOutcome, InstallPlan } from '../types/index.js';

export type InstallRunnerResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type InstallRunner = (slug: string) => Promise<InstallRunnerResult>;

function buildInstallCommand(slug: string): { command: string; args: string[] } {
  const base = (process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;

  return {
    command: command ?? 'openclaw',
    args: [...args, slug]
  };
}

export function createDefaultRunner(): InstallRunner {
  return async (slug: string) => {
    const { command, args } = buildInstallCommand(slug);

    return new Promise<InstallRunnerResult>((resolve) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (err) => {
        resolve({ code: null, stdout, stderr, error: err.message });
      });
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  };
}

export async function runInstall(
  slug: string,
  plan: InstallPlan,
  runner: InstallRunner = createDefaultRunner()
): Promise<InstallOutcome> {
  if (!plan.canInstall) {
    return {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'skipped',
      error: plan.notes.join('; ')
    };
  }

  const run = await runner(slug);
  const success = run.code === 0 && !run.error;

  return {
    slug,
    action: plan.action,
    attempted: true,
    installed: success,
    status: success ? 'installed' : 'failed',
    command: `${process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install'} ${slug}`,
    code: run.code,
    stdout: run.stdout,
    stderr: run.stderr,
    error: run.error
  };
}
