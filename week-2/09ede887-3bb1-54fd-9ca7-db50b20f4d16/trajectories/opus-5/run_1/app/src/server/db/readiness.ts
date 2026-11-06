import type { Database } from './pool.js';
import { createSchemaAndSeed } from './seed.js';

const RETRY_MILLISECONDS = 2000;

/**
 * The app listens before PostgreSQL is reachable. This keeps trying to create
 * the schema and seed, and flips to ready without a restart once it succeeds.
 */
export class Readiness {
  private ready = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly database: Database) {}

  get isReady(): boolean {
    return this.ready;
  }

  start(): void {
    void this.attempt();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async attempt(): Promise<void> {
    try {
      await this.database.withClient(createSchemaAndSeed);
      await this.database.query('SELECT 1 FROM sessions LIMIT 1');
      this.ready = true;
      return;
    } catch {
      this.ready = false;
    }
    this.timer = setTimeout(() => void this.attempt(), RETRY_MILLISECONDS);
    this.timer.unref();
  }
}
