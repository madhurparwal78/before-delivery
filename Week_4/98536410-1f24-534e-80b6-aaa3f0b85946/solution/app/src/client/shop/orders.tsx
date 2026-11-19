import type { RefObject } from "react";
import { formatEuro } from "../lib/format";
import { ORDER_TRANSITIONS, type OrderStatus } from "../../shared/transitions";
import type { OrderRow } from "../types";

export interface RowAction {
  label: string;
  to: OrderStatus | "return";
}

const MOVE_LABELS: Record<OrderStatus, string> = {
  placed: "", picking: "Start picking", ready: "Mark ready", collected: "Hand over", cancelled: "Cancel",
};

/** The row actions an order offers: its legal moves in the published order, plus Start return once collected. */
function actionsFor(status: OrderStatus): RowAction[] {
  const moves = ORDER_TRANSITIONS[status].map((to): RowAction => ({ label: MOVE_LABELS[to], to }));
  return status === "collected" ? [...moves, { label: "Start return", to: "return" }] : moves;
}

export function OrdersTable({ orders, tableRef, onAct }: {
  orders: OrderRow[]; tableRef: RefObject<HTMLDivElement | null>; onAct: (order: OrderRow, action: RowAction, opener: HTMLElement) => void;
}) {
  return (
    <div className={`charcoal-panel scroll-x${orders.length === 0 ? " table-empty" : ""}`} ref={tableRef} role="table" aria-label="Orders" tabIndex={-1}>
      <div role="rowgroup">
        <div role="row" className="orow thead">
          {["Order", "Status", "Total", "Actions"].map((name) => <div key={name} role="columnheader">{name}</div>)}
        </div>
      </div>
      {orders.length === 0 ? <p className="table-blank">No orders yet.</p> : null}
      <div role="rowgroup">
        {orders.map((order) => (
          <div key={order.id} role="row" className="orow" data-order-id={order.id}>
            <div role="cell"><span className="strong">{order.number}</span><span className="small break">{order.customer_email}</span></div>
            <div role="cell"><span className="word">{order.status}</span></div>
            <div role="cell">{formatEuro(order.total_cents)}</div>
            <div role="cell" className="actions">
              {actionsFor(order.status).map((action) => (
                <button key={action.label} type="button" className="btn" aria-label={`${action.label} ${order.number}`} onClick={(event) => onAct(order, action, event.currentTarget)}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ReturnMemory {
  orderId: string;
  quantities: Record<string, string>;
  reason: string;
  focus: string | null;
  scroll: number;
}

export type { ReturnMemory };
