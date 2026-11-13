import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Backdrop } from "../../components/Backdrop";
import { NotFound } from "../../components/NotFound";
import { Reel } from "../../components/Reel";
import { signInHref, useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { useTitle } from "../../lib/hooks";
import type { Quote } from "../../lib/types";
import { rupees } from "../../../shared/format";
import { Bill } from "../cart/Summary";
import "../../styles/cart.css";
import "../../styles/checkout.css";

type Step = "address" | "payment" | "review";
const STEPS: Step[] = ["address", "payment", "review"];

function OrderSummary({ quote }: { quote: Quote }): ReactNode {
  const selected = quote.lines.filter((line) => line.selected);
  return (
    <>
      <section className="card ck__items">
        <h3>your order</h3>
        <ul>
          {selected.map((line) => (
            <li key={line.line_id}>
              <span>
                {line.title} <span className="muted">x {line.quantity}</span>
              </span>
              <span className="amount">{rupees(line.line_total_paise)}</span>
            </li>
          ))}
        </ul>
      </section>
      <Bill quote={quote} />
      <div className="cart-strip">
        <Reel paise={quote.payable_paise} label="Payable total" className="cart-strip__total" />
      </div>
    </>
  );
}

interface ShellProps {
  step: Step;
  children: (quote: Quote) => ReactNode;
}

/** The checkout frame: signed-in shoppers only, the step beside the order summary over the wave field. */
export function CheckoutShell({ step, children }: ShellProps): ReactNode {
  useTitle(`checkout: ${step}`);
  const auth = useAuth();
  const { quote, reload } = useCart();
  const location = useLocation();
  const shopper = auth.status === "signedIn" && auth.account?.role === "shopper";

  useEffect(() => {
    if (shopper) void reload();
  }, [shopper, reload]);

  if (auth.status === "signedOut") return <Navigate to={signInHref(`${location.pathname}${location.search}`)} replace />;
  if (auth.account && auth.account.role !== "shopper") return <NotFound />;
  if (auth.status === "loading" || !quote) {
    return (
      <div className="ck backdrop-host" aria-busy="true">
        <Backdrop />
        <div className="ck__inner">
          <section className="panel panel--black ck__head">
            <h1>checkout.</h1>
          </section>
          <div className="skeleton" style={{ minHeight: 280 }} />
        </div>
      </div>
    );
  }
  if (!quote.lines.some((line) => line.selected)) return <Navigate to="/cart" replace />;

  return (
    <div className="ck backdrop-host">
      <Backdrop />
      <div className="ck__inner">
        <section className="panel panel--black ck__head">
          <h1>checkout.</h1>
          <ol className="ck__steps" aria-label="Checkout steps">
            {STEPS.map((name, index) => (
              <li key={name} className={name === step ? "ck__step ck__step--now" : "ck__step"} aria-current={name === step ? "step" : undefined}>
                {index + 1}. {name}
              </li>
            ))}
          </ol>
        </section>
        <div className="ck__grid">
          <section className="ck__step-panel panel panel--black">{children(quote)}</section>
          <aside className="ck__summary">
            <OrderSummary quote={quote} />
          </aside>
        </div>
      </div>
    </div>
  );
}
