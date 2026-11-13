import type { CheckoutStep } from "../../shared/api";

export const CHECKOUT_STEPS: { step: CheckoutStep; name: string }[] = [
  { step: "contact", name: "Contact" },
  { step: "delivery", name: "Delivery" },
  { step: "shipping", name: "Shipping" },
  { step: "payment", name: "Payment" },
];

/** `list "Checkout progress"`: the four steps, the current one marked. Static, so it is on the page from the first paint. */
export function CheckoutProgress({ current, finished }: { current?: CheckoutStep; finished?: boolean }) {
  const index = CHECKOUT_STEPS.findIndex((s) => s.step === current);
  return (
    <nav className="co-progress" aria-label="Progress">
      <ol role="list" aria-label="Checkout progress">
        {CHECKOUT_STEPS.map((s, i) => (
          <li key={s.step} aria-current={s.step === current ? "step" : undefined} className={finished || i < index ? "is-done" : ""}>
            {s.name}
          </li>
        ))}
      </ol>
    </nav>
  );
}
