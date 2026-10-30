// The right ledger column: aligned figure rows per role (brief: Screens and layout → right ledger column).

import type { ReactNode } from "react";
import { LINK_STATUS_LABELS, orderStatusLabel, type AnyOrder, type User } from "../../shared/api.js";
import { humanDate, humanDateTime, money } from "../../shared/format.js";
import { Odometer } from "../Odometer.js";
import type { Shown } from "../strength.js";

function hives(count: number): string {
  return `${count.toLocaleString("en-US")} hives`;
}

export function StrengthLog({ notes }: { notes: string[] }) {
  return (
    <div className="strength-log">
      <h3>Strength changes</h3>
      <ol role="log" aria-label="Strength changes">
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ol>
    </div>
  );
}

export function PayableFigure({ shown, reduced }: { shown: Shown; reduced: boolean }) {
  return <Odometer kind="money" value={shown.payable} delay={shown.payableDelay} budget={shown.payableBudget} reduced={reduced} />;
}

interface LedgerProps {
  user: User;
  /** Null while the order is loading: the same rows hold their place so nothing below them moves. */
  order: AnyOrder | null;
  shown: Shown;
  notes: string[];
  reduced: boolean;
  /** The role's action buttons, under the ledger rows and the status line. */
  actions?: ReactNode;
  /** Lines under the actions (inspection link, report link). */
  footer?: ReactNode;
}

const LABELS: Record<User["role"], string[]> = {
  broker: ["Ordered", "Committed", "Delivered", "Deposit", "Payable", "Commission", "Beekeeper payouts"],
  grower: ["Ordered", "Delivered", "Deposit", "Payable"],
  beekeeper: ["Ordered", "Still open", "My committed", "My delivered", "My expected pay"],
};

function figures(order: AnyOrder, payable: ReactNode): ReactNode[] {
  if ("my_drops" in order) {
    const mine = order.my_drops;
    const pay = mine.map((drop) => drop.payout_cents).filter((cents): cents is number => cents !== null);
    return [
      hives(order.hives_ordered),
      hives(order.hives_remaining),
      hives(mine.reduce((sum, drop) => sum + drop.hives, 0)),
      hives(mine.filter((drop) => drop.status !== "committed").reduce((sum, drop) => sum + drop.hives, 0)),
      pay.length > 0 ? money(pay.reduce((sum, cents) => sum + cents, 0)) : <span className="muted">Not inspected yet</span>,
    ];
  }
  if ("commission_cents" in order) {
    return [
      hives(order.hives_ordered),
      hives(order.hives_committed),
      hives(order.hives_delivered),
      money(order.deposit_cents),
      payable,
      money(order.commission_cents),
      money(order.payable_cents - order.commission_cents),
    ];
  }
  return [hives(order.hives_ordered), hives(order.hives_delivered), money(order.deposit_cents), payable];
}

export function Ledger({ user, order, shown, notes, reduced, actions, footer }: LedgerProps) {
  const values = order ? figures(order, <PayableFigure shown={shown} reduced={reduced} />) : [];
  const settlement = order && "settlement_status" in order ? order.settlement_status : "none";
  return (
    <div className={`ledger-body${order ? "" : " is-placeholder"}`} aria-busy={order ? undefined : true}>
      <h2 className="ledger-title">
        <span className="ledger-ref">{order?.ref ?? "Order"}</span>
        <span className="ledger-sub">{order?.orchard.name ?? "Reading the ledger…"}</span>
      </h2>
      <p className="bloom-window">
        <span className="bloom-label">Bloom window</span>
        <span className="bloom-dates">{order ? `${humanDate(order.bloom_start)} to ${humanDate(order.bloom_end)}` : "—"}</span>
        <span className="deadline">{order ? `Deliver by ${humanDate(order.delivery_deadline)}` : "Deliver by —"}</span>
      </p>
      <table className="ledger-table" aria-label="Order ledger">
        <tbody>
          {LABELS[user.role].map((label, index) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{order ? values[index] : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="order-status">
        Order status: <span className="status-chip">{order ? orderStatusLabel(order.status, settlement) : "—"}</span>
      </p>
      {actions}
      {footer}
      {reduced ? <StrengthLog notes={notes} /> : null}
    </div>
  );
}

export function LinkStatus({ order }: { order: AnyOrder }) {
  const link = "inspection_link" in order ? order.inspection_link : null;
  return (
    <p className="link-status">
      <span>
        Inspection link: <strong>{link ? LINK_STATUS_LABELS[link.status] : "none sent"}</strong>
      </span>
      {link ? (
        <>
          <span className="muted link-email">{link.inspector_email}</span>
          <span className="muted">Expires {humanDateTime(new Date(link.expires_at))}</span>
        </>
      ) : null}
    </p>
  );
}
