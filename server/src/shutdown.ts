/**
 * mcp-serve runs as PID 1 in its container, where Node ignores any signal it has no handler for. Without
 * this, SIGTERM (docker stop, or the docker client proxying its own SIGTERM when Claude Code ends the
 * session) did nothing and the container outlived its session. Exit on any stop signal, and when the
 * client closes stdin, closing resources once.
 */
export function installShutdown(
  close: () => Promise<void>,
  proc: NodeJS.Process = process,
  stdin: NodeJS.ReadableStream = process.stdin,
  timeoutMs = 5000,
): void {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // A leaked pool client makes pool.end() wait forever; exit anyway after timeoutMs.
    const limit = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref());
    Promise.race([close().catch(() => {}), limit]).finally(() => proc.exit(0));
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) proc.on(signal, stop);
  stdin.on('end', stop);
  stdin.on('close', stop);
}
