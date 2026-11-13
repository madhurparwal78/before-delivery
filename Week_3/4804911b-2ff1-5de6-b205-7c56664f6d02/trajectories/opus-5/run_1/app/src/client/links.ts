import { failureOf, ok, request, type ApiResult } from './api.js';
import type { SignedLink } from './types.js';

export type LinkState =
  | { kind: 'none' }
  | { kind: 'link'; url: string; sha256: string }
  | { kind: 'expired' }
  | { kind: 'storage' }
  | { kind: 'print-failed' }
  | { kind: 'pending' };

const RENEW_AT_MS = 30_000;
const EXPIRE_AT_MS = 55_000;
const RETRY_MS = 5_000;

/**
 * Keeps one 60-second signed link fresh on a monotonic timer, never by comparing
 * wall clocks, so a wrong phone clock changes nothing.
 */
export class LinkKeeper {
  private sequence = 0;
  private mintedAt = 0;
  private timer: number | null = null;
  private state: LinkState = { kind: 'none' };
  private stopped = false;

  constructor(
    private readonly path: string,
    private readonly report: (state: LinkState) => void,
  ) {}

  start(): void {
    this.stopped = false;
    void this.mint();
    this.timer = window.setInterval(() => this.tick(), 1_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  current(): LinkState {
    return this.state;
  }

  private tick(): void {
    if (this.stopped) return;
    const age = performance.now() - this.mintedAt;
    if (this.state.kind === 'link' && age >= EXPIRE_AT_MS) {
      this.state = { kind: 'expired' };
      this.report(this.state);
      void this.mint();
      return;
    }
    if (this.state.kind === 'link' && age >= RENEW_AT_MS) {
      void this.mint();
      return;
    }
    if (this.state.kind !== 'link' && age >= RETRY_MS) {
      void this.mint();
    }
  }

  private async mint(): Promise<void> {
    this.sequence += 1;
    const mine = this.sequence;
    this.mintedAt = performance.now();
    let result: ApiResult<SignedLink>;
    try {
      result = await request<SignedLink>('GET', this.path);
    } catch {
      return;
    }
    if (mine !== this.sequence || this.stopped) return;
    if (ok(result)) {
      this.mintedAt = performance.now();
      this.state = { kind: 'link', url: result.body.url, sha256: result.body.sha256 };
      this.report(this.state);
      return;
    }
    const failure = failureOf(result);
    if (failure.error === 'storage_unavailable') this.state = { kind: 'storage' };
    else if (failure.error === 'print_unavailable') this.state = { kind: 'print-failed' };
    else if (failure.error === 'print_pending') this.state = { kind: 'pending' };
    else this.state = { kind: 'none' };
    this.report(this.state);
  }
}
