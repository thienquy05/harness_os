import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashFile, recordVerifiedConfig, TRACKED_CONFIG_FILES, verifyConfigIntegrity } from './config-integrity.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(projectPath: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: projectPath });
}

async function gitStatusPorcelain(projectPath: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: projectPath });
  return stdout.trim();
}

async function seedProjectFiles(projectPath: string): Promise<void> {
  const claudeDir = join(projectPath, '.claude');
  await mkdir(join(claudeDir, 'hooks'), { recursive: true });
  await writeFile(join(claudeDir, 'harness.config.json'), '{"gatedGlobs":[]}');
  await writeFile(join(claudeDir, 'hooks', 'enforce-gate.sh'), '#!/bin/sh\necho ok\n');
  await writeFile(join(claudeDir, 'settings.json'), '{}');
}

/** In-memory stand-in for config_checksums, keyed by (project_path, file_path). */
function fakePoolWithChecksumRows(): { pool: Pool; rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('SELECT sha256')) {
        const [projectPath, filePath] = params as [string, string];
        const sha = rows.get(`${projectPath}::${filePath}`);
        return { rows: sha ? [{ sha256: sha }] : [] };
      }
      if (text.includes('INSERT INTO config_checksums')) {
        const [projectPath, filePath, sha256] = params as [string, string, string, string];
        rows.set(`${projectPath}::${filePath}`, sha256);
        return { rows: [] };
      }
      throw new Error(`Unexpected query in fake pool: ${text}`);
    },
  } as unknown as Pool;
  return { pool, rows };
}

describe('config-integrity', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-config-integrity-'));
    await seedProjectFiles(projectPath);
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('reports not-initialized when no checksum rows exist for the project', async () => {
    const { pool } = fakePoolWithChecksumRows();
    const result = await verifyConfigIntegrity(pool, projectPath);
    expect(result.initialized).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reports ok when on-disk hashes match the recorded verified hashes', async () => {
    const { pool } = fakePoolWithChecksumRows();
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await verifyConfigIntegrity(pool, projectPath);
    expect(result.initialized).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('reports a mismatch when a tracked file changes after verification', async () => {
    const { pool } = fakePoolWithChecksumRows();
    await recordVerifiedConfig(pool, projectPath, 'test-human');

    // Simulate Claude Code editing the hook after it was verified.
    await writeFile(join(projectPath, '.claude', 'hooks', 'enforce-gate.sh'), '#!/bin/sh\necho tampered\n');

    const result = await verifyConfigIntegrity(pool, projectPath);
    expect(result.initialized).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual(['hooks/enforce-gate.sh']);
  });

  it('hashFile is deterministic for identical content', async () => {
    const filePath = join(projectPath, '.claude', 'settings.json');
    const [first, second] = await Promise.all([hashFile(filePath), hashFile(filePath)]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('tracks exactly the three files CONST-CORE-004 names', () => {
    expect(TRACKED_CONFIG_FILES).toEqual(['harness.config.json', 'hooks/enforce-gate.sh', 'settings.json']);
  });

  describe('git commit side effect (regression: DB checksum vs git HEAD divergence)', () => {
    beforeEach(async () => {
      await initGitRepo(projectPath);
    });

    it('commits the tracked files so a freshly-verified project has no untracked config', async () => {
      const { pool } = fakePoolWithChecksumRows();
      await recordVerifiedConfig(pool, projectPath, 'test-human');

      // Before the fix, these files would still show as untracked ("??") —
      // post-bash-revert.sh's backstop would `rm -f` them on the very next
      // Bash call, deleting the harness config it's supposed to protect.
      const status = await gitStatusPorcelain(projectPath);
      expect(status).toBe('');
    });

    it('re-committing after a legitimate reconcile keeps git HEAD in lockstep with the new DB hash', async () => {
      const { pool } = fakePoolWithChecksumRows();
      await recordVerifiedConfig(pool, projectPath, 'initial-human');

      // Simulate a legitimate human reconfigure of a tracked file, then
      // reconcile-config re-verifying and re-trusting it (same call).
      await writeFile(join(projectPath, '.claude', 'settings.json'), '{"reconfigured":true}');
      await recordVerifiedConfig(pool, projectPath, 'reconciling-human');

      // Before the fix: git HEAD still held the OLD settings.json content,
      // so post-bash-revert.sh's next Bash call would `git checkout --` it
      // back to the old version — which then mismatches the NEW DB hash,
      // blocking every gated write until someone notices.
      const status = await gitStatusPorcelain(projectPath);
      expect(status).toBe('');

      const result = await verifyConfigIntegrity(pool, projectPath);
      expect(result.ok).toBe(true);
    });
  });
});
