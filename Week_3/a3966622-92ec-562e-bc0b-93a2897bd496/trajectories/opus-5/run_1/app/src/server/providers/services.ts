import type { BillingProvider } from './billing.ts';
import type { MailProvider } from './mail.ts';
import type { ObjectStore } from './objectstore.ts';

const MAX_AGE_MS = 15_000;
const REFRESH_MS = 10_000;

export type ServiceName = 'billing' | 'storage' | 'mail';
export type ServiceSnapshot = Record<ServiceName, 'up' | 'down'>;

/** Reports billing, storage and mail state separately, from a live check no older than 15 seconds. */
export class ServiceState {
  private readonly checks: Record<ServiceName, () => Promise<boolean>>;
  private state: ServiceSnapshot = { billing: 'down', storage: 'down', mail: 'down' };
  private checkedAt = 0;
  private running: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(billing: BillingProvider, objectStore: ObjectStore, mail: MailProvider) {
    this.checks = {
      billing: () => billing.check(),
      storage: () => objectStore.check(),
      mail: () => mail.check(),
    };
  }

  start(): void {
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref();
    void this.refresh();
  }

  async snapshot(): Promise<ServiceSnapshot> {
    if (Date.now() - this.checkedAt > MAX_AGE_MS) await this.refresh();
    return { ...this.state };
  }

  /** The last check's result, for steps that must not wait on a probe. */
  latest(): ServiceSnapshot {
    return { ...this.state };
  }

  private refresh(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = (async () => {
      const names: ServiceName[] = ['billing', 'storage', 'mail'];
      const results = await Promise.all(names.map((name) => this.checks[name]()));
      names.forEach((name, index) => {
        this.state[name] = results[index] === true ? 'up' : 'down';
      });
      this.checkedAt = Date.now();
      this.running = null;
    })();
    return this.running;
  }
}
