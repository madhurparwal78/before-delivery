import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { ApiFailure, failureMessage, get, put } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import type { PaymentMethod, Quote } from "../../lib/types";
import { BankField, CardFields, EmiTenure, UpiField, type Bank, type SavedCard } from "./PaymentFields";
import { CheckoutShell } from "./Shell";
import { cardDraft, readChoice, writeChoice, type Choice, type Tenure } from "./state";

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "upi", label: "UPI" },
  { id: "card", label: "Card" },
  { id: "netbanking", label: "Net banking" },
  { id: "emi", label: "EMI" },
  { id: "cod", label: "Cash on delivery" },
];

const DEFAULT_TENURE: Tenure = 3;

function errorsOf(failure: unknown): Record<string, string> {
  if (failure instanceof ApiFailure && failure.body.errors) return failure.body.errors;
  return { general: failureMessage(failure) };
}

/** The details this page holds for the chosen method, checked the way the server will check them. */
function missingDetails(choice: Choice, quote: Quote): Record<string, string> | null {
  const found: Record<string, string> = {};
  const method = choice.method;
  if (method === null && quote.due_paise > 0) found.method = "Choose how to pay.";
  if (method === "upi" && !/^[^@\s]+@[^@\s]+$/.test(choice.vpa)) found.vpa = "Enter a UPI ID like name@bank.";
  if (method === "netbanking" && !choice.bankCode) found.bank = "Choose one of the listed banks.";
  if (method === "card" || method === "emi") {
    if (!/^\d{3}$/.test(cardDraft.cvv)) found.cvv = "Enter the 3-digit CVV.";
    if (!choice.savedCardId) {
      if (!/^\d{12,19}$/.test(cardDraft.number.replace(/\s/g, ""))) found.number = "Check the card number.";
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(cardDraft.expiry.trim())) found.expiry = "Check the card expiry.";
      if (cardDraft.name.trim() === "") found.name = "Name on card needs at least 1 characters.";
    }
  }
  return Object.keys(found).length > 0 ? found : null;
}

function PaymentStep({ quote }: { quote: Quote }): ReactNode {
  const navigate = useNavigate();
  const { run } = useCart();
  const { balancePaise } = useAuth();
  const [choice, setChoice] = useState<Choice>(() => {
    const stored = readChoice();
    return {
      ...stored,
      method: stored.method ?? quote.payment.method,
      useBalance: stored.useBalance ?? quote.payment.use_balance,
      emiTenure: stored.emiTenure ?? quote.payment.emi_tenure_months,
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banks, setBanks] = useState<Bank[]>([]);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [emiProblem, setEmiProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);
  const current = useRef(choice);

  useEffect(() => {
    get<{ banks: Bank[] }>("/api/banks").then((found) => setBanks(found.banks), () => undefined);
    get<{ cards: SavedCard[] }>("/api/account/cards").then(
      (found) => {
        setCards(found.cards);
        const first = found.cards[0];
        if (!first || readChoice().savedCardId || cardDraft.number) return;
        writeChoice({ savedCardId: first.card_id });
        setChoice((now) => ({ ...now, savedCardId: first.card_id }));
      },
      () => undefined,
    );
  }, []);

  const change = (next: Choice): void => {
    current.current = next;
    setChoice(next);
    writeChoice(next);
  };

  /**
   * Saves the payment choice on the server and paints the quote it answers with; the server's refusal stays under its field.
   * A pointer click shows its choice once the server has answered (refusal included); the keyboard's arrows show theirs at once.
   */
  const apply = async (patch: Partial<Choice>, afterAnswer = false): Promise<boolean> => {
    const next = { ...current.current, ...patch };
    if (!afterAnswer) change(next);
    latest.current += 1;
    const mine = latest.current;
    setErrors({});
    try {
      await run(() =>
        put<Quote>("/api/cart/payment", { method: next.method, use_balance: next.useBalance === true, emi_tenure_months: next.method === "emi" ? (next.emiTenure ?? DEFAULT_TENURE) : null }),
      );
      return true;
    } catch (failure) {
      if (mine === latest.current) setErrors(errorsOf(failure));
      return false;
    } finally {
      if (afterAnswer) change({ ...current.current, ...patch });
    }
  };

  const select = (method: PaymentMethod, byPointer: boolean): void => {
    const tenure = current.current.emiTenure;
    void apply({ method, emiTenure: method === "emi" ? (tenure ?? DEFAULT_TENURE) : tenure }, byPointer);
  };

  const next = async (): Promise<void> => {
    const missing = missingDetails(choice, quote);
    if (missing) {
      setErrors(missing);
      return;
    }
    setBusy(true);
    try {
      if (await apply({})) navigate("/checkout/review");
    } finally {
      setBusy(false);
    }
  };

  const rowMessage = (method: PaymentMethod): string | undefined => {
    if (method === "cod") return choice.method === "cod" && errors.method ? errors.method : (quote.cod.message ?? undefined);
    if (method === "emi") return choice.method === "emi" ? (errors.method ?? emiProblem ?? undefined) : undefined;
    return choice.method === method ? errors.method : undefined;
  };

  const general = errors.general ?? (choice.method === null ? errors.method : undefined);

  return (
    <>
      <h2>payment</h2>
      <p className="muted">Pick one way to pay. Cash on delivery is for small orders.</p>
      <div role="radiogroup" aria-label="Payment method" className="ck__choices">
        {METHODS.map((method) => {
          const message = rowMessage(method.id);
          return (
            <div key={method.id} className="ck__method">
              <label className="choice choice--card">
                <input type="radio" name="method" checked={choice.method === method.id} aria-describedby={message ? `method-${method.id}-note` : undefined} onChange={(event) => select(method.id, (event.nativeEvent as MouseEvent).detail > 0)} />
                {method.label}
              </label>
              {message && (
                <p id={`method-${method.id}-note`} className="ck__note">
                  {message}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <label className="choice ck__balance">
        <input type="checkbox" checked={choice.useBalance === true} onChange={(event) => void apply({ useBalance: event.target.checked })} />
        Use Chauraha balance
        <span className="muted">({rupees(balancePaise)})</span>
      </label>
      {errors.use_balance && <p className="field-error">{errors.use_balance}</p>}
      {choice.method === "upi" && <UpiField choice={choice} errors={errors} onChoice={change} />}
      {choice.method === "netbanking" && <BankField choice={choice} errors={errors} onChoice={change} banks={banks} />}
      {choice.method === "emi" && (
        <EmiTenure choice={choice} errors={errors} amountKey={quote.payable_paise} onProblem={setEmiProblem} onTenure={(tenure) => void apply({ emiTenure: tenure })} />
      )}
      {(choice.method === "card" || choice.method === "emi") && <CardFields choice={choice} errors={errors} onChoice={change} cards={cards} />}
      <div className="ck__problem" aria-live="polite">
        {general && <p className="field-error">{general}</p>}
      </div>
      <div className="row ck__actions">
        <Button variant="primary" busy={busy} onClick={() => void next()}>
          Continue
        </Button>
      </div>
    </>
  );
}

export default function Payment(): ReactNode {
  return <CheckoutShell step="payment">{(quote) => <PaymentStep quote={quote} />}</CheckoutShell>;
}
