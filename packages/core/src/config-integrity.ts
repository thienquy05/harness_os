import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { query } from './db.js';
import { resolveProjectFsPath } from './project-path.js';

const execFileAsync = promisify(execFile);

/** The three files CONST-CORE-004 protects — see §2.1 component 3. */
export const TRACKED_CONFIG_FILES = [
  'harness.config.json',
  'hooks/enforce-gate.sh',
  'settings.json',
] as const;
export type TrackedConfigFile = (typeof TRACKED_CONFIG_FILES)[number];

export interface ConfigIntegrityResult {
  ok: boolean;
  /** false if `harness init` (or the test-only stand-in, recordVerifiedConfig) was never run for this project. */
  initialized: boolean;
  mismatches: TrackedConfigFile[];
}

export async function hashFile(absolutePath: string): Promise<string> {
  const content = await readFile(absolutePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Fails closed: any file with no verified row at all means "never
 * initialized" (initialized: false), distinct from "initialized but drifted"
 * (ok: false, mismatches populated) — enforce-gate.sh needs to tell a human
 * to run harness init apart from telling them to reconcile-config.
 */
export async function verifyConfigIntegrity(pool: Pool, projectPath: string): Promise<ConfigIntegrityResult> {
  const claudeDir = join(resolveProjectFsPath(projectPath), '.claude');
  const mismatches: TrackedConfigFile[] = [];
  let verifiedFileCount = 0;

  for (const file of TRACKED_CONFIG_FILES) {
    const rows = await query<{ sha256: string }>(
      pool,
      `SELECT sha256 FROM config_checksums
       WHERE project_path = $1 AND file_path = $2
       ORDER BY verified_at DESC LIMIT 1`,
      [projectPath, file],
    );
    if (rows.length === 0) continue;
    verifiedFileCount += 1;

    const currentHash = await hashFile(join(claudeDir, file));
    if (currentHash !== rows[0].sha256) {
      mismatches.push(file);
    }
  }

  if (verifiedFileCount === 0) {
    return { ok: false, initialized: false, mismatches: [] };
  }
  return { ok: mismatches.length === 0, initialized: true, mismatches };
}

/**
 * Stands in for what `harness init` (Phase 3, cli/src/harness-init.ts) will
 * eventually call after stamping scaffold/.claude/ into a project. Kept here,
 * not duplicated, so harness-init.ts has nothing left to reimplement.
 *
 * Also commits the tracked files (see commitTrackedConfig) in the same call
 * that records their hash. post-bash-revert.sh's backstop has no DB access,
 * so it diffs against git HEAD as a proxy for "the verified baseline" — if
 * this function only wrote the DB row and left the working tree uncommitted,
 * git HEAD and the DB hash would describe two different snapshots. That
 * divergence has two concrete failure modes: (1) a freshly-initialized,
 * never-committed .claude/ shows as untracked, so the first Bash call's
 * revert backstop deletes it outright; (2) after a legitimate reconcile, the
 * working tree still differs from the last commit, so the next Bash call
 * reverts the file back to the *old* content, which then mismatches the
 * *new* DB hash and blocks every gated write. Committing here keeps the two
 * sources of truth in lockstep so neither failure mode can occur.
 */
export async function recordVerifiedConfig(pool: Pool, projectPath: string, verifiedBy: string): Promise<void> {
  const fsPath = resolveProjectFsPath(projectPath);
  const claudeDir = join(fsPath, '.claude');
  for (const file of TRACKED_CONFIG_FILES) {
    const sha256 = await hashFile(join(claudeDir, file));
    await query(
      pool,
      `INSERT INTO config_checksums (project_path, file_path, sha256, verified_by) VALUES ($1, $2, $3, $4)`,
      [projectPath, file, sha256, verifiedBy],
    );
  }
  await commitTrackedConfig(fsPath, verifiedBy);
}

/**
 * No-ops (with a stderr warning) outside a git repo — same posture as
 * post-bash-revert.sh's own precondition check (Open Item #9): the
 * PreToolUse gate is still the primary defense, this is only the backstop.
 */
async function commitTrackedConfig(fsPath: string, verifiedBy: string): Promise<void> {
  const isGitRepo = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: fsPath }).then(
    () => true,
    () => false,
  );
  if (!isGitRepo) {
    console.error(
      `[config-integrity] Warning: ${fsPath} is not a git repository — verified config was not committed (Open Item #9).`,
    );
    return;
  }

  const relFiles = TRACKED_CONFIG_FILES.map((file) => join('.claude', file));
  await execFileAsync('git', ['add', '--', ...relFiles], { cwd: fsPath });

  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', ...relFiles], { cwd: fsPath });
  if (stdout.trim().length === 0) return;

  await execFileAsync(
    'git',
    ['commit', '-m', `harness: verified config baseline (by ${verifiedBy})`, '--', ...relFiles],
    { cwd: fsPath },
  );
}
