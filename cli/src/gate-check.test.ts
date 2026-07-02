import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from './gate-check.js';

vi.mock('@harness-os/core', () => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
  checkGate: vi.fn(async () => ({ pass: true })),
  recordTestRun: vi.fn(async () => ({ id: 1, projectPath: '/p', command: 'npm test', phase: 'red', exitCode: 1 })),
  TestCommandMismatchError: class TestCommandMismatchError extends Error {},
  GreenWithoutRedError: class GreenWithoutRedError extends Error {},
}));

describe('parseArgs', () => {
  it('parses --project-path, --tool, --file', () => {
    const result = parseArgs(['--project-path', '/p', '--tool', 'Write', '--file', 'a.py']);
    expect(result).toEqual({ projectPath: '/p', tool: 'Write', filePath: 'a.py' });
  });

  it('leaves fields undefined when not provided', () => {
    expect(parseArgs([])).toEqual({});
  });

  it('parses --mode, --command, --exit-code', () => {
    const result = parseArgs([
      '--mode', 'record-test-run',
      '--project-path', '/p',
      '--command', 'npm test',
      '--exit-code', '1',
    ]);
    expect(result).toEqual({
      mode: 'record-test-run',
      projectPath: '/p',
      command: 'npm test',
      exitCode: 1,
    });
  });

  it('defaults mode to check when not provided', () => {
    expect(parseArgs(['--project-path', '/p', '--tool', 'Write']).mode).toBeUndefined();
  });
});

describe('gate-check main', () => {
  it('exits 2 with a usage error when --project-path or --tool is missing', async () => {
    const { main } = await import('./gate-check.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--tool', 'Write']);
    expect(code).toBe(2);
    errorSpy.mockRestore();
  });

  it('exits 0 and prints pass:true when checkGate passes', async () => {
    const { main } = await import('./gate-check.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', '/p', '--tool', 'Write']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ pass: true }));
    logSpy.mockRestore();
  });

  it('mode record-test-run: exits 2 with usage error when --command or --exit-code is missing', async () => {
    const { main } = await import('./gate-check.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--mode', 'record-test-run', '--project-path', '/p']);
    expect(code).toBe(2);
    errorSpy.mockRestore();
  });

  it('mode record-test-run: exits 0 and prints the recorded run on success', async () => {
    const { main, recordTestRun } = await import('./gate-check.js').then(async (m) => ({
      main: m.main,
      recordTestRun: (await import('@harness-os/core')).recordTestRun,
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main([
      '--mode', 'record-test-run',
      '--project-path', '/p',
      '--command', 'npm test',
      '--exit-code', '1',
    ]);
    expect(code).toBe(0);
    expect(recordTestRun).toHaveBeenCalledWith(expect.anything(), {
      projectPath: '/p',
      command: 'npm test',
      exitCode: 1,
    });
    logSpy.mockRestore();
  });
});
