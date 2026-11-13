import { useEffect, useState, type ReactNode } from "react";
import { rupees } from "../../../shared/format";
import { ApiFailure, get } from "../../lib/api";
import { cardDraft, type CardDraft, type Choice, type Tenure } from "./state";

export interface Bank {
  code: string;
  name: string;
}

export interface SavedCard {
  card_id: string;
  network: string;
  last4: string;
  expiry_month: number;
  expiry_year: number;
  name: string;
}

interface Plan {
  tenure_months: Tenure;
  no_cost: boolean;
  upfront_discount_paise: number;
  instalment_paise: number;
  total_interest_paise: number;
  total_payable_paise: number;
}

type Errors = Record<string, string>;

interface FieldProps {
  choice: Choice;
  errors: Errors;
  onChoice: (next: Choice) => void;
}

function Problem({ id, text }: { id: string; text: string | undefined }): ReactNode {
  return text ? (
    <p id={id} className="field-error">
      {text}
    </p>
  ) : null;
}

export function UpiField({ choice, errors, onChoice }: FieldProps): ReactNode {
  return (
    <div className="field">
      <label htmlFor="upi-id">UPI ID</label>
      <input id="upi-id" value={choice.vpa} placeholder="name@bank" autoComplete="off" aria-describedby="upi-error" onChange={(event) => onChoice({ ...choice, vpa: event.target.value.trim() })} />
      <Problem id="upi-error" text={errors.vpa} />
    </div>
  );
}

export function BankField({ choice, errors, onChoice, banks }: FieldProps & { banks: Bank[] }): ReactNode {
  return (
    <div className="field">
      <label htmlFor="bank">Bank</label>
      <select id="bank" value={choice.bankCode} aria-describedby="bank-error" onChange={(event) => onChoice({ ...choice, bankCode: event.target.value })}>
        <option value="">Choose your bank</option>
        {banks.map((bank) => (
          <option key={bank.code} value={bank.code}>
            {bank.name}
          </option>
        ))}
      </select>
      <Problem id="bank-error" text={errors.bank} />
    </div>
  );
}

export function CardFields({ choice, errors, onChoice, cards }: FieldProps & { cards: SavedCard[] }): ReactNode {
  const [draft, setDraft] = useState<CardDraft>(cardDraft);
  const edit = (patch: Partial<CardDraft>): void => {
    Object.assign(cardDraft, patch);
    setDraft({ ...cardDraft });
  };
  const typing = (patch: Partial<CardDraft>): void => {
    edit(patch);
    if (choice.savedCardId) onChoice({ ...choice, savedCardId: null });
  };

  return (
    <div className="ck__card">
      {cards.length > 0 && (
        <div role="radiogroup" aria-label="Saved cards" className="ck__choices">
          {cards.map((card) => (
            <label key={card.card_id} className="choice choice--card">
              <input type="radio" name="saved-card" checked={choice.savedCardId === card.card_id} onChange={() => onChoice({ ...choice, savedCardId: card.card_id })} />
              {card.network} ending {card.last4}
            </label>
          ))}
        </div>
      )}
      <div className="field">
        <label htmlFor="card-number">Card number</label>
        <input id="card-number" inputMode="numeric" autoComplete="cc-number" value={draft.number} aria-describedby="number-error" onChange={(event) => typing({ number: event.target.value })} onFocus={() => choice.savedCardId && onChoice({ ...choice, savedCardId: null })} />
        <Problem id="number-error" text={errors.number} />
      </div>
      <div className="field">
        <label htmlFor="card-expiry">Expiry (MM/YY)</label>
        <input id="card-expiry" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} value={draft.expiry} aria-describedby="expiry-error" onChange={(event) => typing({ expiry: event.target.value })} />
        <Problem id="expiry-error" text={errors.expiry} />
      </div>
      <div className="field">
        <label htmlFor="card-cvv">CVV</label>
        <input id="card-cvv" className="masked" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={draft.cvv} aria-describedby="cvv-error" onChange={(event) => edit({ cvv: event.target.value })} />
        <Problem id="cvv-error" text={errors.cvv} />
      </div>
      <div className="field">
        <label htmlFor="card-name">Name on card</label>
        <input id="card-name" autoComplete="cc-name" value={draft.name} aria-describedby="name-error" onChange={(event) => typing({ name: event.target.value })} />
        <Problem id="name-error" text={errors.name} />
      </div>
      <label className="choice">
        <input type="checkbox" checked={draft.save} onChange={(event) => typing({ save: event.target.checked })} />
        Save this card
      </label>
    </div>
  );
}

/** The cart's EMI plans for the selected lines; the server's refusal (`EMI starts at ₹3,000.00.`) comes back as the problem. */
export function EmiTenure({ choice, errors, onTenure, amountKey, onProblem }: { choice: Choice; errors: Errors; onTenure: (tenure: Tenure) => void; amountKey: number; onProblem: (text: string | null) => void }): ReactNode {
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    let current = true;
    get<{ plans: Plan[] }>("/api/cart/emi-plans").then(
      (found) => {
        if (!current) return;
        setPlans(found.plans);
        onProblem(null);
      },
      (failure: unknown) => {
        if (!current) return;
        setPlans([]);
        if (failure instanceof ApiFailure) onProblem(failure.body.errors?.amount ?? failure.body.message);
      },
    );
    return () => {
      current = false;
    };
  }, [amountKey, onProblem]);

  return (
    <div role="radiogroup" aria-label="EMI tenure" className="ck__choices">
      {plans.map((plan) => (
        <div key={plan.tenure_months} className="ck__plan">
          <label className="choice choice--card">
            <input type="radio" name="emi-tenure" checked={choice.emiTenure === plan.tenure_months} aria-describedby={`plan-${plan.tenure_months}`} onChange={() => onTenure(plan.tenure_months)} />
            {plan.tenure_months} months
          </label>
          <p id={`plan-${plan.tenure_months}`} className="ck__plan-note">
            {rupees(plan.instalment_paise)} a month, interest {rupees(plan.total_interest_paise)}, total {rupees(plan.total_payable_paise)}
            {plan.no_cost && `. No-cost: ${rupees(plan.upfront_discount_paise)} off now`}
          </p>
        </div>
      ))}
      {errors.emi_tenure_months && <p className="field-error">{errors.emi_tenure_months}</p>}
    </div>
  );
}
