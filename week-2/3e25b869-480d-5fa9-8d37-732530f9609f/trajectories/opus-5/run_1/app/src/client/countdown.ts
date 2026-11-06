/** Hold timers read `m:ss` from the server's expiry and the server's own clock. */
export function formatCountdown(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export class ServerClock {
  private skewMs = 0;

  sync(serverNow: string): void {
    this.skewMs = new Date(serverNow).getTime() - Date.now();
  }

  now(): number {
    return Date.now() + this.skewMs;
  }

  remaining(expiresAt: string): number {
    return new Date(expiresAt).getTime() - this.now();
  }
}

export const serverClock = new ServerClock();
