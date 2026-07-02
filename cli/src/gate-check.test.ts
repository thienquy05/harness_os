import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from './gate-check.js';

vi.mock('@harness-os/core', () => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
  checkGate: vi.fn(async () => ({ pass: true })),
}));

describe('parseArgs', () => {
  it('parses --project-path, --tool, --file', () => {
    const result = parseArgs(['--project-path', '/p', '--tool', 'Write', '--file', 'a.py']);
    expect(result).toEqual({ projectPath: '/p', tool: 'Write', filePath: 'a.py' });
  });

  it('leaves fields undefined when not provided', () => {
    expect(parseArgs([])).toEqual({});
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
});
