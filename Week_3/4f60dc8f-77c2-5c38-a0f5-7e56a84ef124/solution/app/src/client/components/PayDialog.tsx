// The card payment dialog for deposits and invoices: test cards listed, typed values kept through any refusal.
import { useRef, useState } from "preact/hooks";
import { api, newKey, type ApiFailure } from "../api";
import { Dialog } from "./Dialog";
import { clearOutage, flagOutage } from "./Shell";

type Props<T> = {
  title: string;
  payLabel: string;
  path: string;
  onClose: () => void;
  onPaid: (data: T) => void;
};

export function PayDialog<T>({ title, payLabel, path, onClose, onPaid }: Props<T>) {
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "", name: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const payButton = useRef<HTMLButtonElement>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const set = (key: keyof typeof card) => (event: Event) => setCard({ ...card, [key]: (event.currentTarget as HTMLInputElement).value });

  const pay = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const body = JSON.stringify(card);
    // The same card details reuse their key, so a retry after a dropped connection never pays twice.
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: newKey() };
    setBusy(true);
    setMessage("");
    const reply = await api<T>("POST", path, { card }, { "Idempotency-Key": attempt.current.key });
    setBusy(false);
    if (reply.ok) {
      clearOutage("billing");
      onPaid(reply.data);
      return;
    }
    const failure: ApiFailure = reply.failure;
    setFields(failure.fields ?? {});
    setMessage(failure.fields ? "" : failure.message);
    flagOutage(failure.error);
    if (failure.error === "card_declined") attempt.current = null;
    requestAnimationFrame(() => payButton.current?.focus());
  };

  const fieldError = (key: string): string | undefined => fields[`card.${key}`];
  const input = (id: string, label: string, key: keyof typeof card, extra: Record<string, string> = {}) => (
    <div class="field" data-invalid={fieldError(key) ? "true" : "false"}>
      <label for={id}>{label}</label>
      {fieldError(key) && (
        <p class="field-error" id={`${id}-error`}>
          {fieldError(key)}
        </p>
      )}
      <input id={id} value={card[key]} onInput={set(key)} aria-invalid={fieldError(key) ? "true" : undefined} aria-describedby={fieldError(key) ? `${id}-error` : undefined} {...extra} />
    </div>
  );

  return (
    <Dialog title={title} onClose={onClose}>
      <form noValidate onSubmit={pay}>
        <p class="cards">
          Test cards: <code>4242 4242 4242 4242</code> approves, <code>4000 0000 0000 0002</code> is declined. Card details are never stored.
        </p>
        {input("card-number", "Card number", "number", { inputMode: "numeric", autocomplete: "cc-number" })}
        {input("card-expiry", "Expiry (MM/YY)", "expiry", { inputMode: "numeric", autocomplete: "cc-exp", placeholder: "MM/YY" })}
        {input("card-cvc", "Security code", "cvc", { inputMode: "numeric", autocomplete: "cc-csc" })}
        {input("card-name", "Name on card", "name", { autocomplete: "cc-name" })}
        {message && (
          <p class="field-error" role="alert">
            {message}
          </p>
        )}
        <div class="actions">
          <button type="submit" class="button primary" ref={payButton} aria-busy={busy ? "true" : "false"}>
            {busy ? "Processing payment" : payLabel}
          </button>
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
