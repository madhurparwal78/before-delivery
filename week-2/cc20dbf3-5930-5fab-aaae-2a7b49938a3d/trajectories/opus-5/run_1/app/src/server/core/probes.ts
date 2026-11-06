import { PROBE_MAX_AGE_MS } from '../config.js';
import type { Billing } from '../services/billing.js';
import type { ObjectStore } from '../services/objectStore.js';

interface Probe {
  up: boolean;
  checkedAt: number;
  running: Promise<boolean> | null;
}

/** Reports each dependency from a probe no more than a few seconds old. */
export class ServiceProbes {
  private readonly billingProbe: Probe = { up: true, checkedAt: 0, running: null };
  private readonly storageProbe: Probe = { up: true, checkedAt: 0, running: null };

  constructor(
    private readonly billing: Billing,
    private readonly objectStore: ObjectStore,
  ) {}

  private async read(probe: Probe, check: () => Promise<boolean>): Promise<boolean> {
    const age = Date.now() - probe.checkedAt;
    if (age < PROBE_MAX_AGE_MS) return probe.up;
    if (probe.running === null) {
      probe.running = check()
        .then((up) => {
          probe.up = up;
          probe.checkedAt = Date.now();
          probe.running = null;
          return up;
        })
        .catch(() => {
          probe.up = false;
          probe.checkedAt = Date.now();
          probe.running = null;
          return false;
        });
    }
    return probe.running;
  }

  billingUp(): Promise<boolean> {
    return this.read(this.billingProbe, () => this.billing.probe());
  }

  photoStorageUp(): Promise<boolean> {
    return this.read(this.storageProbe, () => this.objectStore.probe());
  }

  /** A failure seen by a request is reflected at once, and never cached for long. */
  noteBillingDown(): void {
    this.billingProbe.up = false;
    this.billingProbe.checkedAt = Date.now();
  }

  notePhotoStorageDown(): void {
    this.storageProbe.up = false;
    this.storageProbe.checkedAt = Date.now();
  }
}
