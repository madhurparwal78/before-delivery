import { ApiError, fail } from '../http/errors.js';

const FAILURE_CACHE_MS = 5000;

/**
 * Guards work that needs an outside service. Each request tries afresh, and a failure is
 * remembered only briefly, so a service that comes back works again without a restart.
 */
export class ServiceGate {
  private closedUntil = 0;

  constructor(
    private readonly code: 'darkroom_closed' | 'post_office_closed',
    private readonly probe: () => Promise<void>,
  ) {}

  async use<T>(work: () => Promise<T>): Promise<T> {
    if (Date.now() < this.closedUntil) throw fail(this.code);
    try {
      return await work();
    } catch (fault) {
      if (fault instanceof ApiError) throw fault;
      this.closedUntil = Date.now() + FAILURE_CACHE_MS;
      throw fail(this.code);
    }
  }

  async isOpen(): Promise<boolean> {
    try {
      await this.use(this.probe);
      return true;
    } catch {
      return false;
    }
  }
}
