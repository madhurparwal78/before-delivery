import { useEffect, useState } from "react";
import { ERRORS, PAYMENT_COPY } from "../../../shared/copy.js";
import type { BoxState, PaymentState } from "../../../shared/domain.js";
import { formatDkk } from "../../../shared/money.js";
import { ApiFailure, get } from "../api.js";
import { Link, usePlace } from "../router.js";
import { Status } from "../ui.js";
import { LABELS, METHOD_WORDS, ORDER_BOX_WORDS } from "./copy.js";
import { orderToken, rememberOrderToken } from "./orderToken.js";
import { PublicSheet } from "./PublicSheet.js";

const POLL_MS = 1500;

interface OrderBody {
  number: number;
  plate: string;
  method: "card" | "bank";
  paymentState: PaymentState;
  boxState: BoxState | "held";
  totalOre: number;
  charityOre: number;
  transfer: { iban: string; paymentReference: string; amountOre: number; deadlineAt: string } | null;
  certificate: { state: "none" | "pending" | "issued" | "cancelled" };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-12-29T23:59:59+01:00" as "29 December 2026, 23:59 (UTC+01:00)": the Copenhagen time the server wrote, not the device's. */
const deadlineWords = (iso: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})[^+\-Z]*(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match) return iso;
  const [, year, month, day, hour, minute, offset] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}, ${hour}:${minute} (UTC${offset === "Z" ? "+00:00" : offset})`;
};

/** The published line for what the order's payment is doing. */
const paymentLine = (order: OrderBody): string => {
  if (order.paymentState === "voided" && order.boxState === "held") return ERRORS.authorised_too_late.message();
  if (order.paymentState === "lapsed") return PAYMENT_COPY.lapsed(order.number);
  return PAYMENT_COPY[order.paymentState];
};

const certificateLine = (order: OrderBody): string =>
  order.certificate.state === "pending"
    ? ERRORS.certificate_pending.message()
    : order.certificate.state === "cancelled"
      ? ERRORS.certificate_cancelled.message()
      : "";

export const OrderPage = ({ reference }: { reference: string }) => {
  const { search } = usePlace();
  const token = search.get("token") ?? orderToken(reference);
  const [order, setOrder] = useState<OrderBody | "missing" | null>(null);

  useEffect(() => {
    if (token === null) {
      setOrder("missing");
      return undefined;
    }
    rememberOrderToken(reference, token);
    let current = true;
    const load = async (): Promise<void> => {
      try {
        const { body } = await get<OrderBody>(`/api/orders/${reference}`, { "X-Order-Token": token });
        if (current) setOrder(body);
      } catch (failure) {
        if (current && failure instanceof ApiFailure && failure.status === 404) setOrder("missing");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [reference, token]);

  const loaded = order !== null && order !== "missing" ? order : null;
  const line = order === "missing" ? ERRORS.not_found.message() : loaded ? paymentLine(loaded) : "";

  return (
    <PublicSheet>
      <div className="receipt" data-motion="receipt">
        <h1>Order <span className="nowrap">{reference}</span></h1>
        <Status label={LABELS.order.payment} className="receipt__status">
          <span data-motion="payment-state" key={line}>{line}</span>
        </Status>
      </div>
      {loaded ? (
        <>
          <dl className="facts">
            <dt>Box</dt>
            <dd>{loaded.number}, {loaded.plate}</dd>
            <dt>Box state</dt>
            <dd>{ORDER_BOX_WORDS[loaded.boxState]}</dd>
            <dt>Payment method</dt>
            <dd>{METHOD_WORDS[loaded.method]}</dd>
            <dt>Total</dt>
            <dd>{formatDkk(loaded.totalOre)}</dd>
            <dt>Charity share</dt>
            <dd>{formatDkk(loaded.charityOre)}</dd>
          </dl>
          {loaded.transfer ? (
            <section aria-label="Transfer details" className="transfer">
              <h2>Transfer details</h2>
              <dl className="facts">
                <dt>IBAN</dt>
                <dd>{loaded.transfer.iban}</dd>
                <dt>Payment reference</dt>
                <dd>{loaded.transfer.paymentReference}</dd>
                <dt>Amount</dt>
                <dd>{formatDkk(loaded.transfer.amountOre)}</dd>
                <dt>Pay by</dt>
                <dd>{deadlineWords(loaded.transfer.deadlineAt)}</dd>
              </dl>
            </section>
          ) : null}
        </>
      ) : null}
      <Status label={LABELS.order.certificate} className="muted">{loaded ? certificateLine(loaded) : ""}</Status>
      {loaded?.paymentState === "authorised" ? <p className="muted">{LABELS.order.next}</p> : null}
      {loaded?.certificate.state === "issued" && token !== null ? (
        <p>
          <a className="btn btn--primary" href={`/api/orders/${reference}/certificate?token=${encodeURIComponent(token)}`}>
            {LABELS.order.download}
          </a>
        </p>
      ) : null}
      <p className="sheet__more"><Link href="/lookup">Find another order</Link></p>
    </PublicSheet>
  );
};
