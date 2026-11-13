import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { promiseText, rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import { useDesktop, useTitle } from "../../lib/hooks";
import type { SellerReturn } from "../seller/Returns";
import { PromiseDate, SellerLines, ShipTo, StatusChips, type SellerShipment } from "../seller/shipmentParts";
import { Failure, Loading, StaffGate, useResource } from "../seller/staff";
import "../../styles/support.css";

interface ShopperLine {
  line_id: string;
  title: string;
  quantity: number;
  unit_price_paise: number;
  line_total_paise: number;
  refunded_paise: number;
  refund_pending_paise: number;
}

interface ShopperShipment {
  state: string;
  timeline: { state: string; at: string }[];
  delivery_fee_paise: number;
  cod_fee_paise: number;
  gift_wrap_paise: number;
  lines: ShopperLine[];
}

interface Leg {
  method: string;
  amount_paise: number;
  refunded_paise: number;
  card_last4: string | null;
  card_network: string | null;
}

interface SupportOrder {
  order_id: string;
  shopper: { name: string; phone_masked: string };
  payment: { legs: Leg[] };
  shipments: { shipment_id: string; seller_name: string; state: string; shopper_view: ShopperShipment; seller_view: SellerShipment }[];
  returns: SellerReturn[];
}

type View = "shopper" | "seller";

const METHODS: Record<string, string> = { upi: "UPI", card: "card", netbanking: "net banking", emi: "card EMI", cod: "cash on delivery", balance: "Chauraha balance" };
const REASON_MAX = 500;
const REOPEN_NOTE = "Reopened by support after review.";

/** The calendar day in India of a stored instant, as `YYYY-MM-DD`. */
const dayOf = (at: string): string => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function RefundDialog({ line, onClose, onRefunded }: { line: ShopperLine; onClose: () => void; onRefunded: () => void }): ReactNode {
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [other, setOther] = useState("");
  const [refunded, setRefunded] = useState<number | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setProblems({});
    setOther("");
    try {
      const refund = await post<{ amount_paise: number }>(`/api/support/shipment-lines/${line.line_id}/refunds`, { quantity: /^\d{1,6}$/.test(quantity.trim()) ? Number(quantity.trim()) : quantity.trim(), reason });
      setRefunded(refund.amount_paise);
      onRefunded();
    } catch (error) {
      if (error instanceof ApiFailure && error.body.errors) setProblems(error.body.errors);
      else setOther(failureMessage(error));
    }
    setBusy(false);
  };

  return (
    <Dialog title="Refund line" onClose={onClose}>
      <p className="muted">{line.title}</p>
      {refunded === null ? (
        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="field">
            <label htmlFor="refund-quantity">Quantity to refund</label>
            <input id="refund-quantity" type="number" inputMode="numeric" step="1" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={problems.quantity ? true : undefined} aria-describedby={problems.quantity ? "refund-quantity-error" : undefined} />
            {problems.quantity && (
              <p className="field-error" id="refund-quantity-error">
                {problems.quantity}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="refund-reason">Reason</label>
            <textarea id="refund-reason" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={problems.reason ? true : undefined} aria-describedby={problems.reason ? "refund-reason-error" : undefined} />
            <span className={`counter${[...reason].length > REASON_MAX ? " counter--over" : ""}`}>
              {[...reason].length}/{REASON_MAX}
            </span>
            {problems.reason && (
              <p className="field-error" id="refund-reason-error">
                {problems.reason}
              </p>
            )}
          </div>
          {other && (
            <p className="field-error" role="alert">
              {other}
            </p>
          )}
          <div className="dialog__actions">
            <Button type="submit" variant="primary" busy={busy}>
              Confirm refund
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <div role="status" className="refund-result">
            <span className="chip chip--yellow">pending</span>
            <p className="bill amount">{rupees(refunded)}</p>
            <p>Refund of {rupees(refunded)} is on its way.</p>
          </div>
          <div className="dialog__actions">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function ShopperPanel({ view, onRefunded }: { view: ShopperShipment; onRefunded: () => void }): ReactNode {
  const [refunding, setRefunding] = useState<ShopperLine | null>(null);
  return (
    <>
      <ul className="timeline">
        {view.timeline.map((step) => (
          <li key={step.state}>
            <span className="chip">{step.state}</span> <span className="muted">{promiseText(dayOf(step.at))}</span>
          </li>
        ))}
      </ul>
      <ul className="lines">
        {view.lines.map((line) => (
          <li key={line.line_id} className="lines__block">
            <span className="lines__title">
              {line.title} <span className="muted">× {line.quantity}</span>
            </span>
            <span className="amount lines__amount">{rupees(line.line_total_paise)}</span>
            <span className="muted lines__note">{rupees(line.unit_price_paise)} each</span>
            {line.refunded_paise > 0 && <span className="lines__note">Refunded {rupees(line.refunded_paise)}.</span>}
            {line.refund_pending_paise > 0 && <span className="lines__note">Refund of {rupees(line.refund_pending_paise)} is on its way.</span>}
            <Button small variant="dark" className="lines__action" onClick={() => setRefunding(line)}>
              Refund {line.title}
            </Button>
          </li>
        ))}
      </ul>
      {(view.delivery_fee_paise > 0 || view.cod_fee_paise > 0 || view.gift_wrap_paise > 0) && (
        <dl className="fees">
          {view.delivery_fee_paise > 0 && (
            <div className="bill-line">
              <dt>Delivery</dt>
              <dd className="amount">{rupees(view.delivery_fee_paise)}</dd>
            </div>
          )}
          {view.cod_fee_paise > 0 && (
            <div className="bill-line">
              <dt>Cash on delivery fee</dt>
              <dd className="amount">{rupees(view.cod_fee_paise)}</dd>
            </div>
          )}
          {view.gift_wrap_paise > 0 && (
            <div className="bill-line">
              <dt>Gift wrap</dt>
              <dd className="amount">{rupees(view.gift_wrap_paise)}</dd>
            </div>
          )}
        </dl>
      )}
      {refunding && <RefundDialog line={refunding} onClose={() => setRefunding(null)} onRefunded={onRefunded} />}
    </>
  );
}

function ReturnRow({ item, onReopened }: { item: SellerReturn; onReopened: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const reopen = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      await post(`/api/support/returns/${item.return_id}/reopen`, { note: REOPEN_NOTE });
      onReopened();
    } catch (error) {
      setProblem(failureMessage(error));
    }
    setBusy(false);
  };

  return (
    <li className="return-row">
      <span className="lines__title">
        {item.title} <span className="muted">× {item.quantity}</span>
      </span>
      <span className={`chip ${item.state === "requested" ? "chip--yellow" : item.state === "picked" ? "chip--accent" : "chip--pink"}`}>{item.state}</span>
      {item.decline_reason && <span className="muted lines__note">Declined: {item.decline_reason}</span>}
      {item.state === "picked" && <span className="lines__note amount">{rupees(item.refund_paise)} refunded</span>}
      {item.state === "declined" && (
        <Button small busy={busy} variant="dark" onClick={() => void reopen()}>
          Reopen return
        </Button>
      )}
      {problem && (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}
    </li>
  );
}

const TABS: { view: View; label: string }[] = [
  { view: "shopper", label: "Shopper view" },
  { view: "seller", label: "Seller view" },
];

function Tabs({ view, onChange }: { view: View; onChange: (next: View) => void }): ReactNode {
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next: View = event.key === "ArrowRight" || event.key === "End" ? "seller" : "shopper";
    onChange(next);
    document.getElementById(`view-tab-${next}`)?.focus();
  };
  return (
    <div className="view-tabs" role="tablist" aria-label="Views" onKeyDown={move}>
      {TABS.map((tab) => (
        <button key={tab.view} id={`view-tab-${tab.view}`} type="button" role="tab" className="btn" aria-selected={view === tab.view} tabIndex={view === tab.view ? 0 : -1} onClick={() => onChange(tab.view)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function OrderPage({ id }: { id: string }): ReactNode {
  useTitle("order");
  const desktop = useDesktop();
  const [view, setView] = useState<View>("shopper");
  const { resource, reload } = useResource<SupportOrder>(`/api/support/orders/${encodeURIComponent(id)}`);
  if (resource.phase === "loading") return <Loading />;
  if (resource.phase === "failed") return <Failure status={resource.status} message={resource.message} />;
  const order = resource.data;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <h1>
          order <span className="keep-case">{order.order_id}</span>
        </h1>
        <p className="staff-value">
          {order.shopper.name}, {order.shopper.phone_masked}
        </p>
      </section>
      <section className="panel panel--yellow support-pay">
        <h2>payment</h2>
        <ul className="legs">
          {order.payment.legs.map((leg, index) => (
            <li key={`${leg.method}-${index}`} className="card card--black">
              <p className="bill">{METHODS[leg.method] ?? leg.method}</p>
              {leg.card_last4 && (
                <p className="muted">
                  {leg.card_network ? `${leg.card_network} ` : ""}card ending {leg.card_last4}
                </p>
              )}
              <p className="bill amount">{rupees(leg.amount_paise)}</p>
              <p className="muted">Refunded {rupees(leg.refunded_paise)}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel panel--black support-views">
        {!desktop && <Tabs view={view} onChange={setView} />}
        {order.shipments.map((shipment) => {
          const returns = order.returns.filter((item) => item.shipment_id === shipment.shipment_id);
          const shown: View[] = desktop ? ["shopper", "seller"] : [view];
          return (
            <section key={shipment.shipment_id} className="shipment-block" aria-label={`Shipment ${shipment.shipment_id}`}>
              <div className="shipment-block__head">
                <h2 className="keep-case">{shipment.shipment_id}</h2>
                <span className="muted">{shipment.seller_name}</span>
                <span className="chip">{shipment.state}</span>
              </div>
              <div className="views">
                {shown.map((name) => (
                  <div key={name} className="card view-panel" role={desktop ? undefined : "tabpanel"} aria-labelledby={desktop ? undefined : `view-tab-${name}`}>
                    {desktop && <h3>{name === "shopper" ? "Shopper view" : "Seller view"}</h3>}
                    {name === "shopper" ? (
                      <ShopperPanel view={shipment.shopper_view} onRefunded={reload} />
                    ) : (
                      <>
                        <StatusChips shipment={shipment.seller_view} />
                        <PromiseDate shipment={shipment.seller_view} />
                        <ShipTo shipment={shipment.seller_view} />
                        <SellerLines shipment={shipment.seller_view} />
                      </>
                    )}
                  </div>
                ))}
              </div>
              {returns.length > 0 && (
                <div className="card card--pink returns-block">
                  <h3>returns</h3>
                  <ul className="lines">
                    {returns.map((item) => (
                      <ReturnRow key={item.return_id} item={item} onReopened={reload} />
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </section>
    </>
  );
}

export default function Order(): ReactNode {
  const { id } = useParams();
  return <StaffGate role="support">{id === undefined ? null : <OrderPage key={id} id={id} />}</StaffGate>;
}
