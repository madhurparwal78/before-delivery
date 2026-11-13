import { useEffect, useRef, useState } from "react";
import type { CaseKind, Order as OrderBody, OrderLine, OrderStatus, PaymentStatus } from "../../shared/api";
import { ORDER_STATUS_WORDS, PAYMENT_STATUS_WORDS, inr, longDate, shortDateTime } from "../../shared/format";
import { variantName } from "../components/BagContents";
import { CaseDialogs } from "../components/CaseDialogs";
import { Dialog } from "../components/Dialog";
import { Loading, ServerError } from "../components/Panel";
import { TotalsRegion } from "../components/TotalsRegion";
import { ApiFail, api } from "../lib/api";
import { useCountdown } from "../lib/countdown";
import { useLive, useLiveReset } from "../lib/live";
import { Link, navigate } from "../lib/router";
import { useData } from "../lib/useData";
import { NotFound } from "./NotFound";
import "../styles/shop.css";

const ORDER_TONE: Record<OrderStatus, string> = {
  placed: "tone-blue",
  packed: "tone-yellow",
  partially_shipped: "tone-yellow",
  shipped: "tone-teal",
  out_for_delivery: "tone-teal",
  delivered: "tone-teal",
  cancelled: "tone-red",
};

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  pending: "tone-yellow",
  authorized: "tone-yellow",
  captured: "tone-teal",
  partially_refunded: "tone-yellow",
  refunded: "tone-blue",
  failed: "tone-red",
};

function windowText(label: string, seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${label}: ${days} days ${hours} hours left`;
}

export function Order({ number = "" }: { number?: string }) {
  const { data: order, error, loading, reload, set } = useData<OrderBody>(`/api/orders/${number}`);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<{ kind: CaseKind; line: OrderLine } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [focusHeading, setFocusHeading] = useState(0);

  useLive("order", (event) => {
    if (event.number === number) void reload();
  });
  useLiveReset(() => void reload());

  useEffect(() => {
    if (error?.status === 401) navigate(`/sign-in?next=${encodeURIComponent(`/orders/${number}`)}`, { replace: true });
  }, [error, number]);

  useEffect(() => {
    if (focusHeading > 0) heading.current?.focus();
  }, [focusHeading]);

  const returnLeft = useCountdown(order?.return_window.open ? order.return_window.seconds_left : null, order?.server_time ?? null, () => void reload());
  const trialLeft = useCountdown(order?.trial_window.open ? order.trial_window.seconds_left : null, order?.server_time ?? null, () => void reload());

  if (loading && !order) return <Loading />;
  if (error?.status === 404) return <NotFound />;
  if (!order) return error?.status === 401 ? <Loading /> : <ServerError />;

  const cancellable = order.status === "placed" || order.status === "packed";

  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      set(await api.post<OrderBody>(`/api/orders/${number}/cancel`));
      setCancelOpen(false);
      setFocusHeading((n) => n + 1);
    } catch (failure) {
      setCancelOpen(false);
      setProblem(failure instanceof ApiFail ? failure.message : "Something went wrong on our side. Try again.");
    } finally {
      setCancelling(false);
    }
  };

  const open = (kind: CaseKind, line: OrderLine) => (event: { currentTarget: HTMLElement }) => {
    opener.current = event.currentTarget;
    setDialog({ kind, line });
  };

  const register = async (line: OrderLine) => {
    setProblem(null);
    try {
      await api.post("/api/warranty/registrations", { order_line_id: line.id });
      await reload();
    } catch (failure) {
      setProblem(failure instanceof ApiFail ? failure.message : "Something went wrong on our side. Try again.");
    }
  };

  const showTrial = order.lines.some((l) => l.trial_category);

  return (
    <div className="page order-page">
      <div className="axis">
        <div className="zone">
          {returnLeft !== null && <p>{windowText("Return window", returnLeft)}</p>}
          {showTrial && trialLeft !== null && <p>{windowText("Trial window", trialLeft)}</p>}
          <TotalsRegion totals={order.totals} label="Order totals" />
          {order.payment.card_last4 && <p className="muted">Card ending {order.payment.card_last4}</p>}
          {order.payment.refunded > 0 && <p className="muted">Refunded so far: {inr(order.payment.refunded)}</p>}
        </div>
        <div className="main">
          <h1 ref={heading} tabIndex={-1}>
            Order {order.number}
          </h1>
          <div className="status-row">
            <span role="status" aria-label="Order status" className={`block ${ORDER_TONE[order.status]}`}>
              {ORDER_STATUS_WORDS[order.status]}
            </span>
            <span role="status" aria-label="Payment status" className={`block ${PAYMENT_TONE[order.payment.status]}`}>
              {PAYMENT_STATUS_WORDS[order.payment.status]}
            </span>
          </div>
          {problem && (
            <div role="alert" className="notice tone-red">
              {problem}
            </div>
          )}
          {cancellable && (
            <p>
              <button
                type="button"
                className="btn"
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setCancelOpen(true);
                }}
              >
                Cancel order
              </button>
            </p>
          )}

          <h2>Timeline</h2>
          <ol role="list" aria-label="Order timeline" className="timeline">
            {order.timeline.map((item, i) => (
              <li key={`${item.status}-${i}`}>
                <span>{item.label}</span> <span className="muted">{shortDateTime(item.at)}</span>
              </li>
            ))}
          </ol>

          <h2>Items</h2>
          <ul className="order-lines">
            {order.lines.map((line) => (
              <li key={line.id}>
                <div role="group" aria-label={variantName(line)} className="order-line">
                  <p className="bag-line-name">{line.product}</p>
                  <p className="muted">
                    {line.colour}, {line.size} · SKU {line.sku} · Quantity {line.quantity} · {inr(line.line_subtotal - line.line_discount + line.line_tax)}
                  </p>
                  {line.shipment && (
                    <p>
                      {line.shipment.carrier} {line.shipment.tracking_number}
                    </p>
                  )}
                  <p>
                    <span className={`block ${line.fulfillment === "cancelled" ? "tone-red" : "tone-surface"}`}>{line.fulfillment.replace(/_/g, " ")}</span>
                  </p>
                  {line.warranty && <p>Covered until {longDate(line.warranty.covered_until)}</p>}
                  <div className="line-actions">
                    {line.return_eligible && (
                      <button type="button" className="btn" onClick={open("return", line)}>
                        Request return
                      </button>
                    )}
                    {line.trial_eligible && (
                      <button type="button" className="btn" onClick={open("trial", line)}>
                        Send back from trial
                      </button>
                    )}
                    {line.fulfillment === "delivered" && !line.warranty && (
                      <button type="button" className="btn" onClick={() => void register(line)}>
                        Register warranty
                      </button>
                    )}
                    {line.warranty && (
                      <button type="button" className="btn" onClick={open("claim", line)}>
                        Make a warranty claim
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p>
            <Link href="/account" className="btn">
              All orders
            </Link>
          </p>
        </div>
      </div>

      <CaseDialogs
        kind={dialog?.kind ?? null}
        line={dialog?.line ?? null}
        openerRef={opener}
        onClose={() => setDialog(null)}
        onCreated={() => void reload()}
      />
      <Dialog title="Cancel this order?" kind="alert" open={cancelOpen} onClose={() => setCancelOpen(false)} openerRef={opener}>
        <div className="cancel-dialog">
          <p>The order will be refunded in full to the card and gift card it was paid with, and the items go back on sale.</p>
          <div className="step-nav">
            <button type="button" className="btn btn-primary" data-autofocus onClick={() => setCancelOpen(false)}>
              Keep order
            </button>
            <button type="button" className="btn" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? "Cancelling" : "Yes, cancel order"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
