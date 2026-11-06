/**
 * Re-read scheduler — periodic server reads per screen. Pauses while
 * Sign in again is open; the screen patch functions update values in place.
 */
export class Reread {
  private timer: number | null = null;
  private paused = false;
  private running = false;

  constructor(private read: () => Promise<void>, private intervalMs: number) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.paused || this.running) return;
    this.running = true;
    try {
      await this.read();
    } catch {
      // re-reads never disturb the screen
    } finally {
      this.running = false;
    }
  }
}
