import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLatestTestRun,
  GreenWithoutRedError,
  recordTestRun,
  TestCommandMismatchError,
} from './test-runs.js';

function fakePool(existingRows: Array<{ phase: string; created_at: string }> = []) {
  const inserted: Array<{ text: string; params: unknown[] }> = [];
  const decisions: unknown[] = [];
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (text.includes('SELECT phase FROM test_runs')) {
      return { rows: existingRows.slice(0, 1) };
    }
    if (text.includes('INSERT INTO test_runs')) {
      inserted.push({ text, params });
      return {
        rows: [
          {
            id: 1,
            project_path: params[0],
            command: params[1],
            phase: params[2],
            exit_code: params[3],
            created_at: '2026-07-02T00:00:00.000Z',
          },
        ],
      };
    }
    if (text.includes('INSERT INTO decisions')) {
      decisions.push(params);
      return { rows: [{ id: 1 }] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });
  const pool = { query } as unknown as Pool;
  return { pool, inserted, decisions };
}

describe('recordTestRun', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-testruns-'));
    await mkdir(join(projectPath, '.claude'), { recursive: true });
    await writeFile(
      join(projectPath, '.claude', 'harness.config.json'),
      JSON.stringify({ testCommands: [{ globs: ['**/*.ts'], command: 'npm test' }] }),
    );
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('rejects a command that does not match any configured testCommands entry', async () => {
    const { pool } = fakePool();
    await expect(
      recordTestRun(pool, { projectPath, command: 'rm -rf /', exitCode: 1 }),
    ).rejects.toThrow(TestCommandMismatchError);
  });

  it('accepts a command that is the configured command with extra scoping arguments appended', async () => {
    const { pool, inserted } = fakePool();
    const row = await recordTestRun(pool, {
      projectPath,
      command: 'npm test -- src/foo.test.ts',
      exitCode: 1,
    });
    expect(row.phase).toBe('red');
    expect(inserted).toHaveLength(1);
  });

  it('records a red phase on non-zero exit with no prior run required', async () => {
    const { pool } = fakePool([]);
    const row = await recordTestRun(pool, { projectPath, command: 'npm test', exitCode: 1 });
    expect(row.phase).toBe('red');
  });

  it('rejects a green result when the most recent prior run was not red', async () => {
    const { pool } = fakePool([{ phase: 'green', created_at: '2026-07-01T00:00:00.000Z' }]);
    await expect(
      recordTestRun(pool, { projectPath, command: 'npm test', exitCode: 0 }),
    ).rejects.toThrow(GreenWithoutRedError);
  });

  it('rejects a green result when there is no prior run at all', async () => {
    const { pool } = fakePool([]);
    await expect(
      recordTestRun(pool, { projectPath, command: 'npm test', exitCode: 0 }),
    ).rejects.toThrow(GreenWithoutRedError);
  });

  it('accepts a green result when the most recent prior run was red', async () => {
    const { pool } = fakePool([{ phase: 'red', created_at: '2026-07-01T00:00:00.000Z' }]);
    const row = await recordTestRun(pool, { projectPath, command: 'npm test', exitCode: 0 });
    expect(row.phase).toBe('green');
  });

  it('logs a decision alongside every recorded run', async () => {
    const { pool, decisions } = fakePool([]);
    await recordTestRun(pool, { projectPath, command: 'npm test', exitCode: 1 });
    expect(decisions).toHaveLength(1);
  });
});

describe('getLatestTestRun', () => {
  it('returns null when no run has been recorded for the project', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query } as unknown as Pool;
    expect(await getLatestTestRun(pool, '/fake/project')).toBeNull();
  });

  it('returns the most recent run row', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 3,
          project_path: '/fake/project',
          command: 'npm test',
          phase: 'red',
          exit_code: 1,
          created_at: '2026-07-02T00:00:00.000Z',
        },
      ],
    }));
    const pool = { query } as unknown as Pool;
    const row = await getLatestTestRun(pool, '/fake/project');
    expect(row?.phase).toBe('red');
  });
});
