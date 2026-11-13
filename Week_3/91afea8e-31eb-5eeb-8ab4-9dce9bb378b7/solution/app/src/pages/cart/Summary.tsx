import { Share2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { Reel } from "../../components/Reel";
import type { Quote } from "../../lib/types";
import { fieldMessage, useBusy, useCartActions } from "./actions";
import { BillLine } from "./BillLine";

export function Coupon({ quote }: { quote: Quote }): ReactNode {
  const actions = useCartActions();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [applying, apply] = useBusy();
  const [removing, remove] = useBusy();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    void apply(async () => {
      try {
        await actions.applyCoupon(code.trim());
        setCode("");
      } catch (failure) {
        setError(fieldMessage(failure));
      }
    });
  };

  const drop = (): void => {
    setError(null);
    void remove(async () => {
      try {
        await actions.removeCoupon();
      } catch (failure) {
        setError(fieldMessage(failure));
      }
    });
  };

  return (
    <form className="card card--black summary__coupon" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="coupon-code">Coupon code</label>
        <input id="coupon-code" value={code} autoComplete="off" onChange={(event) => setCode(event.target.value)} aria-describedby="coupon-note" />
      </div>
      <div className="row">
        <Button type="submit" variant="primary" busy={applying}>
          Apply coupon
        </Button>
        {quote.coupon && (
          <Button busy={removing} onClick={drop}>
            Remove coupon
          </Button>
        )}
      </div>
      <p id="coupon-note" className={error ? "field-error" : "status"} aria-live="polite">
        {error ?? (quote.coupon ? `${quote.coupon.code} applied: ${rupees(-quote.coupon.discount_paise)}.` : "")}
      </p>
    </form>
  );
}

/** The selected lines' tax, summed: what the item prices already include. */
function taxTotals(quote: Quote): { taxable: number; cgst: number; sgst: number; igst: number } {
  const selected = quote.lines.filter((line) => line.selected);
  const sum = (pick: (line: Quote["lines"][number]) => number): number => selected.reduce((total, line) => total + pick(line), 0);
  return { taxable: sum((line) => line.taxable_value_paise), cgst: sum((line) => line.cgst_paise), sgst: sum((line) => line.sgst_paise), igst: sum((line) => line.igst_paise) };
}

export function Bill({ quote }: { quote: Quote }): ReactNode {
  const tax = taxTotals(quote);
  return (
    <div className="card summary__bill">
      <BillLine label="items" paise={quote.subtotal_paise} />
      {quote.discount_paise > 0 && <BillLine label="coupon" paise={quote.discount_paise} deduct />}
      <BillLine label="taxable value" paise={tax.taxable} />
      {tax.igst > 0 && <BillLine label="IGST" paise={tax.igst} />}
      {tax.cgst + tax.sgst > 0 && (
        <>
          <BillLine label="CGST" paise={tax.cgst} />
          <BillLine label="SGST" paise={tax.sgst} />
        </>
      )}
      <BillLine label="delivery" paise={quote.delivery_paise} />
      {quote.gift_wrap_paise > 0 && <BillLine label="gift wrap" paise={quote.gift_wrap_paise} />}
      {quote.cod_fee_paise > 0 && <BillLine label="cash on delivery fee" paise={quote.cod_fee_paise} />}
      {quote.emi_discount_paise > 0 && <BillLine label="EMI discount" paise={quote.emi_discount_paise} deduct />}
      {quote.balance_applied_paise > 0 && (
        <>
          <BillLine label="Chauraha balance" paise={quote.balance_applied_paise} deduct />
          <BillLine label="to pay now" paise={quote.due_paise} strong />
        </>
      )}
    </div>
  );
}

export function CodBar({ quote }: { quote: Quote }): ReactNode {
  const { eligible, cash_paise: cash, cap_paise: cap, message } = quote.cod;
  const share = eligible ? Math.min(1, cash / cap) : 0;
  return (
    <div className="card summary__cod">
      <p className="label">cash on delivery limit</p>
      <div
        role="progressbar"
        aria-label="Cash on delivery limit"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={cash}
        aria-valuetext={eligible ? `${rupees(cash)} of ${rupees(cap)}` : "cash on delivery unavailable"}
        className={`cod-bar${eligible ? "" : " cod-bar--empty"}`}
      >
        <div className="cod-bar__fill" style={{ transform: `scaleX(${share})` }} />
      </div>
      {eligible ? (
        <p className="bill cod-bar__label">
          <span className="amount">{rupees(cash)}</span> of <span className="amount">{rupees(cap)}</span>
        </p>
      ) : (
        <>
          <p className="bill cod-bar__label">cash on delivery unavailable</p>
          {message && <p className="cod-bar__why">{message}</p>}
        </>
      )}
    </div>
  );
}

interface StripProps {
  quote: Quote;
  checkoutHref: string;
  canCheckout: boolean;
}

/** The payable total and the checkout link; pinned to the bottom of the screen on phone and tablet. */
export function CartStrip({ quote, checkoutHref, canCheckout }: StripProps): ReactNode {
  return (
    <div className="cart-strip">
      <Reel paise={quote.payable_paise} label="Payable total" className="cart-strip__total" />
      <Link
        to={checkoutHref}
        className="btn btn--primary cart-strip__go"
        aria-disabled={canCheckout ? undefined : true}
        onClick={(event) => {
          if (!canCheckout) event.preventDefault();
        }}
      >
        Checkout
      </Link>
    </div>
  );
}

export function ShareButton({ onOpen }: { onOpen: () => void }): ReactNode {
  return (
    <Button onClick={onOpen} className="summary__share">
      <Share2 size={20} aria-hidden="true" />
      Share cart
    </Button>
  );
}
