// Passenger states, their labels and their transitions (brief: Passenger states and transitions, Status labels).
import type { Accept, PassengerStatus, QueueList, StatusCode } from "../../shared/api.js";
import { berthTypeOf } from "./berths.js";

export const QUEUE_LISTS: QueueList[] = ["GNWL", "RLWL", "PQWL", "TQWL"];
export const GENERAL_LISTS: QueueList[] = ["GNWL", "RLWL", "PQWL"];

export interface StatusFields {
  status: StatusCode;
  position: number | null;
  coach: string | null;
  berth: number | null;
}

export function isQueue(status: StatusCode): status is QueueList {
  return (QUEUE_LISTS as StatusCode[]).includes(status);
}

/** CAN and CHART_NOT_CONFIRMED are final. */
export function isFinal(status: StatusCode): boolean {
  return status === "CAN" || status === "CHART_NOT_CONFIRMED";
}

/** At the chart instant every waiting-list passenger becomes CHART_NOT_CONFIRMED. */
export function atChart(fields: StatusFields): StatusFields {
  return isQueue(fields.status) ? { status: "CHART_NOT_CONFIRMED", position: null, coach: null, berth: null } : fields;
}

export function cancelled(): StatusFields {
  return { status: "CAN", position: null, coach: null, berth: null };
}

function labelOf(fields: StatusFields): string {
  switch (fields.status) {
    case "CNF":
      return `CNF ${fields.coach} ${fields.berth} ${berthTypeOf(fields.berth ?? 1)}`;
    case "RAC":
      return `RAC ${fields.position} ${fields.coach} ${fields.berth} SL`;
    case "CHART_NOT_CONFIRMED":
      return "NOT CNF";
    case "CAN":
    case "NOSB":
      return fields.status;
    default:
      return `${fields.status} ${fields.position}`;
  }
}

export function describe(fields: StatusFields): PassengerStatus {
  return {
    status: fields.status,
    position: fields.position,
    coach: fields.coach,
    berth: fields.berth,
    berth_type: fields.berth === null ? null : berthTypeOf(fields.berth),
    label: labelOf(fields),
  };
}

/** Statuses rank CNF best, then RAC, then any waiting list. */
export function acceptOf(status: StatusCode): Accept {
  if (status === "CNF") return "CNF";
  return status === "RAC" ? "RAC" : "WL";
}

const ACCEPT_RANK: Record<Accept, number> = { CNF: 0, RAC: 1, WL: 2 };

export function isWorse(status: Accept, accepted: Accept): boolean {
  return ACCEPT_RANK[status] > ACCEPT_RANK[accepted];
}

export function worst(statuses: Accept[]): Accept {
  return statuses.reduce<Accept>((a, b) => (ACCEPT_RANK[b] > ACCEPT_RANK[a] ? b : a), "CNF");
}

/** A move up: waiting list to RAC or CNF, or RAC to CNF. Renumbering alone is not a move up. */
export function movedUp(from: StatusCode, to: StatusCode): boolean {
  return (isQueue(from) && (to === "RAC" || to === "CNF")) || (from === "RAC" && to === "CNF");
}
