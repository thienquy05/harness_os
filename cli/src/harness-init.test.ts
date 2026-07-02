import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

vi.mock('@harness-os/core', async () => {
  const actual = await vi.importActual<typeof import('@harness-os/core')>('@harness-os/core');
  return {
    ...actual,
    createPool: vi.fn(() => ({ end: vi.fn() })),
    verifyConfigIntegrity: vi.fn(async () => ({ ok: false, initialized: false, mismatches: [] })),
    recordVerifiedConfig: vi.fn(),
  };
});

function mockReadline(answer: string): void {
  vi.doMock('node:readline/promises', () => ({
    createInterface: vi.fn(() => ({ question: vi.fn(async () => answer), close: vi.fn() })),
  }));
}

describe('harness-init main', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'harness-os-init-'));
    vi.resetModules();
    const core = await import('@harness-os/core');
    vi.mocked(core.verifyConfigIntegrity).mockReset().mockResolvedValue({
      ok: false,
      initialized: false,
      mismatches: [],
    });
    vi.mocked(core.recordVerifiedConfig).mockReset().mockResolvedValue({ committed: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('exits 2 when --project-path is missing', async () => {
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main([], true);
    expect(code).toBe(2);
    errorSpy.mockRestore();
  });

  it('refuses to run without an interactive TTY', async () => {
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], false);
    expect(code).toBe(1);
    errorSpy.mockRestore();
  });

  it('refuses to re-initialize an already-initialized project', async () => {
    mockReadline('y');
    const core = await import('@harness-os/core');
    vi.mocked(core.verifyConfigIntegrity).mockResolvedValue({ ok: true, initialized: true, mismatches: [] });
    const { main } = await import('./harness-init.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(1);
    expect(core.recordVerifiedConfig).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('does nothing when the user declines the confirmation prompt', async () => {
    mockReadline('n');
    const core = await import('@harness-os/core');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(1);
    expect(core.recordVerifiedConfig).not.toHaveBeenCalled();
    await expect(readFile(join(projectPath, '.claude', 'settings.json'))).rejects.toThrow();
    logSpy.mockRestore();
  });

  it('scaffolds .claude/, stamps a stack-appropriate config, and records the verified baseline', async () => {
    mockReadline('y');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(projectPath, 'package.json'), JSON.stringify({ dependencies: { react: '1.0.0' } }));
    const core = await import('@harness-os/core');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath, '--prefix', 'APX'], true);
    expect(code).toBe(0);

    const settings = await readFile(join(projectPath, '.claude', 'settings.json'), 'utf-8');
    expect(settings).toContain('enforce-gate.sh');

    const hookScript = await readFile(join(projectPath, '.claude', 'hooks', 'enforce-gate.sh'), 'utf-8');
    expect(hookScript.length).toBeGreaterThan(0);

    const config = JSON.parse(await readFile(join(projectPath, '.claude', 'harness.config.json'), 'utf-8'));
    expect(config.specPrefix).toBe('APX');
    expect(config.gatedGlobs).toEqual(['src/**/*.ts', 'src/**/*.tsx']);

    const agents = await readFile(join(projectPath, '.claude', 'agents', 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('react-reviewer');
    expect(agents).toContain('typescript-reviewer');

    expect(core.recordVerifiedConfig).toHaveBeenCalledWith(expect.anything(), projectPath, expect.any(String));
    logSpy.mockRestore();
  });

  it('derives the prefix from the directory name when --prefix is omitted', async () => {
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(0);
    const config = JSON.parse(await readFile(join(projectPath, '.claude', 'harness.config.json'), 'utf-8'));
    expect(config.specPrefix.length).toBeGreaterThan(0);
    expect(config.specPrefix).toBe(config.specPrefix.toUpperCase());
    logSpy.mockRestore();
  });

  it('runs git init when the target is not already a git repository', async () => {
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(0);
    await expect(
      execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectPath }),
    ).resolves.toBeTruthy();
    logSpy.mockRestore();
  });

  it('does not error when the target is already a git repository', async () => {
    await execFileAsync('git', ['init'], { cwd: projectPath });
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(0);
    logSpy.mockRestore();
  });

  it('warns but still succeeds when recordVerifiedConfig could not commit (defensive, Open Item #22 sibling)', async () => {
    mockReadline('y');
    const core = await import('@harness-os/core');
    vi.mocked(core.recordVerifiedConfig).mockResolvedValue({ committed: false });
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('scaffold commit failed'));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('commits the full .claude/ scaffold, not just the CONST-CORE-004-tracked files', async () => {
    // Regression: recordVerifiedConfig only commits harness.config.json,
    // hooks/enforce-gate.sh, and settings.json — AGENTS.md and the other
    // three hook scripts were left permanently untracked until harness-init
    // added its own broader commit step.
    mockReadline('y');
    const { main } = await import('./harness-init.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', projectPath], true);
    expect(code).toBe(0);
    logSpy.mockRestore();

    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', '.claude'], {
      cwd: projectPath,
    });
    expect(stdout.trim()).toBe('');

    const { stdout: logOutput } = await execFileAsync('git', ['log', '--format=%s'], { cwd: projectPath });
    expect(logOutput).toContain('harness: initial project scaffold');
  });
});
