import type { ServiceState, Status } from "../shared/api.js";
import { isoSeconds, now } from "./clock.js";

type Service = keyof Status["services"];

const state: Status["services"] = { search: "down", storage: "down", printing: "down" };

export function setService(service: Service, value: ServiceState): void {
  state[service] = value;
}

export function isUp(service: Service): boolean {
  return state[service] === "up";
}

/** This app copy's latest findings, as `GET /api/status` reports them. */
export function currentStatus(): Status {
  return { server_now: isoSeconds(now()), services: { ...state } };
}
