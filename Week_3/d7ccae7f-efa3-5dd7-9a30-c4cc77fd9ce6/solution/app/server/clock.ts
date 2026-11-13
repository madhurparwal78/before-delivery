// The server's own monotonic clock: epoch milliseconds anchored once at start, advanced by the monotonic timer.
const epochAtStart = Date.now() - performance.now();

export function nowMs(): number {
  return Math.floor(epochAtStart + performance.now());
}
