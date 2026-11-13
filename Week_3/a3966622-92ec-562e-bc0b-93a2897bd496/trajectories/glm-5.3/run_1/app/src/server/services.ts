// Service state, checked live at most every 15 seconds. Charge, object and
// mail state in the source come from real provider calls and their
// confirmations.

import { KillBillClient } from './killbill.js';
import { MailClient } from './mail.js';
import { ObjectStore } from './objectstore.js';

export interface ServiceState {
  billing: 'up' | 'down';
  storage: 'up' | 'down';
  mail: 'up' | 'down';
}

export class Services {
  private lastCheckMs = 0;
  private cached: ServiceState = { billing: 'down', storage: 'down', mail: 'down' };
  private checking: Promise<ServiceState> | null = null;

  constructor(
    public readonly killbill: KillBillClient,
    public readonly objects: ObjectStore,
    public readonly mail: MailClient,
  ) {}

  // A live check no older than 15 seconds.
  async state(): Promise<ServiceState> {
    if (Date.now() - this.lastCheckMs < 15_000) return this.cached;
    if (this.checking) return this.checking;
    this.checking = this.refresh().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async refresh(): Promise<ServiceState> {
    const [billing, storage, mail] = await Promise.all([
      this.killbill.reachable(),
      this.objects.reachable(),
      this.mail.reachable(),
    ]);
    this.cached = {
      billing: billing ? 'up' : 'down',
      storage: storage ? 'up' : 'down',
      mail: mail ? 'up' : 'down',
    };
    this.lastCheckMs = Date.now();
    return this.cached;
  }
}
