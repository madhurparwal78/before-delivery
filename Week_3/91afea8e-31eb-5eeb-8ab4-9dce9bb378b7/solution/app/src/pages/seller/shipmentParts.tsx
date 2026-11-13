import type { ReactNode } from "react";
import { promiseText, rupees } from "../../../shared/format";

export interface SellerLine {
  line_id: string;
  listing_id: string;
  title: string;
  quantity: number;
  unit_price_paise: number;
  gross_paise: number;
}

export type ShipmentState = "placed" | "packed" | "shipped" | "delivered" | "cancelled";

/** The seller view of a shipment: exactly the keys the API publishes. */
export interface SellerShipment {
  shipment_id: string;
  order_id: string;
  state: ShipmentState;
  promise_date: string;
  ship_to: { name: string; city: string; pincode: string };
  payment_kind: "prepaid" | "cod";
  payment_status: "pending" | "paid" | "partially_refunded" | "refunded";
  invoice_status: "pending" | "ready";
  label_status: "pending" | "ready";
  lines: SellerLine[];
}

const PAYMENT: Record<SellerShipment["payment_status"], { text: string; tone: string }> = {
  pending: { text: "payment pending", tone: "chip--yellow" },
  paid: { text: "paid", tone: "chip--accent" },
  partially_refunded: { text: "partly refunded", tone: "chip--pink" },
  refunded: { text: "refunded", tone: "chip--pink" },
};

export function StatusChips({ shipment }: { shipment: SellerShipment }): ReactNode {
  const payment = PAYMENT[shipment.payment_status];
  return (
    <ul className="chips">
      <li>
        <span className="chip">{shipment.state}</span>
      </li>
      <li>
        <span className={`chip ${payment.tone}`}>{payment.text}</span>
      </li>
      <li>
        <span className={`chip ${shipment.invoice_status === "ready" ? "chip--accent" : "chip--yellow"}`}>invoice {shipment.invoice_status}</span>
      </li>
      <li>
        <span className={`chip ${shipment.label_status === "ready" ? "chip--accent" : "chip--yellow"}`}>label {shipment.label_status}</span>
      </li>
    </ul>
  );
}

export function ShipTo({ shipment }: { shipment: SellerShipment }): ReactNode {
  return (
    <div>
      <p className="staff-label">Ship to</p>
      <p className="staff-value">
        {shipment.ship_to.name}
        <br />
        {shipment.ship_to.city} {shipment.ship_to.pincode}
      </p>
    </div>
  );
}

export function SellerLines({ shipment }: { shipment: SellerShipment }): ReactNode {
  return (
    <ul className="lines">
      {shipment.lines.map((line) => (
        <li key={line.line_id}>
          <span className="lines__title">
            {line.title} <span className="muted">× {line.quantity}</span>
          </span>
          <span className="amount lines__amount">{rupees(line.gross_paise)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PromiseDate({ shipment }: { shipment: SellerShipment }): ReactNode {
  return <p className="muted">arrives by {promiseText(shipment.promise_date)}</p>;
}
