import { afterEach, describe, expect, it, vi } from 'vitest';

describe('gate-daemon main', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails fast with a clear message when the initial health query fails', async () => {
    const query = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.doMock('@harness-os/core', () => ({ createPool: vi.fn(() => ({ query, end: vi.fn() })) }));

    const { main } = await import('./gate-daemon.js');
    await expect(main()).rejects.toThrow('connection refused');
  });

  it('runs a health query at startup and schedules a heartbeat', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('@harness-os/core', () => ({
      createPool: vi.fn(() => ({ query, end: vi.fn().mockResolvedValue(undefined) })),
    }));

    // gate-daemon registers real SIGTERM/SIGINT handlers on the process it
    // runs in — inside the container that's fine, but inside the shared test
    // runner process it must not actually attach, or a signal meant for
    // vitest itself could trigger this module's shutdown path.
    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const { main } = await import('./gate-daemon.js');
    await main();

    expect(query).toHaveBeenCalledWith('SELECT 1');
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
  });
});
