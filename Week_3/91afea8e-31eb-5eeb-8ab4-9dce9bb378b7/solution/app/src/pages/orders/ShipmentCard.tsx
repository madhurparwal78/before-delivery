import { Download, Undo2, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { promiseText, rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { BillLine, LineBill } from "../cart/BillLine";
import { CancelDialog } from "./CancelDialog";
import { dayOf, refundText, timeOf } from "./format";
import { ReturnDialog } from "./ReturnDialog";
import type { Refund, Shipment, ShipmentLine } from "./types";

interface Props {
  shipment: Shipment;
  refunds: Refund[];
  tone: "black" | "pink" | "yellow";
  /** After a change the order is read again; the message goes to `status "Order updates"`. */
  onChanged: (message: string | null) => void;
}

function RefundNotes({ refunds }: { refunds: Refund[] }): ReactNode {
  return (
    <>
      {refunds.map((refund, index) => (
        <p key={`${refund.status}-${index}`} className="ship-detail__refund">
          {refundText(refund)}
        </p>
      ))}
    </>
  );
}

export function ShipmentCard({ shipment, refunds, tone, onChanged }: Props): ReactNode {
  const [returning, setReturning] = useState<ShipmentLine | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancellable = shipment.state === "placed" || shipment.state === "packed";
  const delivered = shipment.state === "delivered";

  return (
    <section aria-label={`Shipment ${shipment.shipment_id}`} className={`card card--${tone} ship-detail`}>
      <div className="ship-detail__head">
        <h2 className="ship-card__seller">{shipment.seller_name}</h2>
        <span className="chip">{shipment.state}</span>
      </div>
      {shipment.promise_date && shipment.state !== "cancelled" && <p className="bill ship-detail__promise">arrives by {promiseText(shipment.promise_date)}</p>}
      <ol className="timeline" aria-label="Status timeline">
        {shipment.timeline.map((step) => (
          <li key={`${step.state}-${step.at}`}>
            <span className="chip">{step.state}</span>
            <time dateTime={step.at}>{timeOf(step.at)}</time>
          </li>
        ))}
      </ol>
      <ul className="ship-detail__lines">
        {shipment.lines.map((line) => (
          <li key={line.line_id} className="ship-line">
            <p className="ship-line__title">
              {line.title} <span className="muted">x {line.quantity}</span>
            </p>
            <p className="ship-line__price">
              <span className="amount">{rupees(line.unit_price_paise)}</span> each
            </p>
            <LineBill line={line} />
            <RefundNotes refunds={refunds.filter((refund) => refund.line_id === line.line_id)} />
            {delivered && (
              <Button small aria-label={`Return ${line.title}`} onClick={() => setReturning(line)}>
                <Undo2 size={18} aria-hidden="true" />
                return
              </Button>
            )}
            {line.returnable_until && delivered && <p className="ship-line__until">returns until {dayOf(line.returnable_until)}</p>}
          </li>
        ))}
      </ul>
      <div className="ship-detail__fees">
        <BillLine label="delivery" paise={shipment.delivery_fee_paise} />
        {shipment.gift_wrap_paise > 0 && <BillLine label="gift wrap" paise={shipment.gift_wrap_paise} />}
        {shipment.cod_fee_paise > 0 && <BillLine label="cash on delivery fee" paise={shipment.cod_fee_paise} />}
      </div>
      <RefundNotes refunds={refunds.filter((refund) => refund.line_id === null)} />
      <div className="ship-detail__actions">
        {shipment.invoice_status === "ready" ? (
          <a className="btn btn--small" href={`/api/shipments/${shipment.shipment_id}/invoice`} download>
            <Download size={18} aria-hidden="true" />
            Download invoice
          </a>
        ) : (
          <p className="ship-detail__pending">Your invoice is being prepared. Check back in a minute.</p>
        )}
        {cancellable && (
          <Button small onClick={() => setCancelling(true)}>
            <XCircle size={18} aria-hidden="true" />
            Cancel shipment
          </Button>
        )}
      </div>
      {returning && (
        <ReturnDialog
          line={returning}
          onClose={() => setReturning(null)}
          onRequested={(refundPaise) => onChanged(`Return requested. Refund on pickup: ${rupees(refundPaise)}.`)}
        />
      )}
      {cancelling && <CancelDialog shipment={shipment} onClose={() => setCancelling(false)} onCancelled={() => onChanged("Shipment cancelled.")} />}
    </section>
  );
}
