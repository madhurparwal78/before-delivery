import type { ServiceView } from "../../shared/types";
import { broadcastToBookkeepers } from "./hub";

const reachable: ServiceView = { mail: true, pdf: true };

export const serviceView = (): ServiceView => ({ ...reachable });

let databaseUp = false;

export const setDatabaseUp = (up: boolean): void => {
  databaseUp = up;
};

/** True when Postgres, mail and the PDF service all answered at the last check. */
export const everythingAnswers = (): boolean => databaseUp && reachable.mail && reachable.pdf;

/** Records whether a provider answered; open bookkeeper screens hear about every change. */
export function markReachable(service: keyof ServiceView, up: boolean): void {
  if (reachable[service] === up) return;
  reachable[service] = up;
  broadcastToBookkeepers({ type: "services", services: serviceView() });
}
