import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CardFields, EMPTY_CARD, type CardValue } from "../components/CardFields";
import { QuoteSheet } from "../components/QuoteSheet";
import { api, newKey, RequestError } from "../lib/api";
import { Link, navigate } from "../lib/router";
import { useSession } from "../session";
import { COPY, copyFor } from "../../shared/copy";
import { isCare, type Invoice, type Order, type User } from "../../shared/domain";
import { money, parseAmount, sharePercent } from "../../shared/money";
import { NotFound } from "./Missing";

interface AccountFields {
  businessName: string;
  name: string;
  email: string;
  password: string;
}

const EMPTY_ACCOUNT: AccountFields = { businessName: "", name: "", email: "", password: "" };

export function Checkout({ orderId }: { orderId: string }) {
  const { user, setUser } = useSession();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [balanceDue, setBalanceDue] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountFields>(EMPTY_ACCOUNT);
  const [terms, setTerms] = useState(false);
  const [acceptErrors, setAcceptErrors] = useState<Record<string, string>>({});
  const [accepting, setAccepting] = useState(false);
  const [card, setCard] = useState<CardValue>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [banner, setBanner] = useState("");
  const [status, setStatus] = useState("");
  const [focusCard, setFocusCard] = useState(false);
  const payKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const cardNumber = useRef<HTMLInputElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    api<Order>(`/api/orders/${encodeURIComponent(orderId)}`)
      .then(setOrder)
      .catch((error) => error instanceof RequestError && (error.status === 404 || error.status === 403) && setMissing(true));
  }, [orderId]);

  useEffect(() => {
    if (order?.state !== "balance_invoiced") return;
    api<{ invoices: Invoice[] }>("/api/invoices")
      .then(({ invoices }) => {
        const open = invoices.find((inv) => inv.orderId === order.id && inv.kind === "balance" && inv.status === "open");
        if (open) setBalanceDue(open.balance);
      })
      .catch(() => undefined);
  }, [order?.state, order?.id]);

  // A new message is brought into view beside the form that acted, without moving focus.
  useEffect(() => {
    if (status && status !== COPY.processing && status !== COPY.accepting) statusLine.current?.scrollIntoView({ block: "nearest" });
  }, [status]);

  useEffect(() => {
    if (focusCard) {
      cardNumber.current?.focus();
      setFocusCard(false);
    }
  }, [focusCard]);

  const figures = useMemo(
    () => (order ? { currency: order.currency, first: order.dueNow, second: order.dueAtLaunch, total: order.total, share: shareOf(order) } : null),
    [order],
  );

  if (missing) return <NotFound />;
  if (!order) {
    return (
      <section className="page">
        <h1>Checkout</h1>
        <p className="lede">Loading your order…</p>
      </section>
    );
  }

  const signedOut = !user;
  const payable = order.state === "accepted" || order.state === "balance_invoiced";
  const due = order.state === "balance_invoiced" ? (balanceDue ?? order.dueAtLaunch) : order.dueNow;

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    if (accepting) return;
    setAccepting(true);
    setAcceptErrors({});
    setBanner("");
    setStatus(COPY.accepting);
    try {
      const body = signedOut ? { ...account, acceptTerms: terms } : { acceptTerms: terms };
      const result = await api<{ order: Order; user: User }>(`/api/orders/${order.id}/accept`, { body });
      setOrder(result.order);
      setUser(result.user);
      setStatus(copyFor.accepted(money(result.order.total, result.order.currency)));
      setFocusCard(true);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      if (error.code === "quote_stale") {
        setOrder(error.body.order as Order);
        setStatus(COPY.priceChanged);
      } else if (error.status === 422) {
        setAcceptErrors(error.body.fields ?? {});
        setStatus("");
      } else if (error.code === "billing_unavailable") {
        setBanner(COPY.billingOutage);
        setStatus("");
      } else setStatus(error.body.message);
    } finally {
      setAccepting(false);
    }
  };

  const changeCard = (value: CardValue) => {
    setCard(value);
    payKey.current = null;
  };

  const pay = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || !payable) return;
    inFlight.current = true;
    setPaying(true);
    setCardErrors({});
    setBanner("");
    setStatus(COPY.processing);
    payKey.current ??= newKey();
    try {
      await api(`/api/orders/${order.id}/pay`, { body: { card }, key: payKey.current });
      payKey.current = null;
      navigate(`/orders/${order.id}/receipt`);
      window.scrollTo(0, 0);
      return;
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      setStatus("");
      if (error.code === "card_declined") setStatus(COPY.declined);
      else if (error.code === "billing_unavailable" || error.status === 0) setBanner(COPY.billingOutage);
      else if (error.code === "storage_unavailable") setBanner(COPY.storagePayOutage);
      else if (error.status === 422) setCardErrors(error.body.fields ?? {});
      else {
        setStatus(error.body.message);
        api<Order>(`/api/orders/${order.id}`).then(setOrder).catch(() => undefined);
      }
    } finally {
      inFlight.current = false;
      setPaying(false);
    }
  };

  const accountField = (name: keyof AccountFields, label: string, type: string, autoComplete: string) => (
    <div className="field">
      <label htmlFor={`accept-${name}`}>{label}</label>
      <input
        id={`accept-${name}`}
        type={type}
        autoComplete={autoComplete}
        value={account[name]}
        onChange={(e) => setAccount({ ...account, [name]: e.target.value })}
        aria-invalid={acceptErrors[name] ? true : undefined}
        aria-describedby={acceptErrors[name] ? `accept-${name}-error` : undefined}
      />
      {acceptErrors[name] ? <p id={`accept-${name}-error`} className="field-error">{acceptErrors[name]}</p> : null}
    </div>
  );

  return (
    <section className="page checkout">
      <p className="eyebrow">Checkout · <span className="mono">{order.number}</span></p>
      <h1>{order.state === "balance_invoiced" ? "Pay your launch balance" : "Accept and pay"}</h1>
      <div className="checkout__grid">
        <section aria-label="Order summary" className="checkout__summary">
          <h2 className="summary__plan">{order.planName}</h2>
          <p className="summary__currency">Billed in {order.currency}</p>
          <QuoteSheet state="ready" figures={figures} labels={["Due now", "Due at launch"]} outageCopy={COPY.quoteOutage} />
          <dl className="facts facts--money">
            <div>
              <dt>{isCare(order.plan) ? "First month, due now" : "Deposit, due now"}</dt>
              <dd className="mono">{money(order.dueNow, order.currency)}</dd>
            </div>
            <div>
              <dt>Due at launch</dt>
              <dd className="mono">{money(order.dueAtLaunch, order.currency)}</dd>
            </div>
          </dl>
        </section>
        <div className="checkout__forms">
          {banner ? (
            <p role="alert" className="banner banner--outage">
              <TriangleAlert aria-hidden="true" size={20} />
              {banner}
            </p>
          ) : null}
          <form aria-label="Accept quote" className="sheet-form" onSubmit={accept} noValidate>
            <h2 className="form-title">1. Accept the quote</h2>
            <fieldset disabled={order.state !== "quoted"}>
              {signedOut ? (
                <>
                  {accountField("businessName", "Business name", "text", "organization")}
                  {accountField("name", "Your name", "text", "name")}
                  {accountField("email", "Email", "email", "email")}
                  {accountField("password", "Password", "password", "new-password")}
                </>
              ) : null}
              <div className="field field--check">
                <input id="accept-terms" type="checkbox" checked={terms || order.state !== "quoted"} onChange={(e) => setTerms(e.target.checked)} />
                <label htmlFor="accept-terms">{COPY.acceptBox}</label>
              </div>
              {acceptErrors.acceptTerms ? <p className="field-error">{acceptErrors.acceptTerms}</p> : null}
              {acceptErrors.currency ? <p className="field-error">{acceptErrors.currency}</p> : null}
              <button type="submit" className="button button--primary" disabled={accepting}>
                Accept quote
              </button>
            </fieldset>
            {signedOut ? (
              <p className="form-aside">
                <Link href={`/sign-in?next=${encodeURIComponent(`/checkout/${order.id}`)}`}>Already a client? Sign in</Link>
              </p>
            ) : null}
          </form>
          <form aria-label="Payment" className="sheet-form" onSubmit={pay} noValidate>
            <h2 className="form-title">2. {order.state === "balance_invoiced" ? "Pay the launch balance" : "Pay"}</h2>
            <fieldset disabled={!payable}>
              <CardFields idPrefix="pay" value={card} errors={cardErrors} onChange={changeCard} ref={cardNumber} />
              <button type="submit" className={`button button--primary button--large${paying ? " is-busy" : ""}`} disabled={paying}>
                Pay {money(due, order.currency)}
              </button>
            </fieldset>
          </form>
          <p role="status" aria-label="Checkout status" className="live live--checkout" ref={statusLine}>{status}</p>
        </div>
      </div>
    </section>
  );
}

/** The sheet's crease for an order: its due-now share, by the one shared rule. */
function shareOf(order: Order): string {
  return sharePercent(parseAmount(order.dueNow)!, parseAmount(order.total)!);
}
