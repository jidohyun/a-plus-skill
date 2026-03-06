import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { InstallOutcome, InstallPlan } from '../types/index.js';

export type InstallRunnerResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type InstallRunner = (slug: string) => Promise<InstallRunnerResult>;

const ALLOWED_BASE_COMMANDS = new Set(['openclaw']);
const STRICT_SUBCOMMAND = ['skill', 'install'];
const SLUG_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

function validateSlug(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) {
    return 'invalid slug format; expected owner/name';
  }
  return null;
}

function buildInstallCommand(slug: string): { command: string; args: string[] } {
  const base = (process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const [command, ...args] = parts;
  const resolved = command ?? 'openclaw';

  if (!ALLOWED_BASE_COMMANDS.has(resolved)) {
    throw new Error(`disallowed install command: ${resolved}`);
  }

  // harden: only allow openclaw skill install (+ optional safe flags) as base
  if (args.length < 2 || args[0] !== STRICT_SUBCOMMAND[0] || args[1] !== STRICT_SUBCOMMAND[1]) {
    throw new Error('disallowed install subcommand: must start with "skill install"');
  }

  const extraArgs = args.slice(2);
  const safeExtra = extraArgs.filter((arg) => ['--global', '--yes', '-g', '-y'].includes(arg));

  return {
    command: resolved,
    args: [...STRICT_SUBCOMMAND, ...safeExtra, '--', slug]
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

function writeAudit(plan: InstallPlan, slug: string): void {
  if (plan.action !== 'override-install') return;
  try {
    const file = resolve(process.cwd(), 'data', 'install-audit.log');
    mkdirSync(dirname(file), { recursive: true });
    const line = `${new Date().toISOString()}\tslug=${slug}\tpolicy=${plan.policy}\taction=${plan.action}\toriginal=${plan.originalDecision}\teffective=${plan.effectiveDecision}\tnotes=${plan.notes.join('|')}\n`;
    appendFileSync(file, line, 'utf8');
  } catch {
    // ignore audit write failures to avoid blocking runtime
  }
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

  const slugError = validateSlug(slug);
  if (slugError) {
    return {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'failed',
      error: slugError
    };
  }

  let commandPreview = `${process.env.OPENCLAW_INSTALL_COMMAND ?? 'openclaw skill install'} -- ${slug}`;
  writeAudit(plan, slug);
  try {
    const run = await runner(slug);
    const success = run.code === 0 && !run.error;

    return {
      slug,
      action: plan.action,
      attempted: true,
      installed: success,
      status: success ? 'installed' : 'failed',
      command: commandPreview,
      code: run.code,
      stdout: run.stdout,
      stderr: run.stderr,
      error: run.error
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      slug,
      action: plan.action,
      attempted: false,
      installed: false,
      status: 'failed',
      command: commandPreview,
      error: reason
    };
  }
}
