import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordVerifiedConfig } from './config-integrity.js';
import { checkGate } from './gates.js';

function fakePool(): { pool: Pool; checksums: Map<string, string>; decisions: Array<Record<string, unknown>> } {
  const checksums = new Map<string, string>();
  const decisions: Array<Record<string, unknown>> = [];
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      if (text.includes('SELECT sha256')) {
        const [projectPath, filePath] = params as [string, string];
        const sha = checksums.get(`${projectPath}::${filePath}`);
        return { rows: sha ? [{ sha256: sha }] : [] };
      }
      if (text.includes('INSERT INTO config_checksums')) {
        const [projectPath, filePath, sha256] = params as [string, string, string, string];
        checksums.set(`${projectPath}::${filePath}`, sha256);
        return { rows: [] };
      }
      if (text.includes('INSERT INTO decisions')) {
        decisions.push({ params });
        return { rows: [{ id: decisions.length }] };
      }
      throw new Error(`Unexpected query in fake pool: ${text}`);
    },
  } as unknown as Pool;
  return { pool, checksums, decisions };
}

async function seedProjectFiles(projectPath: string): Promise<void> {
  const claudeDir = join(projectPath, '.claude');
  await mkdir(join(claudeDir, 'hooks'), { recursive: true });
  await writeFile(join(claudeDir, 'harness.config.json'), '{"gatedGlobs":[]}');
  await writeFile(join(claudeDir, 'hooks', 'enforce-gate.sh'), '#!/bin/sh\necho ok\n');
  await writeFile(join(claudeDir, 'settings.json'), '{}');
}

describe('checkGate', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-gates-'));
    await seedProjectFiles(projectPath);
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('blocks with a run_harness_init directive when the project was never initialized', async () => {
    const { pool } = fakePool();
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'app.py' });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('run_harness_init');
  });

  it('passes when config integrity holds', async () => {
    const { pool } = fakePool();
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'app.py' });
    expect(result.pass).toBe(true);
    expect(result.directive).toBeUndefined();
  });

  it('blocks with a reconcile_config directive and logs a CRITICAL decision on drift', async () => {
    const { pool, decisions } = fakePool();
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    await writeFile(join(projectPath, '.claude', 'hooks', 'enforce-gate.sh'), '#!/bin/sh\necho tampered\n');

    const result = await checkGate(pool, { projectPath, tool: 'Bash', filePath: undefined });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('reconcile_config');
    expect(result.directive?.files).toEqual(['hooks/enforce-gate.sh']);
    expect(decisions).toHaveLength(1);
  });
});
