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

  it('does not unref the heartbeat timer, since it is the only thing keeping the daemon alive', async () => {
    // Regression, found via a real `docker compose up -d harness_gate_daemon`
    // fire: RestartCount climbed from 0 to 1 within 8 seconds even though
    // nothing crashed. `heartbeat.unref()` told Node not to count the
    // interval when deciding whether the event loop has more work — with no
    // server socket and no other ref'd handle, the event loop drained and
    // the process exited (code 0) almost immediately after startup. It only
    // looked like a persistent daemon because compose's `restart:
    // unless-stopped` kept resurrecting it every few seconds, undermining
    // the entire "warm container avoids docker run's cold-start" design
    // this file's own doc comment describes (§2.2).
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('@harness-os/core', () => ({
      createPool: vi.fn(() => ({ query, end: vi.fn().mockResolvedValue(undefined) })),
    }));
    vi.spyOn(process, 'on').mockImplementation(() => process);

    const fakeTimer = { unref: vi.fn(), ref: vi.fn() } as unknown as NodeJS.Timeout;
    vi.spyOn(global, 'setInterval').mockReturnValue(fakeTimer);

    const { main } = await import('./gate-daemon.js');
    await main();

    expect(fakeTimer.unref).not.toHaveBeenCalled();
  });
});
