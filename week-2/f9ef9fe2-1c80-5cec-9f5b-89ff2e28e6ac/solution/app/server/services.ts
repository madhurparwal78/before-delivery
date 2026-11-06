import { ApiError, refuse } from "./errors.js";

// Reachability of billing, file storage and mail. Probed at boot without waiting, then every 10 s;
// a failed real call marks its service down at once and a successful one marks it up.

type ServiceName = "billing" | "files" | "mail";
type Health = "up" | "down";

const health: Record<ServiceName, Health> = { billing: "up", files: "up", mail: "up" };

const PAUSES: Record<ServiceName, string[]> = {
  billing: ["confirm_booking", "create_series", "cancel_booking", "buy_pack"],
  files: ["upload_document", "view_document"],
  mail: ["confirm_booking", "create_series", "cancel_booking"],
};

const UNAVAILABLE: Record<ServiceName, () => ApiError> = {
  billing: refuse.billingUnavailable,
  files: refuse.filesUnavailable,
  mail: refuse.mailUnavailable,
};

function markUp(service: ServiceName): void {
  health[service] = "up";
}

function markDown(service: ServiceName): void {
  health[service] = "down";
}

export function isUp(service: ServiceName): boolean {
  return health[service] === "up";
}

/** Refuses with the service's 503 while it is reported down. */
export function requireUp(...services: ServiceName[]): void {
  for (const service of services) {
    if (!isUp(service)) throw UNAVAILABLE[service]();
  }
}

/** Runs a real call; a failure marks the service down and answers its 503. */
export async function reach<T>(service: ServiceName, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call();
    markUp(service);
    return result;
  } catch (error) {
    markDown(service);
    console.error(`${service} call failed: ${error instanceof Error ? error.name : "error"}`);
    throw UNAVAILABLE[service]();
  }
}

export function statusBody(): { services: Record<ServiceName, Health>; paused: string[] } {
  const paused = new Set<string>();
  for (const service of ["billing", "files", "mail"] as const) {
    if (health[service] === "down") PAUSES[service].forEach((action) => paused.add(action));
  }
  return { services: { ...health }, paused: [...paused] };
}

export function watchServices(probes: Record<ServiceName, () => Promise<void>>, onUp: () => void): void {
  const round = (): void => {
    for (const service of ["billing", "files", "mail"] as const) {
      probes[service]().then(
        () => {
          markUp(service);
          onUp();
        },
        () => markDown(service),
      );
    }
  };
  round();
  setInterval(round, 10_000).unref();
}
