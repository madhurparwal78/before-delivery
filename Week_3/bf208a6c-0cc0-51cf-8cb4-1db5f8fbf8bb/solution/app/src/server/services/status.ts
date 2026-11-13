import type { Services } from "../../shared/types";

const state: Services = { storage: true, mail: true, push: true };
const listeners = new Set<(services: Services) => void>();

export const current = (): Services => ({ ...state });

export const onChange = (listener: (services: Services) => void): void => {
  listeners.add(listener);
};

/** Every call to a service reports here: a failed call marks it down, a good one marks it up. */
export function report(service: keyof Services, up: boolean): void {
  if (state[service] === up) return;
  state[service] = up;
  for (const listener of listeners) listener(current());
}
