export type ServiceName = 'billing' | 'storage';
export type ServiceState = 'up' | 'down';

const MAX_REPORT_AGE_MS = 5_000;

interface Observation {
  state: ServiceState;
  observedAt: number;
}

const observations = new Map<ServiceName, Observation>();
const probes = new Map<ServiceName, () => Promise<boolean>>();
const running = new Map<ServiceName, Promise<ServiceState>>();

/** Records what a real request just saw, so an outage shows at once. */
export function markService(name: ServiceName, state: ServiceState): void {
  observations.set(name, { state, observedAt: Date.now() });
}

export function registerProbe(name: ServiceName, probe: () => Promise<boolean>): void {
  probes.set(name, probe);
}

async function freshState(name: ServiceName): Promise<ServiceState> {
  const seen = observations.get(name);
  if (seen !== undefined && Date.now() - seen.observedAt < MAX_REPORT_AGE_MS) return seen.state;
  const inFlight = running.get(name);
  if (inFlight !== undefined) return inFlight;
  const probe = probes.get(name);
  if (probe === undefined) return 'down';
  const attempt = probe()
    .then((reachable): ServiceState => {
      const state: ServiceState = reachable ? 'up' : 'down';
      markService(name, state);
      return state;
    })
    .catch((): ServiceState => {
      markService(name, 'down');
      return 'down';
    })
    .finally(() => {
      running.delete(name);
    });
  running.set(name, attempt);
  return attempt;
}

export interface ServicesReport {
  billing: ServiceState;
  storage: ServiceState;
}

export async function servicesReport(): Promise<ServicesReport> {
  const [billing, storage] = await Promise.all([freshState('billing'), freshState('storage')]);
  return { billing, storage };
}
