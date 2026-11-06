import type { Config } from '../config.js';

// Plate registry stand-in served by WireMock. Every lookup is its own request.

export interface RegistryRecord {
  plate: string;
  country: string;
  model: string;
  firstAdmissionYear: number;
  roadClass: 25 | 45;
  plateColour: string;
  registeredMassKg: number;
}

export class RegistryError extends Error {
  constructor(public kind: 'unreachable' | 'not_found') {
    super(kind);
  }
}

export class Registry {
  constructor(private config: Config) {}

  async lookup(plate: string, country: string): Promise<RegistryRecord> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(
        `${this.config.wiremockUrl}/v1/plates/${encodeURIComponent(plate)}?country=${encodeURIComponent(country)}`,
        { signal: controller.signal },
      );
      if (res.status === 404) throw new RegistryError('not_found');
      if (res.status >= 500) throw new RegistryError('unreachable');
      if (res.status >= 400) throw new RegistryError('unreachable');
      return (await res.json()) as RegistryRecord;
    } catch (e) {
      if (e instanceof RegistryError) throw e;
      throw new RegistryError('unreachable');
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${this.config.wiremockUrl}/v1/plates/PROBE?country=NL`, { signal: controller.signal });
      return res.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
