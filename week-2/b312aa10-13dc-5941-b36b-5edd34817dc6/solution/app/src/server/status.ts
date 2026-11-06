// Reachability of Kill Bill and storage as last observed by this instance. A failed connection is
// never permanent: the monitor and every call keep trying the configured address.

type Service = "billing" | "storage";

const up: Record<Service, boolean> = { billing: false, storage: false };
const listeners: Array<(service: Service) => void> = [];

export function markService(service: Service, reachable: boolean): void {
  const wasDown = !up[service];
  up[service] = reachable;
  if (reachable && wasDown) for (const listener of listeners) listener(service);
}

export function serviceUp(service: Service): boolean {
  return up[service];
}

/** Called whenever a service comes back, so queued work starts at once. */
export function onServiceReturn(listener: (service: Service) => void): void {
  listeners.push(listener);
}
