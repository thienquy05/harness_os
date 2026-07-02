import { join, relative } from 'node:path';

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
