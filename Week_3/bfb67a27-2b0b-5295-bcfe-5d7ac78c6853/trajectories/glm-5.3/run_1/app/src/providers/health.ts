// Provider health with at most 10 seconds of caching (DP-37, DP-38).

import type { KillBillClient } from './killbill.js';
import type { StorageProvider } from './storage.js';
import type { Mailer } from './mail.js';

export interface ProviderStatus {
  payments: 'up' | 'down';
  storage: 'up' | 'down';
}

export class ProviderHealth {
  private cache: ProviderStatus | null = null;
  private cachedAt = 0;

  constructor(
    private readonly killbill: KillBillClient,
    private readonly storage: StorageProvider,
    private readonly mailer: Mailer,
  ) {}

  async status(): Promise<ProviderStatus> {
    const now = Date.now();
    if (this.cache !== null && now - this.cachedAt < 10000) {
      return this.cache;
    }
    const [payments, storage] = await Promise.all([this.killbill.probe(), this.storage.probe()]);
    const status: ProviderStatus = { payments: payments ? 'up' : 'down', storage: storage ? 'up' : 'down' };
    this.cache = status;
    this.cachedAt = now;
    return status;
  }

  markPaymentsDown(): void {
    if (this.cache !== null) {
      this.cache = { ...this.cache, payments: 'down' };
    }
  }

  markStorageDown(): void {
    if (this.cache !== null) {
      this.cache = { ...this.cache, storage: 'down' };
    }
  }

  mailDown(): Promise<boolean> {
    return this.mailer.probe();
  }
}
