import type { AppConfig } from './config.js';
import type { Store } from './store.js';
import { S3Client } from './s3.js';
import { smtpReachable } from './mail.js';

export type ServiceState = 'up' | 'down';

export interface ServiceStatus {
  services: { database: ServiceState; imageStore: ServiceState; mailRelay: ServiceState };
  checkedAt: string;
}

const PROBE_INTERVAL_MS = 4000;

export class Services {
  private readonly s3: S3Client;
  private lastChecked = new Date(0);
  private status: ServiceStatus = {
    services: { database: 'down', imageStore: 'down', mailRelay: 'down' },
    checkedAt: new Date(0).toISOString(),
  };
  private probing = false;

  constructor(
    private readonly cfg: AppConfig,
    private readonly store: Store
  ) {
    this.s3 = new S3Client(cfg.s3);
  }

  imageStore(): S3Client {
    return this.s3;
  }

  async probeAll(): Promise<void> {
    if (this.probing) return;
    this.probing = true;
    try {
      const [database, imageStore, mailRelay] = await Promise.all([
        this.probeDatabase(),
        this.s3.headBucket(),
        smtpReachable(this.cfg.smtp.host, this.cfg.smtp.port),
      ]);
      this.status = {
        services: { database, imageStore: imageStore ? 'up' : 'down', mailRelay: mailRelay ? 'up' : 'down' },
        checkedAt: new Date().toISOString(),
      };
      this.lastChecked = new Date();
    } finally {
      this.probing = false;
    }
  }

  private async probeDatabase(): Promise<ServiceState> {
    try {
      await this.store.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  /** Returns the latest probe, re-probing first if it has gone stale. */
  async current(): Promise<ServiceStatus> {
    if (Date.now() - this.lastChecked.getTime() >= PROBE_INTERVAL_MS) {
      await this.probeAll();
    }
    return this.status;
  }

  async databaseUp(): Promise<boolean> {
    return (await this.current()).services.database === 'up';
  }

  startProbing(): void {
    const tick = () => {
      this.probeAll().catch(() => undefined);
    };
    tick();
    setInterval(tick, PROBE_INTERVAL_MS).unref();
  }
}
