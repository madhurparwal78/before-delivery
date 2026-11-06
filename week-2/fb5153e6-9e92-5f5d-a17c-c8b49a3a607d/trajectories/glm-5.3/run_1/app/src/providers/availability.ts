/** Tracks whether each provider is currently answering, so banners and 503s appear and vanish. */
export type ServiceName = 'database' | 'storage' | 'search' | 'billing' | 'mail';

export interface ServiceStatus {
  name: ServiceName;
  up: boolean;
  lastCheckAt: number;
  checking: Promise<boolean> | null;
}

const services = new Map<ServiceName, ServiceStatus>();

function entry(name: ServiceName): ServiceStatus {
  let existing = services.get(name);
  if (existing === undefined) {
    existing = { name, up: false, lastCheckAt: 0, checking: null };
    services.set(name, existing);
  }
  return existing;
}

export function markService(name: ServiceName, up: boolean): void {
  const svc = entry(name);
  svc.up = up;
  svc.lastCheckAt = Date.now();
}

export function serviceUp(name: ServiceName): boolean {
  return entry(name).up;
}

/** Runs a provider call, marks the service up or down from its outcome, and returns the result. */
export async function guard<T>(name: ServiceName, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    markService(name, true);
    return result;
  } catch (err) {
    if (!(err instanceof Error && isHttpError(err))) markService(name, false);
    throw err;
  }
}

function isHttpError(err: Error): boolean {
  // Provider protocol errors mean the service is reachable.
  const message = err.message.toLowerCase();
  return message.includes('status 4') || message.includes('status 5') || message.includes('status 2') || message.includes('status 3');
}

export async function checkOnce(name: ServiceName, fn: () => Promise<void>): Promise<boolean> {
  const svc = entry(name);
  if (svc.checking !== null) return svc.checking;
  svc.checking = (async () => {
    try {
      await fn();
      markService(name, true);
      return true;
    } catch {
      markService(name, false);
      return false;
    } finally {
      svc.checking = null;
    }
  })();
  return svc.checking;
}

export function serviceSnapshot(): Record<ServiceName, 'up' | 'down'> {
  return {
    database: services.get('database')?.up === true ? 'up' : 'down',
    storage: services.get('storage')?.up === true ? 'up' : 'down',
    search: services.get('search')?.up === true ? 'up' : 'down',
    billing: services.get('billing')?.up === true ? 'up' : 'down',
    mail: services.get('mail')?.up === true ? 'up' : 'down',
  };
}
