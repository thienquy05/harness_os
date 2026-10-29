import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
  recordDecision: vi.fn(async () => ({ id: 1 })),
}));

describe('log-revert main', () => {
  it('exits 2 when --project-path or --file is missing', async () => {
    const { main } = await import('./log-revert.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['--project-path', '/p'])).toBe(2);
    errorSpy.mockRestore();
  });

  it('records a rejected CRITICAL decision for the reverted file', async () => {
    const core = await import('@harness-os/core');
    const { main } = await import('./log-revert.js');
    const code = await main(['--project-path', '/p', '--file', '.claude/hooks/enforce-gate.sh']);
    expect(code).toBe(0);
    expect(core.recordDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'revert_unauthorized_config_change',
        riskLevel: 'critical',
        status: 'rejected',
        projectPath: '/p',
      }),
    );
  });

  // A gated file written through Bash while the gate was closed is flagged, not reverted.
  it('records a flagged gated write with --kind gated', async () => {
    const core = await import('@harness-os/core');
    const { main } = await import('./log-revert.js');
    const code = await main(['--project-path', '/p', '--file', 'src/a.ts', '--kind', 'gated']);
    expect(code).toBe(0);
    expect(core.recordDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'flag_ungated_bash_write',
        status: 'rejected',
        constitutionRulesApplied: ['CONST-CORE-002'],
      }),
    );
  });
});
