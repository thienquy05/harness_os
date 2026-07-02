#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildScaffoldDefaults,
  commitFiles,
  createPool,
  detectStack,
  recordVerifiedConfig,
  verifyConfigIntegrity,
  type ScaffoldDefaults,
} from '@harness-os/core';

const execFileAsync = promisify(execFile);

// cli/dist/harness-init.js and cli/src/harness-init.ts sit at the same depth
// under the repo root, and server/Dockerfile copies scaffold/ into the
// runtime image at that same root-relative path — see specs.ts's SCHEMA_DIR
// for the established precedent of resolving static, non-compiled assets
// this way instead of bundling them.
const SCAFFOLD_CLAUDE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scaffold', '.claude');

export interface ParsedInitArgs {
  projectPath?: string;
  prefix?: string;
}

export function parseArgs(argv: string[]): ParsedInitArgs {
  const result: ParsedInitArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project-path') result.projectPath = argv[++i];
    else if (arg === '--prefix') result.prefix = argv[++i];
  }
  return result;
}

function derivePrefix(projectPath: string): string {
  const alnum = basename(projectPath).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return alnum.slice(0, 6) || 'PROJ';
}

function renderAgentsMarkdown(reviewers: string[]): string {
  const lines = [
    '# AGENTS.md',
    '',
    'Recommended reviewer agents for this project, stamped by `harness init`',
    'from mechanical stack detection (plan §1.3, §7). Not stack-detection-proof',
    'against unusual layouts — edit freely as the project evolves.',
    '',
    ...reviewers.sort().map((reviewer) => `- \`${reviewer}\``),
    '',
  ];
  return lines.join('\n');
}

async function ensureGitRepo(projectFsPath: string): Promise<void> {
  // Runs as root inside the container over a host-owned bind mount — see the
  // matching comment on config-integrity.ts's commitFiles, which hits the
  // identical git dubious-ownership check moments later in the same call
  // chain. Exempting here too covers the case where the target project is
  // already a human's existing git repo (owned by their host uid), not just
  // the fresh-init case.
  await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', projectFsPath]).catch(
    () => undefined,
  );

  const isGitRepo = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectFsPath,
  }).then(
    () => true,
    () => false,
  );
  if (isGitRepo) return;
  await execFileAsync('git', ['init'], { cwd: projectFsPath });
}

async function scaffoldProject(projectFsPath: string, defaults: ScaffoldDefaults, prefix: string): Promise<void> {
  const claudeDir = join(projectFsPath, '.claude');
  await mkdir(join(claudeDir, 'agents'), { recursive: true });
  await cp(join(SCAFFOLD_CLAUDE_DIR, 'hooks'), join(claudeDir, 'hooks'), { recursive: true });
  await cp(join(SCAFFOLD_CLAUDE_DIR, 'settings.json'), join(claudeDir, 'settings.json'));

  const harnessConfig = { specPrefix: prefix, ...defaults.harnessConfig };
  await writeFile(join(claudeDir, 'harness.config.json'), `${JSON.stringify(harnessConfig, null, 2)}\n`);
  await writeFile(join(claudeDir, 'agents', 'AGENTS.md'), renderAgentsMarkdown(defaults.reviewers));

  await ensureGitRepo(projectFsPath);

  // recordVerifiedConfig commits only the three CONST-CORE-004-tracked files
  // (harness.config.json, hooks/enforce-gate.sh, settings.json) — everything
  // else this scaffolds (AGENTS.md, the other three hook scripts) would
  // otherwise be left permanently untracked, found by inspecting `git
  // status` after a real fire, not by a unit test.
  await commitFiles(projectFsPath, ['.claude'], 'harness: initial project scaffold');
}

/**
 * `harness init --project-path <path> [--prefix <PREFIX>]` — bootstraps
 * `.claude/` for a new governed project and establishes the trust baseline
 * gate-check depends on (`recordVerifiedConfig`). TTY-gated for the same
 * reason as `harness approve`/`harness reconcile-config` (§2.1, §3.5a): this
 * is the root of the config-integrity trust chain, so it must be a human
 * decision, never something Claude Code's Bash tool can trigger itself.
 *
 * Must run with a *writable* mount at the project path — unlike gate-check,
 * which reaches harness_gate_daemon's read-only `/workspaces` mount via
 * `docker exec`, this command needs an ephemeral `docker run -v <path>:<path>`
 * invocation (mirroring mcp-serve's pattern, not gate-check's) so it can
 * actually write `.claude/` and let `recordVerifiedConfig`'s git commit
 * succeed. See plan §12.x for the empirical confirmation that the daemon's
 * `:ro` mount rejects writes.
 *
 * That invocation must also pass `--user "$(id -u):$(id -g)" -e HOME=/tmp`.
 * Without it, the container runs as root, so every file this scaffolds
 * (`.claude/`, `.git/`) ends up root-owned on the host — unreadable-for-write
 * by the human and by Claude Code's own host-side Edit tool afterward, which
 * defeats the point of a config a human is expected to edit (§2.1 component
 * 3). Running as the host caller's own uid/gid makes the container's writes
 * land already owned by that user, with no other code change required — it
 * also means git's dubious-ownership check never triggers in the first
 * place for this path, since the process uid then matches the directory
 * owner exactly (the safe.directory exemption below stays anyway, as
 * defense-in-depth for a project already owned by some third uid).
 */
export async function main(
  argv: string[] = process.argv.slice(2),
  isTTY: boolean = Boolean(process.stdin.isTTY),
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.projectPath) {
    console.error('Usage: harness init --project-path <path> [--prefix <PREFIX>]');
    return 2;
  }
  if (!isTTY) {
    console.error('harness init requires an interactive TTY — refusing to run non-interactively (§2.1, §3.5a).');
    return 1;
  }

  const projectPath = parsed.projectPath;
  const pool = createPool();
  try {
    const existing = await verifyConfigIntegrity(pool, projectPath);
    if (existing.initialized) {
      console.error(
        `${projectPath} is already initialized. Use "harness reconcile-config" to re-trust a deliberate config change instead.`,
      );
      return 1;
    }

    const stack = await detectStack(projectPath);
    const defaults = buildScaffoldDefaults(stack);
    const prefix = parsed.prefix ?? derivePrefix(projectPath);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      `Initialize harness governance for ${projectPath} as "${prefix}" ` +
        `(detected: ${stack.language}${stack.frameworks.length ? `, ${stack.frameworks.join(', ')}` : ''})? [y/N] `,
    );
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Not initialized.');
      return 1;
    }

    await scaffoldProject(projectPath, defaults, prefix);

    const verifiedBy = process.env.USER ?? process.env.USERNAME ?? 'unknown-human';
    const { committed } = await recordVerifiedConfig(pool, projectPath, verifiedBy);
    if (!committed) {
      // Expected to always succeed here (this command's own writable-mount
      // invocation, unlike reconcile-config's still-read-only one — see the
      // matching check there for Open Item #22). Surfaced defensively rather
      // than silently claiming success, in case the target ever isn't
      // actually writable for some other reason (e.g. disk full).
      console.error(
        `Warning: ${projectPath}'s checksums were recorded, but the initial scaffold commit failed — ` +
          'see the warning above. Commit .claude manually before relying on the config-integrity gate.',
      );
    }
    console.log(`Initialized harness governance for ${projectPath} (prefix: ${prefix}).`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
