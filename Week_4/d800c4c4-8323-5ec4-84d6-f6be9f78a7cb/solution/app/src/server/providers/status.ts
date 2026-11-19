// Service status for storage and billing: any failed call marks the service down at once; probes bring it back.

type Service = "storage" | "billing";

/** A provider that could not be reached. Handlers turn it into their own outage copy. */
export class ProviderDown extends Error {}

const state: Record<Service, "up" | "down"> = { storage: "up", billing: "up" };
const listeners: Array<(service: Service) => void> = [];

export function serviceStatus(): Record<Service, "up" | "down"> {
  return { ...state };
}

export function onServiceUp(listener: (service: Service) => void): void {
  listeners.push(listener);
}

function mark(service: Service, value: "up" | "down"): void {
  const was = state[service];
  state[service] = value;
  if (was === "down" && value === "up") listeners.forEach((listener) => listener(service));
}

const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

/** Every provider HTTP call goes through here, so a network failure marks its service down. */
export async function providerFetch(service: Service, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    mark(service, "down");
    throw new ProviderDown(`${service} is unreachable`);
  }
  if (UNREACHABLE_STATUSES.has(response.status)) {
    mark(service, "down");
    throw new ProviderDown(`${service} is unreachable`);
  }
  mark(service, "up");
  return response;
}

/** Probes every 10 seconds while up and every second while down. */
export function startProbe(service: Service, probe: () => Promise<void>): void {
  const run = async () => {
    try {
      await probe();
    } catch {
      mark(service, "down");
    }
    setTimeout(run, state[service] === "up" ? 10_000 : 1_000).unref();
  };
  void run();
}
