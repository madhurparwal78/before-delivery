import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, AddressFields, Checkout as CheckoutBody, CheckoutStep, Order, ShippingMethod } from "../../shared/api";
import { inr } from "../../shared/format";
import { ADDRESS_KEYS, AddressFieldset, EMPTY_ADDRESS } from "../components/AddressFields";
import { variantName } from "../components/BagContents";
import { Choice, ErrorSummary, RadioGroup, TextField, focusField, sortKeys } from "../components/Fields";
import { CHECKOUT_STEPS, CheckoutProgress } from "../components/CheckoutProgress";
import { Loading, ServerError } from "../components/Panel";
import { TotalsRegion } from "../components/TotalsRegion";
import { ApiFail, api, newKey } from "../lib/api";
import { useCountdown } from "../lib/countdown";
import { Link, navigate } from "../lib/router";
import { refreshCart } from "../lib/store";
import { NotFound } from "./NotFound";
import "../styles/shop.css";


const FIELD_ORDER: Record<CheckoutStep, string[]> = {
  contact: ["email", "phone"],
  delivery: ["address_id", ...ADDRESS_KEYS.map((k) => `address.${k}`)],
  shipping: ["method", "gift_message"],
  payment: ["card.number", "card.expiry", "card.cvc"],
};

const HOLD_ENDED = "Your hold has ended and the items went back on sale. Press Pay to hold them again.";

interface PayAlert {
  code: string;
  message: string;
}

export function Checkout({ id = "" }: { id?: string }) {
  const [checkout, setCheckout] = useState<CheckoutBody | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [addresses, setAddresses] = useState<Address[]>([]);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [choice, setChoice] = useState<string | null>(null);
  const [fresh, setFresh] = useState<AddressFields>(EMPTY_ADDRESS);
  const [method, setMethod] = useState<ShippingMethod>("standard");
  const [gift, setGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "" });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payAlert, setPayAlert] = useState<PayAlert | null>(null);
  const [soldOut, setSoldOut] = useState<string[]>([]);
  const [placed, setPlaced] = useState<{ number: string; email: string } | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const payLock = useRef(false);
  const focusCount = useRef(0);
  const [focusKey, setFocusKey] = useState<{ key: string; n: number } | null>(null);
  const key = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<CheckoutBody | null> => {
    try {
      const body = await api.get<CheckoutBody>(`/api/checkout/${id}`);
      setCheckout(body);
      setState("ok");
      return body;
    } catch (failure) {
      if (failure instanceof ApiFail && failure.status === 401) {
        navigate(`/sign-in?next=${encodeURIComponent(`/checkout/${id}`)}`, { replace: true });
      } else if (failure instanceof ApiFail && failure.status === 404) {
        setState("missing");
      } else {
        setState("error");
      }
      return null;
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    api.get<Address[]>("/api/addresses").then(setAddresses, () => setAddresses([]));
  }, [refresh]);

  const step = checkout?.step;
  const checkoutId = checkout?.id;
  useEffect(() => {
    if (!checkout) return;
    setEmail(checkout.contact?.email ?? "");
    setPhone(checkout.contact?.phone ?? "");
    setChoice(checkout.delivery ? (checkout.delivery.address_id ?? "new") : null);
    setFresh(checkout.delivery && !checkout.delivery.address_id ? checkout.delivery.address : EMPTY_ADDRESS);
    setMethod(checkout.shipping_method);
    setGift(checkout.gift);
    setGiftMessage(checkout.gift_message);
    setErrors({});
  }, [checkoutId, step]);

  useEffect(() => {
    if (moved.current && heading.current) {
      heading.current.focus();
      moved.current = false;
    }
  }, [step]);

  useEffect(() => {
    if (focusKey) focusField(focusKey.key);
  }, [focusKey]);

  useEffect(() => {
    if (payAlert) alertBox.current?.focus();
  }, [payAlert]);

  useEffect(() => {
    if (placed) confirmation.current?.focus();
  }, [placed]);

  const holdSeconds = checkout?.hold.status === "active" ? checkout.hold.seconds_left : null;
  const left = useCountdown(holdSeconds, checkout?.server_time ?? null, () => void refresh());

  const failWith = (failure: unknown, current: CheckoutStep): void => {
    if (failure instanceof ApiFail && failure.status === 422 && failure.body.fields) {
      setErrors(failure.body.fields);
      const first = sortKeys(failure.body.fields, FIELD_ORDER[current])[0];
      if (first) {
        focusCount.current += 1;
        setFocusKey({ key: first, n: focusCount.current });
      }
      return;
    }
    if (failure instanceof ApiFail && failure.status === 401) {
      navigate(`/sign-in?next=${encodeURIComponent(`/checkout/${id}`)}`, { replace: true });
      return;
    }
    setPayAlert(failure instanceof ApiFail ? { code: failure.code, message: failure.message } : { code: "server_error", message: "Something went wrong on our side. Try again." });
  };

  const send = async (body: Record<string, unknown>, current: CheckoutStep) => {
    if (pending) return;
    setPending(true);
    setErrors({});
    setPayAlert(null);
    try {
      const next = await api.patch<CheckoutBody>(`/api/checkout/${id}`, body);
      moved.current = true;
      setCheckout(next);
      if (body.step === "shipping") void refreshCart();
    } catch (failure) {
      failWith(failure, current);
    } finally {
      setPending(false);
    }
  };

  const back = () => {
    const index = CHECKOUT_STEPS.findIndex((s) => s.step === step);
    const previous = CHECKOUT_STEPS[index - 1];
    if (previous) void send({ step: previous.step, go: true }, previous.step);
  };

  const submitCurrent = () => {
    if (!checkout) return;
    if (checkout.step === "contact") void send({ step: "contact", email, phone }, "contact");
    else if (checkout.step === "delivery") {
      const chosen = choice ?? addresses[0]?.id ?? "new";
      void send(chosen === "new" ? { step: "delivery", address: fresh } : { step: "delivery", address_id: chosen }, "delivery");
    } else if (checkout.step === "shipping") void send({ step: "shipping", method, gift, gift_message: gift ? giftMessage : "" }, "shipping");
  };

  const pay = async () => {
    if (payLock.current || !checkout) return;
    payLock.current = true;
    setPaying(true);
    setPayAlert(null);
    setErrors({});
    try {
      await api.post(`/api/checkout/${id}/reserve`);
      const latest = (await refresh()) ?? checkout;
      const total = latest.totals.total;
      key.current ??= newKey();
      const order = await api.post<Order>("/api/orders", { checkout_id: id, ...(total > 0 ? { card } : {}) }, key.current);
      setPlaced({ number: order.number, email: order.email ?? latest.contact?.email ?? "" });
      void refreshCart();
    } catch (failure) {
      if (failure instanceof ApiFail && failure.code === "out_of_stock" && failure.body.sku) {
        const sku = failure.body.sku;
        setSoldOut((list) => [...list, sku]);
      }
      failWith(failure, "payment");
      if (!(failure instanceof ApiFail && failure.status === 422)) void refresh();
    } finally {
      payLock.current = false;
      setPaying(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="page checkout">
        <CheckoutProgress />
        <div className="co-main">
          <Loading />
        </div>
      </div>
    );
  }
  if (state === "missing") return <NotFound />;
  if (state === "error" || !checkout) return <ServerError />;

  const index = CHECKOUT_STEPS.findIndex((s) => s.step === checkout.step);
  const current = CHECKOUT_STEPS[index] ?? CHECKOUT_STEPS[0]!;
  const minute = left !== null && left > 0 && left <= 60;
  const total = checkout.totals.total;
  const showExpired = checkout.hold.status === "expired" && payAlert?.code !== "reservation_expired" && !placed;
  const setCardField = (name: "number" | "expiry" | "cvc") => (value: string) => {
    key.current = null;
    setCard((c) => ({ ...c, [name]: value }));
  };

  return (
    <div className="page checkout">
      <CheckoutProgress current={current.step} finished={Boolean(placed)} />

      <div className="co-main">
        <div className="co-status">
          <p role="status" aria-label="Checkout updates">
            Step {index + 1} of 4: {current.name}
            {minute && <> One minute left on your hold.</>}
          </p>
          {left !== null && !placed && (
            <p role="timer" aria-label="Hold time left" className="hold-timer">
              Held for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
            </p>
          )}
        </div>

        {showExpired && (
          <div role="alert" className="notice tone-red" tabIndex={-1}>
            {HOLD_ENDED}
          </div>
        )}
        {payAlert && (
          <div role="alert" className="notice tone-red" ref={alertBox} tabIndex={-1}>
            {payAlert.message}
          </div>
        )}

        {placed ? (
          <section className="confirmation">
            <h1 ref={confirmation} tabIndex={-1}>
              Thank you — order {placed.number} is placed.
            </h1>
            <p>Confirmation emailed to {placed.email}.</p>
            <p>
              <Link href={`/orders/${placed.number}`} className="btn btn-primary">
                View order
              </Link>
            </p>
          </section>
        ) : (
          <form
            className="co-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (checkout.step === "payment") void pay();
              else submitCurrent();
            }}
          >
            <ErrorSummary errors={errors} order={FIELD_ORDER[current.step]} />
            <h2 ref={heading} tabIndex={-1}>
              {current.name}
            </h2>

            {checkout.step === "contact" && (
              <>
                <TextField name="email" label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} error={errors.email} />
                <TextField name="phone" label="Mobile number" type="tel" autoComplete="tel" inputMode="numeric" value={phone} onChange={setPhone} error={errors.phone} />
              </>
            )}

            {checkout.step === "delivery" && (
              <>
                <RadioGroup name="address_id" label="Saved addresses" error={errors.address_id}>
                  {addresses.map((a) => (
                    <Choice key={a.id} name="delivery" value={a.id} label={a.label} checked={(choice ?? addresses[0]?.id) === a.id} onChange={() => setChoice(a.id)} />
                  ))}
                  <Choice name="delivery" value="new" label="New address" checked={(choice ?? addresses[0]?.id ?? "new") === "new"} onChange={() => setChoice("new")} />
                </RadioGroup>
                {(choice ?? addresses[0]?.id ?? "new") === "new" && <AddressFieldset prefix="address." value={fresh} onChange={setFresh} errors={errors} />}
              </>
            )}

            {checkout.step === "shipping" && (
              <>
                <RadioGroup name="method" label="Shipping method" error={errors.method}>
                  <Choice name="method" value="standard" label="Standard" checked={method === "standard"} onChange={() => setMethod("standard")} />
                  <Choice name="method" value="express" label="Express" checked={method === "express"} onChange={() => setMethod("express")} />
                </RadioGroup>
                <label className="choice">
                  <input type="checkbox" checked={gift} onChange={(event) => setGift(event.target.checked)} />
                  <span>This is a gift</span>
                </label>
                {gift && <TextField name="gift_message" label="Gift message" value={giftMessage} onChange={setGiftMessage} error={errors.gift_message} />}
              </>
            )}

            {checkout.step === "payment" && total > 0 && (
              <>
                <TextField name="card.number" label="Card number" autoComplete="cc-number" inputMode="numeric" value={card.number} onChange={setCardField("number")} error={errors["card.number"]} />
                <TextField name="card.expiry" label="Expiry (MM/YY)" autoComplete="cc-exp" inputMode="numeric" value={card.expiry} onChange={setCardField("expiry")} error={errors["card.expiry"]} />
                <TextField name="card.cvc" label="Security code" autoComplete="cc-csc" inputMode="numeric" value={card.cvc} onChange={setCardField("cvc")} error={errors["card.cvc"]} />
              </>
            )}

            <div className="step-nav">
              {index > 0 && (
                <button type="button" className="btn" disabled={pending || paying} onClick={back}>
                  Back
                </button>
              )}
              {checkout.step === "payment" ? (
                <button type="submit" className="btn btn-primary" disabled={paying}>
                  {paying ? "Paying" : `Pay ${inr(total)}`}
                </button>
              ) : (
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Checking" : "Continue"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      <section className="co-summary" aria-label="Order summary">
        <h3>Your order</h3>
        <ul className="summary-lines">
          {checkout.lines.map((line) => (
            <li key={line.id}>
              <p>
                {variantName(line)} × {line.quantity}
              </p>
              <p className="muted">{inr(line.line_subtotal)}</p>
              {(soldOut.includes(line.sku) || line.badge === "Out of stock") && <span className="block tone-red">Out of stock</span>}
            </li>
          ))}
        </ul>
        <TotalsRegion totals={checkout.totals} giftCard={checkout.gift_card} />
      </section>
    </div>
  );
}
