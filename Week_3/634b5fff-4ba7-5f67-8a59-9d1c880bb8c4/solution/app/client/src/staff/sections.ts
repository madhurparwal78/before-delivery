import type { ComponentType } from "react";
import type { Role } from "../../../shared/domain.js";
import { DeadLettersPage } from "./DeadLettersPage.js";
import { PackingPage } from "./PackingPage.js";
import { PlatesPage } from "./PlatesPage.js";
import { RatesPage } from "./RatesPage.js";
import { RefundsPage } from "./RefundsPage.js";
import { StatementsPage } from "./StatementsPage.js";

interface Section {
  path: string;
  title: string;
  role: Role;
  about: string;
  Page: ComponentType;
}

export const STAFF_HOME = "/staff";

/** Every staff page, the role that may use it, and the words that introduce it on the staff desk. */
export const SECTIONS: readonly Section[] = [
  { path: "/staff/packing", title: "Packing", role: "packer", about: "Pack paid boxes and return the sent-back ones to the shelf.", Page: PackingPage },
  { path: "/staff/dead-letters", title: "Dead letters", role: "packer", about: "Events that failed and wait for a person.", Page: DeadLettersPage },
  { path: "/staff/refunds", title: "Refunds", role: "treasurer", about: "Orders, their ledger and the refund form.", Page: RefundsPage },
  { path: "/staff/rates", title: "Rates", role: "treasurer", about: "The charity's share, past and scheduled.", Page: RatesPage },
  { path: "/staff/statements", title: "Statements", role: "treasurer", about: "Monthly statements, the charity endpoint and its deliveries.", Page: StatementsPage },
  { path: "/staff/plates", title: "Plates", role: "maker", about: "Art for the five plates and the stock count.", Page: PlatesPage },
];
