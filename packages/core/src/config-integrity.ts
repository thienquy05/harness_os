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
 * sources of truth in lockstep so neither failure mode can occur — *when the
 * commit succeeds*. commitTrackedConfig degrades to a warning instead of
 * throwing on failure (Open Item #9/#22), which stops a crash but not
 * failure mode (2) above: the checksum row is inserted regardless of whether
 * the commit lands, so a failed commit still leaves git HEAD and the DB
 * diverged. The `committed` flag on the return value exists so a caller like
 * reconcile-config (Open Item #13's still-read-only-mount invocation) can
 * refuse to report success when that's true, instead of silently handing the
 * caller a project that's one Bash call away from wedging itself.
 */
export async function recordVerifiedConfig(
  pool: Pool,
  projectPath: string,
  verifiedBy: string,
): Promise<{ committed: boolean }> {
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
  const committed = await commitTrackedConfig(fsPath, verifiedBy);
  return { committed };
}

/**
 * No-ops (with a stderr warning) whenever the commit can't happen — same
 * posture as post-bash-revert.sh's own precondition check (Open Item #9):
 * the PreToolUse gate is still the primary defense, this is only the
 * backstop, so no caller may ever see this throw.
 *
 * That matters concretely for reconcile-config: it still runs via `docker
 * exec harness_gate_daemon` against the daemon's `:ro` /workspaces mount
 * (harness-init.ts uses a separate writable-mount invocation instead — see
 * its own doc comment). Once git was installed in the image for
 * harness-init's sake, `git rev-parse --is-inside-work-tree` started
 * succeeding there too (it's a read), so execution reaches `git add`, which
 * then fails on the read-only mount (EROFS) — and reconcile-config's `main`
 * has no try/catch around `recordVerifiedConfig`, so an uncaught throw here
 * would crash it *after* the checksum row was already inserted, leaving the
 * DB and git HEAD diverged (the exact split-brain this function exists to
 * prevent). Catching write failures here, not just the "not a repo" case,
 * keeps that guarantee for every caller.
 *
 * Exported so harness-init.ts (Phase 3) can commit the rest of a fresh
 * `.claude/` scaffold (AGENTS.md, the non-CONST-CORE-004 hook scripts) with
 * the same git-identity handling, instead of duplicating it — those files
 * are outside TRACKED_CONFIG_FILES's narrower CONST-CORE-004 scope, so they
 * need their own commit call, not this function's.
 */
export async function commitFiles(fsPath: string, relFiles: string[], message: string): Promise<boolean> {
  // Found via a real harness-init fire, not a unit test (Open Item #13's
  // sibling): this always runs as root inside the container, over a
  // bind-mounted directory owned by the host user. Git's post-CVE-2022-24765
  // ownership check refuses to operate on a repo whose top-level dir belongs
  // to a different uid than the running process, unless explicitly
  // exempted — harmless here since the "attacker" and "victim" are the same
  // developer's own container and host account.
  await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', fsPath]).catch(() => undefined);

  const isGitRepo = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: fsPath }).then(
    () => true,
    () => false,
  );
  if (!isGitRepo) {
    console.error(
      `[config-integrity] Warning: ${fsPath} is not a git repository — ${relFiles.join(', ')} was not committed (Open Item #9).`,
    );
    return false;
  }

  try {
    await execFileAsync('git', ['add', '--', ...relFiles], { cwd: fsPath });

    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', ...relFiles], { cwd: fsPath });
    if (stdout.trim().length === 0) return true;

    // A fresh `docker run --rm` container has no persistent ~/.gitconfig, so
    // there's no author identity unless one is supplied — found the same way
    // as the safe.directory issue above, one step later in the same real
    // fire. These are machine-generated commits; a fixed bot identity here
    // (scoped to this one invocation via -c, not written to global config) is
    // correct rather than a workaround.
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=harness-os',
        '-c',
        'user.email=harness-os@localhost',
        'commit',
        '-m',
        message,
        '--',
        ...relFiles,
      ],
      { cwd: fsPath },
    );
    return true;
  } catch (error) {
    // Caught, not thrown, per this function's own contract (Open Item #9) —
    // but unlike the "not a repo" branch above, a write failure here (e.g.
    // EROFS on harness_gate_daemon's read-only mount, Open Item #22) still
    // leaves the checksum row recordVerifiedConfig already inserted pointing
    // at content git HEAD doesn't have. Returning false instead of true lets
    // that caller refuse to claim success instead of silently handing back a
    // project that failure mode (2) in recordVerifiedConfig's own doc
    // comment describes.
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[config-integrity] Warning: failed to commit ${relFiles.join(', ')} in ${fsPath} — ${reason} (Open Item #9).`,
    );
    return false;
  }
}

async function commitTrackedConfig(fsPath: string, verifiedBy: string): Promise<boolean> {
  const relFiles = TRACKED_CONFIG_FILES.map((file) => join('.claude', file));
  return commitFiles(fsPath, relFiles, `harness: verified config baseline (by ${verifiedBy})`);
}
