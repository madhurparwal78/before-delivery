import { dollars, MONEY_LABELS } from "../../shared/money";
import type { Order } from "../../shared/types";

/** Subtotal without GST, the one GST line and the total, with figures aligned on their decimal points. */
export function Totals({ order }: { order: Pick<Order, "subtotal_cents" | "gst_cents" | "total_cents"> }) {
  return (
    <dl className="totals">
      <div className="totals__row">
        <dt>{MONEY_LABELS.subtotal}</dt>
        <dd className="mono">{dollars(order.subtotal_cents)}</dd>
      </div>
      <div className="totals__row">
        <dt>{MONEY_LABELS.gst}</dt>
        <dd className="mono">{dollars(order.gst_cents)}</dd>
      </div>
      <div className="totals__row totals__row--total">
        <dt>{MONEY_LABELS.total}</dt>
        <dd className="mono">{dollars(order.total_cents)}</dd>
      </div>
    </dl>
  );
}
