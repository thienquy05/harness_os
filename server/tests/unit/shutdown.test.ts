import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installShutdown } from '../../src/shutdown.js';

// mcp-serve runs as PID 1 in its container, where a signal without a handler is ignored: SIGTERM from
// `docker stop` or the sig-proxied client was a no-op and containers outlived their sessions.
function setup() {
  const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
  const stdin = new EventEmitter();
  const close = vi.fn(async () => {});
  installShutdown(close, proc as unknown as NodeJS.Process, stdin as unknown as NodeJS.ReadableStream);
  return { proc, stdin, close };
}

describe('installShutdown', () => {
  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'])('closes and exits 0 on %s', async (signal) => {
    const { proc, close } = setup();
    proc.emit(signal);
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes and exits 0 when the client closes stdin', async () => {
    const { proc, stdin, close } = setup();
    stdin.emit('end');
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('shuts down once even when several triggers arrive', async () => {
    const { proc, stdin, close } = setup();
    stdin.emit('end');
    proc.emit('SIGTERM');
    stdin.emit('close');
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalled());
    expect(close).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });

  it('still exits when closing hangs (a leaked pool client)', async () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    installShutdown(() => new Promise<void>(() => {}), proc as unknown as NodeJS.Process, new EventEmitter() as unknown as NodeJS.ReadableStream, 50);
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
  });

  it('still exits when closing fails', async () => {
    const proc = Object.assign(new EventEmitter(), { exit: vi.fn() });
    installShutdown(async () => { throw new Error('pool already ended'); }, proc as unknown as NodeJS.Process, new EventEmitter() as unknown as NodeJS.ReadableStream);
    proc.emit('SIGTERM');
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
  });
});
