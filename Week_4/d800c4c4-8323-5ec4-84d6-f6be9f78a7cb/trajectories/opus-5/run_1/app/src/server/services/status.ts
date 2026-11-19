import type { ServiceState, StatusRead } from '../../shared/types';
import { probeBilling } from './killbill';
import { probeStorage } from './storage';

const UP_INTERVAL = 10000;
const DOWN_INTERVAL = 1000;

class ServiceProbe {
  private state: ServiceState = 'up';
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly probe: () => Promise<void>) {}

  current(): ServiceState {
    return this.state;
  }

  markDown(): void {
    if (this.state !== 'down') {
      this.state = 'down';
      this.reschedule();
    }
  }

  markUp(): void {
    if (this.state !== 'up') {
      this.state = 'up';
      this.reschedule();
    }
  }

  start(): void {
    this.reschedule();
    void this.run();
  }

  private reschedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.run(),
      this.state === 'up' ? UP_INTERVAL : DOWN_INTERVAL,
    );
  }

  private async run(): Promise<void> {
    try {
      await this.probe();
      this.markUp();
    } catch {
      this.markDown();
    }
    this.reschedule();
  }
}

export const storageProbe = new ServiceProbe(probeStorage);
export const billingProbe = new ServiceProbe(probeBilling);

export function startServiceProbes(): void {
  storageProbe.start();
  billingProbe.start();
}

export function readServiceStatus(): StatusRead {
  return { storage: storageProbe.current(), billing: billingProbe.current() };
}
