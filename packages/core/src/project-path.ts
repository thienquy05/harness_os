import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Design gap caught during implementation, not in the original plan text:
 * `harness_gate_daemon` is a *persistent* container (§2.2), reached via
 * `docker exec`, which cannot attach a new bind mount per invocation the way
 * `docker run -v $PROJECT_PATH:/workspace:ro` does for the ephemeral
 * `harness-os:latest` mcp-serve container (§2.3). So the daemon instead gets
 * one broad read-only mount at compose-time (`$HARNESS_PROJECTS_ROOT` on the
 * host -> `/workspaces` in the container, see db/docker-compose.yml), and
 * every `--project-path` (always a host path, and always what's stored in
 * `project_path` DB columns for consistency across every tool) is translated
 * to its container-local equivalent only at the point of actual fs access.
 *
 * Outside that container (tests, or the ephemeral mcp-serve container which
 * only ever mounts a single project at a fixed path) neither env var is set,
 * so this is a no-op passthrough.
 */
export function resolveProjectFsPath(projectPath: string): string {
  const workspacesRoot = process.env.HARNESS_WORKSPACES_ROOT;
  const hostProjectsRoot = process.env.HARNESS_HOST_PROJECTS_ROOT;

  if (!workspacesRoot || !hostProjectsRoot) {
    return projectPath;
  }

  const rel = relative(hostProjectsRoot, projectPath);
  if (rel.startsWith('..')) {
    throw new Error(
      `Project path ${projectPath} is outside the configured projects root ${hostProjectsRoot} ` +
        `(HARNESS_HOST_PROJECTS_ROOT) — harness_gate_daemon cannot see it.`,
    );
  }
  return join(workspacesRoot, rel);
}

/**
 * The main checkout of a linked git worktree (Claude Code's `.claude/worktrees/<name>/`), or null for
 * anything else. Read from git's own files, no git binary needed: the worktree's `.git` file names its
 * admin dir, whose `commondir` leads to the main `.git` and whose `gitdir` must point back at this
 * worktree, so a hand-written `.git` file cannot borrow another project's trust. Paths in those files
 * are host paths (git wrote them on the host), relative ones resolved the way git does. A spelling
 * that differs from git's (a symlinked path) gives null, which fails closed.
 */
export async function mainCheckoutOf(projectPath: string): Promise<string | null> {
  const read = async (path: string) => (await readFile(resolveProjectFsPath(path), 'utf8')).trim();
  try {
    const pointer = /^gitdir:\s*(.+)$/.exec(await read(join(projectPath, '.git')));
    if (!pointer) return null;
    const adminDir = resolve(projectPath, pointer[1]);
    const commonDir = resolve(adminDir, await read(join(adminDir, 'commondir')));
    const backLink = resolve(adminDir, await read(join(adminDir, 'gitdir')));
    const main = dirname(commonDir);
    // Only Claude Code's worktree location counts: any command can write a self-consistent admin dir, but
    // a "worktree" here never overlaps the main checkout's own files (a forged src/.git would).
    const inWorktreesDir = dirname(projectPath) === join(main, '.claude', 'worktrees');
    if (backLink !== join(projectPath, '.git') || basename(commonDir) !== '.git' || !inWorktreesDir) return null;
    return main;
  } catch {
    return null; // no .git file (a normal checkout has a .git folder), outside the mount, or not a worktree
  }
}

/**
 * The checkout that governs a file, and the file's path within it. Claude Code worktrees sit at
 * <main>/.claude/worktrees/<name>/ (Claude Code 2.1.327), and a file there is judged against its
 * worktree's root and that worktree's own recorded RED, whichever checkout's hooks sent it; a file in the
 * main checkout is judged against the main checkout, also from a worktree session. Decided by location
 * alone, so a .git file planted elsewhere changes nothing. A file outside the project family keeps the
 * old reading, relative to projectPath (`../...`, never gated).
 */
export async function governingCheckout(projectPath: string, filePath: string): Promise<{ checkout: string; path: string }> {
  const file = resolve(projectPath, filePath);
  const main = (await mainCheckoutOf(projectPath)) ?? projectPath;
  const inMain = relative(main, file);
  if (inMain === '..' || inMain.startsWith(`..${sep}`) || isAbsolute(inMain)) {
    return { checkout: projectPath, path: relative(projectPath, file) };
  }
  const worktree = /^\.claude[\\/]worktrees[\\/]([^\\/]+)[\\/](.+)$/.exec(inMain);
  return worktree ? { checkout: join(main, '.claude', 'worktrees', worktree[1]), path: worktree[2] } : { checkout: main, path: inMain };
}
