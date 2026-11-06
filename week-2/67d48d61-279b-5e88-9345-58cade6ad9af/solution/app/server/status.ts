// Reachability of the intake and plot storage. Every answer comes from a live call: the monitor
// checks both every 5 seconds, GET /api/status checks both when asked, and a failed call marks its
// service down at once. Each process broadcasts a status event when what it last saw changes.

import type { ServiceStatus } from "../shared/catalog.js";
import { broadcast } from "./events.js";

type Checks = Record<keyof ServiceStatus, () => Promise<boolean>>;

const seen: Partial<ServiceStatus> = {};
let checks: Checks;

export const markService = (name: keyof ServiceStatus, up: boolean): void => {
  const next = up ? "up" : "down";
  if (seen[name] === next) return;
  seen[name] = next;
  if (seen.intake && seen.plot_storage) broadcast("status", { intake: seen.intake, plot_storage: seen.plot_storage });
};

export const checkServices = async (): Promise<ServiceStatus> => {
  const [intake, plotStorage] = await Promise.all([checks.intake(), checks.plot_storage()]);
  markService("intake", intake);
  markService("plot_storage", plotStorage);
  return { intake: intake ? "up" : "down", plot_storage: plotStorage ? "up" : "down" };
};

export const monitor = (live: Checks): Promise<ServiceStatus> => {
  checks = live;
  setInterval(() => void checkServices(), 5000).unref();
  return checkServices();
};
