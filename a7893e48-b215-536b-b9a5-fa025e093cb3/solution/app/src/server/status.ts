export type ServiceState = "ok" | "delayed";

/** What this process last saw of each optional service; the probes re-check every five seconds. */
export const serviceStatus: { billing: ServiceState; mail: ServiceState } = { billing: "ok", mail: "ok" };
