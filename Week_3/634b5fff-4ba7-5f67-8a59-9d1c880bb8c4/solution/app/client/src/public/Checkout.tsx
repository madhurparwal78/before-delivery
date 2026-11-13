import { useEffect, useRef, useState, type FormEvent } from "react";
import { ERRORS, FIELD_ERRORS, type FieldName } from "../../../shared/copy.js";
import { formatDkk } from "../../../shared/money.js";
import { ApiFailure, request } from "../api.js";
import { Link, navigate } from "../router.js";
import { finishHold, holds } from "../state/hold.js";
import { edition } from "../state/market.js";
import { useStore } from "../state/store.js";
import { Alert, Button, playMotion, TextArea, TextField } from "../ui.js";
import { BankCheck } from "./BankCheck.js";
import { bodyOf, digitsOf, EMPTY_FORM, validate, type CheckoutForm, type FieldErrors } from "./checkoutRules.js";
import { LABELS } from "./copy.js";
import { orderPath, rememberOrderToken } from "./orderToken.js";
import { PublicSheet } from "./PublicSheet.js";
import "../styles/checkout.css";

interface CheckoutReply {
  reference: string;
  orderToken: string;
  challenge?: { id: string; expiresInMs: number };
}

interface OpenCheck {
  reference: string;
  expiresInMs: number;
  lastFour: string;
}

const FIELD_OF: Partial<Record<keyof CheckoutForm, FieldName>> = {
  name: "buyer.name", email: "buyer.email", street: "address.street", postcode: "address.postcode", city: "address.city",
  recipientName: "gift.recipientName", recipientEmail: "gift.recipientEmail", message: "gift.message",
  cardNumber: "card.number", expiry: "card.expiry", cvc: "card.cvc",
};

const NOTHING_HELD = "You are not holding a box yet. Choose a number on the shelf first.";

const messageOf = (failure: unknown): string =>
  failure instanceof ApiFailure && failure.message ? failure.message : ERRORS.internal_error.message();

const isFieldName = (key: string): key is FieldName => key in FIELD_ERRORS;

const fieldErrorsOf = (failure: ApiFailure): FieldErrors => {
  const errors: FieldErrors = {};
  for (const [key, text] of Object.entries(failure.fields)) if (isFieldName(key)) errors[key] = text;
  return errors;
};

/** Reads a checkout reply that carries the order's reference and token, wherever it came from. */
const replyOf = (body: Record<string, unknown>): CheckoutReply | null =>
  typeof body.reference === "string" && typeof body.orderToken === "string" ? { reference: body.reference, orderToken: body.orderToken } : null;

export const Checkout = () => {
  const holdState = useStore(holds);
  const price = useStore(edition);
  const [form, setForm] = useState<CheckoutForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<OpenCheck | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const cancelling = useRef<Promise<void>>(Promise.resolve());
  const held = holdState.number !== null && holdState.token !== null;

  useEffect(() => {
    if (!held) return;
    setMessage("");
  }, [held]);

  const set = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    const field = FIELD_OF[key];
    if (field) setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  const fail = (text: string): void => {
    setMessage(text);
    playMotion(formRef.current, "shake");
  };

  const toOrder = (reply: CheckoutReply): void => {
    rememberOrderToken(reply.reference, reply.orderToken);
    navigate(orderPath(reply.reference, reply.orderToken));
    finishHold();
  };

  useEffect(() => {
    if (message || Object.keys(errors).length > 0) errorsRef.current?.scrollIntoView({ block: "nearest" });
  }, [errors, message]);

  const headers = (): Record<string, string> => ({ "X-Hold-Token": holdState.token ?? "" });

  const onFailure = (failure: unknown): void => {
    if (failure instanceof ApiFailure) {
      const reply = failure.code === "authorised_too_late" ? replyOf(failure.body) : null;
      if (reply) {
        toOrder(reply);
        return;
      }
      const fields = fieldErrorsOf(failure);
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setMessage("");
        playMotion(formRef.current, "shake");
        return;
      }
    }
    fail(messageOf(failure));
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || holdState.number === null) return;
    await cancelling.current;
    const found = validate(form);
    setErrors(found);
    setMessage("");
    if (Object.keys(found).length > 0) {
      playMotion(formRef.current, "shake");
      return;
    }
    setBusy(true);
    try {
      const { status, body } = await request<CheckoutReply>("POST", "/api/checkout", {
        json: bodyOf(holdState.number, form),
        headers: { ...headers(), "Idempotency-Key": crypto.randomUUID() },
      });
      if (status === 202 && body.challenge) {
        setCheck({ reference: body.reference, expiresInMs: body.challenge.expiresInMs, lastFour: digitsOf(form.cardNumber).slice(-4) });
      } else {
        toOrder(body);
      }
    } catch (failure) {
      onFailure(failure);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (code: string): Promise<void> => {
    if (!check) return;
    try {
      const { body } = await request<CheckoutReply>("POST", `/api/checkout/${check.reference}/challenge`, { json: { code }, headers: headers() });
      setCheck(null);
      toOrder(body);
    } catch (failure) {
      setCheck(null);
      onFailure(failure);
    }
  };

  const cancel = (): void => {
    if (!check) return;
    const { reference } = check;
    setCheck(null);
    cancelling.current = request("POST", `/api/checkout/${reference}/challenge`, { json: { cancel: true }, headers: headers() }).then(
      () => undefined,
      (failure: unknown) => fail(messageOf(failure)),
    );
  };

  const expire = (): void => {
    setCheck(null);
    fail(ERRORS.challenge_expired.message());
  };

  const bank = form.method === "bank";
  const total = price ? formatDkk(price.totalOre) : "";

  return (
    <PublicSheet>
      <h1>{LABELS.checkout.form}</h1>
      {held ? (
        <form ref={formRef} aria-label={LABELS.checkout.form} data-motion="shake" noValidate onSubmit={(event) => void submit(event)} className="checkout">
          <fieldset>
            <legend>{form.gift ? "Your details" : "Your details and where it goes"}</legend>
            <TextField label={LABELS.checkout.name} value={form.name} error={errors["buyer.name"]} autoComplete="name" onChange={(event) => set("name", event.target.value)} />
            <TextField label={LABELS.checkout.email} type="email" value={form.email} error={errors["buyer.email"]} autoComplete="email" onChange={(event) => set("email", event.target.value)} />
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={form.gift} onChange={(event) => set("gift", event.target.checked)} />
            <span>{LABELS.checkout.gift}</span>
          </label>
          {form.gift ? (
            <fieldset>
              <legend>The recipient</legend>
              <TextField label={LABELS.checkout.recipientName} value={form.recipientName} error={errors["gift.recipientName"]} autoComplete="off" onChange={(event) => set("recipientName", event.target.value)} />
              <TextField label={LABELS.checkout.recipientEmail} type="email" value={form.recipientEmail} error={errors["gift.recipientEmail"]} autoComplete="off" onChange={(event) => set("recipientEmail", event.target.value)} />
              <TextArea label={LABELS.checkout.message} rows={3} value={form.message} error={errors["gift.message"]} onChange={(event) => set("message", event.target.value)} />
            </fieldset>
          ) : null}
          <fieldset>
            <legend>{form.gift ? "The recipient's delivery address" : "Delivery address"}</legend>
            {form.gift ? <p className="muted small">The street, postcode and city below are the recipient's. The gift notice carries no price.</p> : null}
            <TextField label={LABELS.checkout.street} value={form.street} error={errors["address.street"]} autoComplete="street-address" onChange={(event) => set("street", event.target.value)} />
            <div className="checkout__pair">
              <TextField label={LABELS.checkout.postcode} value={form.postcode} error={errors["address.postcode"]} autoComplete="postal-code" inputMode="numeric" onChange={(event) => set("postcode", event.target.value)} />
              <TextField label={LABELS.checkout.city} value={form.city} error={errors["address.city"]} autoComplete="address-level2" onChange={(event) => set("city", event.target.value)} />
            </div>
          </fieldset>
          <fieldset className="methods">
            <legend>{LABELS.checkout.payment}</legend>
            <label className="check">
              <input type="radio" name="method" checked={!bank} onChange={() => set("method", "card")} />
              <span>{LABELS.checkout.card}</span>
            </label>
            <label className="check">
              <input type="radio" name="method" checked={bank} onChange={() => set("method", "bank")} />
              <span>{LABELS.checkout.bank}</span>
            </label>
          </fieldset>
          <div key={form.method} data-motion="step" className="checkout__panel">
            {bank ? (
              <p className="muted">You will get the account details and a deadline. The box is kept for you until then.</p>
            ) : (
              <>
                <TextField label={LABELS.checkout.cardNumber} value={form.cardNumber} error={errors["card.number"]} autoComplete="cc-number" inputMode="numeric" onChange={(event) => set("cardNumber", event.target.value)} />
                <div className="checkout__pair">
                  <TextField label={LABELS.checkout.expiry} value={form.expiry} error={errors["card.expiry"]} autoComplete="cc-exp" placeholder="MM/YY" onChange={(event) => set("expiry", event.target.value)} />
                  <TextField label={LABELS.checkout.cvc} value={form.cvc} error={errors["card.cvc"]} autoComplete="cc-csc" inputMode="numeric" onChange={(event) => set("cvc", event.target.value)} />
                </div>
              </>
            )}
            <div ref={errorsRef}>
              <Alert label={LABELS.checkout.errors} className="form-message error">
                {message ? (
                  <p>{message}</p>
                ) : (
                  <ul>
                    {Object.entries(errors).map(([field, text]) => <li key={field}>{text}</li>)}
                  </ul>
                )}
              </Alert>
              <Button type="submit" variant="primary" aria-busy={busy || undefined}>
                {bank ? LABELS.checkout.reserve : `${LABELS.checkout.authorise} ${total}`.trim()}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <Alert label={LABELS.checkout.errors} className="form-message error" />
          <p>
            {NOTHING_HELD} <Link href="/shelf">Go to the shelf</Link>
          </p>
        </>
      )}
      {check ? (
        <BankCheck
          lastFour={check.lastFour}
          totalOre={price?.totalOre ?? 0}
          expiresInMs={check.expiresInMs}
          onApprove={(code) => void approve(code)}
          onCancel={cancel}
          onExpire={expire}
          returnTo={() => formRef.current?.querySelector<HTMLElement>('button[type="submit"]') ?? null}
        />
      ) : null}
    </PublicSheet>
  );
};
