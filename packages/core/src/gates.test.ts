import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordVerifiedConfig } from './config-integrity.js';
import { checkGate } from './gates.js';

const execFileAsync = promisify(execFile);

// `redFor`: the project paths whose latest recorded run is red (per checkout); otherwise every path
// answers `latestTestRunPhase`.
function fakePool(
  options: { latestTestRunPhase?: 'red' | 'green'; redFor?: Set<string> } = {},
): { pool: Pool; checksums: Map<string, string>; decisions: Array<Record<string, unknown>> } {
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
      if (text.includes('FROM test_runs') && options.redFor) {
        const red = options.redFor.has(params[0] as string);
        return { rows: red ? [{ id: 1, project_path: params[0], command: 'npm test', phase: 'red', exit_code: 1, created_at: 'now' }] : [] };
      }
      if (text.includes('FROM test_runs')) {
        return {
          rows: options.latestTestRunPhase
            ? [{ id: 1, project_path: params[0], command: 'npm test', phase: options.latestTestRunPhase, exit_code: 0, created_at: 'now' }]
            : [],
        };
      }
      throw new Error(`Unexpected query in fake pool: ${text}`);
    },
  } as unknown as Pool;
  return { pool, checksums, decisions };
}

async function seedProjectFiles(projectPath: string, harnessConfig = '{"gatedGlobs":[]}'): Promise<void> {
  const claudeDir = join(projectPath, '.claude');
  await mkdir(join(claudeDir, 'hooks'), { recursive: true });
  await writeFile(join(claudeDir, 'harness.config.json'), harnessConfig);
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

  it('passes a Write to a file matching gatedGlobs when the last recorded test run was red', async () => {
    const { pool } = fakePool({ latestTestRunPhase: 'red' });
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'src/foo.ts' });
    expect(result.pass).toBe(true);
  });

  it('blocks a Write to a file matching gatedGlobs with establish_red_phase when no test run has been recorded', async () => {
    const { pool } = fakePool({});
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'src/foo.ts' });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('establish_red_phase');
  });

  it('blocks a Write to a gatedGlobs file with establish_red_phase when the last recorded run was green', async () => {
    const { pool } = fakePool({ latestTestRunPhase: 'green' });
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'src/foo.ts' });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('establish_red_phase');
  });

  it('does not check test_runs at all for a file that does not match gatedGlobs', async () => {
    const { pool } = fakePool({});
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: 'docs/notes.md' });
    expect(result.pass).toBe(true);
  });

  // A Bash call whose write target parse-tool-call.mjs recognized (`>`, `sed -i`, `tee`) writes the
  // file just like Write/Edit, so it gets the same red-phase gate (Codex review, Vegenus 2026-10-29).
  it('applies the red-phase gate to a Bash call with a recognized gated write target', async () => {
    const { pool } = fakePool({});
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Bash', filePath: 'src/foo.ts' });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('establish_red_phase');
  });

  it('passes a Bash call with no recognized write target', async () => {
    const { pool } = fakePool({});
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    const result = await checkGate(pool, { projectPath, tool: 'Bash' });
    expect(result.pass).toBe(true);
  });

  it('blocks a Write given the absolute file path a real PreToolUse payload actually sends', async () => {
    const { pool } = fakePool({});
    await seedProjectFiles(projectPath, '{"gatedGlobs":["src/**/*.ts"]}');
    await recordVerifiedConfig(pool, projectPath, 'test-human');
    // Claude Code's real Write tool always sends tool_input.file_path as an
    // absolute path, never a path already relative to the project root —
    // every other test in this file uses a relative path for convenience,
    // which is exactly what let the real relativization bug through.
    const absoluteFilePath = join(projectPath, 'src', 'foo.ts');
    const result = await checkGate(pool, { projectPath, tool: 'Write', filePath: absoluteFilePath });
    expect(result.pass).toBe(false);
    expect(result.directive?.action).toBe('establish_red_phase');
  });
});

// Claude Code keeps worktrees at <main>/.claude/worktrees/<name>/ (checked 2026-11-18, Claude Code
// 2.1.327). Subagent isolation and EnterWorktree run the main checkout's hooks, `claude --worktree` the
// worktree's own copy. Either way a file is governed by the checkout it lies in, judged against that
// checkout's root and its own recorded RED; only that exact location counts as a worktree.
describe('checkGate across Claude Code worktrees', () => {
  let main: string;
  let worktree: string;
  let redFor: Set<string>;
  let pool: Pool;

  const gate = (projectPath: string, filePath: string) => checkGate(pool, { projectPath, tool: 'Write', filePath });

  beforeEach(async () => {
    main = await realpath(await mkdtemp(join(tmpdir(), 'harness-os-gates-wt-')));
    await seedProjectFiles(main, '{"gatedGlobs":["src/**/*.ts"]}');
    redFor = new Set();
    ({ pool } = fakePool({ redFor }));
    await execFileAsync('git', ['init', '-q'], { cwd: main });
    await recordVerifiedConfig(pool, main, 'test-human');
    worktree = join(main, '.claude', 'worktrees', 'w');
    await execFileAsync('git', ['worktree', 'add', '-q', worktree, '-b', 'w'], { cwd: main });
  });

  afterEach(async () => {
    await rm(main, { recursive: true, force: true });
  });

  it("gates a file in a worktree by that worktree's own RED, not the main checkout's", async () => {
    redFor.add(main);
    expect((await gate(main, join(worktree, 'src', 'a.ts'))).directive?.action).toBe('establish_red_phase');
    redFor.add(worktree);
    expect((await gate(main, join(worktree, 'src', 'a.ts'))).pass).toBe(true);
  });

  it("gates a main-checkout file written from a worktree session by the main checkout's RED", async () => {
    redFor.add(worktree);
    expect((await gate(worktree, join(main, 'src', 'a.ts'))).directive?.action).toBe('establish_red_phase');
    redFor.add(main);
    expect((await gate(worktree, join(main, 'src', 'a.ts'))).pass).toBe(true);
  });

  it('keeps gating src/ when a forged .git file makes src/ look like a worktree', async () => {
    await mkdir(join(main, 'fake'));
    await writeFile(join(main, 'fake', 'commondir'), `${join(main, '.git')}\n`);
    await writeFile(join(main, 'fake', 'gitdir'), `${join(main, 'src', '.git')}\n`);
    await mkdir(join(main, 'src'), { recursive: true });
    await writeFile(join(main, 'src', '.git'), `gitdir: ${join(main, 'fake')}\n`);
    redFor.add(join(main, 'src'));
    expect((await gate(main, join(main, 'src', 'foo.ts'))).directive?.action).toBe('establish_red_phase');
    expect((await gate(join(main, 'src'), join(main, 'src', 'foo.ts'))).pass).toBe(false);
  });
});
