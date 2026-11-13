import type { Config } from '../config.js';

export class NtfyUnavailable extends Error {}

export class CrewAlerts {
  constructor(private cfg: Config) {}

  async available(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.ntfyUrl, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async post(title: string, body: string): Promise<void> {
    // Titles carry em dashes, which cannot travel in an HTTP header, so they
    // are passed as query parameters and the body as plain text.
    const params = new URLSearchParams({ title, tags: 'spindrift' });
    let res: Response;
    try {
      res = await fetch(`${this.cfg.ntfyUrl}/spindrift-crew?${params}`, {
        method: 'PUT',
        headers: {
          authorization: 'Basic ' + Buffer.from(`${this.cfg.ntfyUsername}:${this.cfg.ntfyPassword}`).toString('base64'),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new NtfyUnavailable('ntfy unreachable');
    }
    if (!res.ok) throw new NtfyUnavailable(`ntfy ${res.status}`);
  }
}
