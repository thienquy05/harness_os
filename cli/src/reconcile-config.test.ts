import { describe, expect, it, vi } from 'vitest';

vi.mock('@harness-os/core', () => ({
  createPool: vi.fn(() => ({ end: vi.fn() })),
  verifyConfigIntegrity: vi.fn(),
  recordVerifiedConfig: vi.fn(),
}));
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({ question: vi.fn(async () => 'y'), close: vi.fn() })),
}));

describe('reconcile-config main', () => {
  it('exits 2 when --project-path is missing', async () => {
    const { main } = await import('./reconcile-config.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main([], true);
    expect(code).toBe(2);
    errorSpy.mockRestore();
  });

  it('refuses to run without an interactive TTY', async () => {
    const { main } = await import('./reconcile-config.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--project-path', '/p'], false);
    expect(code).toBe(1);
    errorSpy.mockRestore();
  });

  it('reports no drift and does not write when already ok', async () => {
    const core = await import('@harness-os/core');
    vi.mocked(core.verifyConfigIntegrity).mockResolvedValue({ ok: true, initialized: true, mismatches: [] });
    const { main } = await import('./reconcile-config.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', '/p'], true);
    expect(code).toBe(0);
    expect(core.recordVerifiedConfig).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('re-verifies and trusts the current files after TTY confirmation on drift', async () => {
    const core = await import('@harness-os/core');
    vi.mocked(core.verifyConfigIntegrity).mockResolvedValue({
      ok: false,
      initialized: true,
      mismatches: ['hooks/enforce-gate.sh'],
    });
    vi.mocked(core.recordVerifiedConfig).mockResolvedValue({ committed: true });
    const { main } = await import('./reconcile-config.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['--project-path', '/p'], true);
    expect(code).toBe(0);
    expect(core.recordVerifiedConfig).toHaveBeenCalledWith(expect.anything(), '/p', expect.any(String));
    logSpy.mockRestore();
  });

  it('refuses to report success when the commit did not actually happen (Open Item #22)', async () => {
    // Regression: harness_gate_daemon's read-only mount means the commit
    // inside recordVerifiedConfig can fail even though the checksum row was
    // already inserted (Open Item #22). Silently printing "trusted" here
    // would hide that the project is now DB-trusted but not committed to
    // HEAD — one Bash call away from post-bash-revert.sh reverting the file
    // and then blocking every gated write, since the reverted content no
    // longer matches the new DB hash.
    const core = await import('@harness-os/core');
    vi.mocked(core.verifyConfigIntegrity).mockResolvedValue({
      ok: false,
      initialized: true,
      mismatches: ['hooks/enforce-gate.sh'],
    });
    vi.mocked(core.recordVerifiedConfig).mockResolvedValue({ committed: false });
    const { main } = await import('./reconcile-config.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--project-path', '/p'], true);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('git commit failed'));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
