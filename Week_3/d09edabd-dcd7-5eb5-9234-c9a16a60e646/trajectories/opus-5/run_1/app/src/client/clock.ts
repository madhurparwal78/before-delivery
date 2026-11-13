import { mmss } from '../shared/copy.js';

/**
 * The browser never works out time from its own date: it counts down from the
 * server's figure using the time elapsed since that response.
 */
export class ServerClock {
  private served = 0;
  private at = 0;
  private running = false;

  constructor(private readonly onTick: (text: string, seconds: number) => void) {
    window.setInterval(() => this.tick(), 500);
  }

  sync(remainingSeconds: number, running: boolean): void {
    this.served = remainingSeconds;
    this.at = performance.now();
    this.running = running;
    this.tick();
  }

  get seconds(): number {
    if (!this.running) return this.served;
    const elapsed = Math.floor((performance.now() - this.at) / 1000);
    return Math.max(0, this.served - elapsed);
  }

  private tick(): void {
    this.onTick(mmss(this.seconds), this.seconds);
  }
}

export class Cooldown {
  private served = 0;
  private at = 0;

  sync(seconds: number): void {
    this.served = seconds;
    this.at = performance.now();
  }

  get seconds(): number {
    const elapsed = Math.floor((performance.now() - this.at) / 1000);
    return Math.max(0, this.served - elapsed);
  }
}
