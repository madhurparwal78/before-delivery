import { Db } from './db.js';
import { config } from './config.js';
import { LiveHub } from './live.js';
import { setClockOffset } from './clock.js';

export interface SessionUser {
  id: string;
  display_name: string;
  email: string;
  role: string;
  company_slug: string | null;
  unlocked: boolean;
}

export class App {
  db: Db;
  live = new LiveHub();
  started = false;

  constructor() {
    const cfg = config();
    this.db = new Db(cfg.databaseUrl);
  }

  async loadClock(): Promise<void> {
    const row = await this.db.one<{ offset_ms: string | number }>(
      'select clock_offset_ms as offset_ms from app_clock where id = 1',
    );
    if (row) {
      const ms = typeof row.offset_ms === 'string' ? Number.parseInt(row.offset_ms, 10) : row.offset_ms;
      setClockOffset(ms);
    }
  }
}
