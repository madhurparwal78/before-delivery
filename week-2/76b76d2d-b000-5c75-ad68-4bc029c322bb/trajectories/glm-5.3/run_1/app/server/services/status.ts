import type { Config } from '../config';
import { query } from './database';
import type { KillBillClient } from './killbill';

export interface ServiceStatus {
  billing: 'up' | 'down';
  mail: 'up' | 'down';
  checked_at: string;
}

/**
 * Tracks Kill Bill and mail reachability with 5-second probes, flipping the
 * cached flags at once on failure and on recovery.
 */
export class StatusService {
  private readonly cfg: Config;
  private readonly kb: KillBillClient;
  private readonly mailProbe: () => Promise<boolean>;
  private mailUp: boolean = false;
  private started = false;
  private probeTimer: NodeJS.Timeout | null = null;

  constructor(cfg: Config, kb: KillBillClient, mailProbe: () => Promise<boolean>) {
    this.cfg = cfg;
    this.kb = kb;
    this.mailProbe = mailProbe;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const run = () => {
      void this.probe();
      // Keys left in progress by a lost request are released after a minute.
      void query(`DELETE FROM idempotency WHERE state = 'in_progress' AND created_at < now() - interval '1 minute'`)
        .catch(() => undefined);
    };
    run();
    this.probeTimer = setInterval(run, 5000);
    this.probeTimer.unref();
  }

  async probe(): Promise<ServiceStatus> {
    const [billingUp, mailUp] = await Promise.all([
      this.kb.probe().then(h => h === 'up').catch(() => false),
      this.mailProbe().catch(() => false),
    ]);
    this.mailUp = mailUp;
    return {
      billing: this.kb.health,
      mail: mailUp ? 'up' : 'down',
      checked_at: new Date().toISOString(),
    };
  }

  status(): ServiceStatus {
    return {
      billing: this.kb.health,
      mail: this.mailUp ? 'up' : 'down',
      checked_at: new Date().toISOString(),
    };
  }

  get billingUp(): boolean { return this.kb.health === 'up'; }
  get mailUpNow(): boolean { return this.mailUp; }
}
