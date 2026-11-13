import { useRef, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import { useCart } from "../../lib/cart";
import type { PaymentMethod, Quote } from "../../lib/types";
import { CheckoutShell } from "./Shell";
import { cardDraft, clearChoice, newKey, paymentBody, readChoice } from "./state";

const METHOD_LABEL: Record<PaymentMethod, string> = { upi: "UPI", card: "Card", netbanking: "Net banking", emi: "EMI", cod: "Cash on delivery" };

interface PlacedOrder {
  order_id: string;
}

function problemsOf(failure: ApiFailure): string[] {
  const fields = failure.body.errors ? Object.values(failure.body.errors) : [];
  return fields.length > 0 ? fields : [failure.body.message];
}

function ReviewStep({ quote }: { quote: Quote }): ReactNode {
  const navigate = useNavigate();
  const { run, reload } = useCart();
  const [choice] = useState(readChoice);
  const [key, setKey] = useState(newKey);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const [plan] = useState(() => {
    const method = choice.method ?? quote.payment.method;
    return {
      method,
      addressId: choice.addressId ?? quote.destination.address_id,
      payment: paymentBody(choice, cardDraft, method, choice.useBalance ?? quote.payment.use_balance),
      last4: cardDraft.number.replace(/\D/g, "").slice(-4),
    };
  });
  const { method, addressId, payment, last4 } = plan;
  if (!addressId) return <Navigate to="/checkout/address" replace />;
  if (!payment || (method === null && quote.due_paise > 0)) return <Navigate to="/checkout/payment" replace />;

  const prepaid = method !== "cod";
  const label = prepaid ? `Pay ${rupees(quote.due_paise || quote.payable_paise)}` : "Place order";
  const how = method === null ? "Chauraha balance" : method === "upi" ? `UPI, ${choice.vpa}` : (method === "card" || method === "emi") && !choice.savedCardId && last4 ? `${METHOD_LABEL[method]}, card ending ${last4}` : METHOD_LABEL[method];

  const submit = async (): Promise<void> => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const order = await post<PlacedOrder>("/api/checkout", { address_id: addressId, expected_payable_paise: quote.payable_paise, payment }, { headers: { "Idempotency-Key": key } });
      clearChoice();
      navigate(`/orders/${order.order_id}/placed`);
      void reload();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setKey(newKey());
        const fresh = failure.body.quote as Quote | undefined;
        if (failure.body.error === "price_changed" && fresh) await run(() => Promise.resolve(fresh));
        setProblems(problemsOf(failure));
      } else setProblems([failureMessage(failure)]);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <h2>review</h2>
      <dl className="ck__facts">
        <div>
          <dt>deliver to</dt>
          <dd>
            {quote.destination.city ? `${quote.destination.city}, ` : ""}
            {quote.destination.pincode}
          </dd>
        </div>
        <div>
          <dt>pay by</dt>
          <dd>{how}</dd>
        </div>
        <div>
          <dt>parcels</dt>
          <dd>{quote.parcels.length}</dd>
        </div>
      </dl>
      {problems.length > 0 && (
        <div role="alert" aria-label="Checkout problems" className="card card--pink ck__alert">
          {problems.map((text) => (
            <p key={text}>{text}</p>
          ))}
        </div>
      )}
      <div className="row ck__actions">
        <Button variant="primary" busy={busy} onClick={() => void submit()}>
          {label}
        </Button>
      </div>
    </>
  );
}

export default function Review(): ReactNode {
  return <CheckoutShell step="review">{(quote) => <ReviewStep quote={quote} />}</CheckoutShell>;
}
