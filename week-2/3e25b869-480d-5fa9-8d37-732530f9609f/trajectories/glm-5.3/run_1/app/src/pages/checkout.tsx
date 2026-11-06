// Checkout: held bars with countdowns, the email step, shipping, and paying.
import { useEffect, useRef, useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t, cartMessage } from "../state/i18n.js";
import { api, ApiError, newIdempotencyKey, scentName } from "../state/api.js";
import type { Cart, Hold, Order } from "../state/api.js";
import { formatMoney, formatCountdown, formatTaxCode, formatRate } from "../state/format.js";
import {
  EmailStep, ErrorSummary, ShippingFields, shippingLabels,
  type EmailStepState, type FieldError
} from "../components/controls.js";

export function CheckoutPage({ locale, onNavigate, status }: PageProps) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [province, setProvince] = useState("QC");
  const [emailState, setEmailState] = useState<EmailStepState>({
    email: "", code: "", verified: false, pending: null, rateLimited: false, lockedOut: false
  });
  const [shipping, setShipping] = useState({ name: "", line1: "", city: "", province: "QC", postal_code: "" });
  const [errors, setErrors] = useState<FieldError>({});
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState("");
  const [, setTick] = useState(0);
  const idempotencyRef = useRef(newIdempotencyKey());

  const load = async (provinceValue: string) => {
    try {
      const data = await api<Cart>(`/cart?province=${provinceValue}`);
      setCart(data);
    } catch {
      setNotice(cartMessage("networkFailure", locale));
    }
  };
  useEffect(() => {
    void load(province);
    const timer = setInterval(() => {
      void load(province);
    }, 5000);
    return () => clearInterval(timer);
  }, [province]);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const holds = cart?.holds ?? [];
  const billingDown = status.billing === "down";
  const payLabel = paying
    ? t("paying", locale)
    : billingDown
      ? t("checkoutPaused", locale)
      : holds.length === 0
        ? t("noBarsHeld", locale)
        : !emailState.verified
          ? t("verifyEmailFirst", locale)
          : t("pay", locale, { total: formatMoney(cart?.total.cents ?? 0, locale) });

  const release = async (hold: Hold) => {
    try {
      await api(`/holds/${hold.id}`, { method: "DELETE" });
      const messages = [cartMessage("released", locale, { k: hold.bar })];
      const next = await api<Cart>(`/cart?province=${province}`);
      setCart(next);
      if (next.total.cents !== (cart?.total.cents ?? 0)) {
        messages.push(cartMessage("totalChanged", locale, { total: formatMoney(next.total.cents, locale) }));
      }
      setNotice(messages.join(" "));
      const rows = Array.from(document.querySelectorAll<HTMLElement>(".hold-row"));
      const index = rows.findIndex((row) => row.dataset.holdId === hold.id);
      const nextRow = rows[index + 1]?.querySelector<HTMLElement>(".release-button")
        ?? rows[index - 1]?.querySelector<HTMLElement>(".release-button");
      if (nextRow) {
        nextRow.focus();
      } else {
        const back = document.querySelector<HTMLElement>(".back-to-drop");
        back?.focus();
      }
    } catch {
      setNotice(cartMessage("networkFailure", locale));
    }
  };

  const pay = async () => {
    setPaying(true);
    try {
      const order = await api<{ order: Order }>("/checkout", {
        method: "POST",
        idempotencyKey: idempotencyRef.current,
        body: { holds: holds.map((hold) => hold.id), shipping }
      });
      onNavigate(`/checkout/placed/${order.order.number}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        const next = await api<Cart>(`/cart?province=${province}`);
        const messages = [cartMessage("holdExpiredCheckout", locale)];
        if (next.total.cents !== (cart?.total.cents ?? 0)) {
          messages.push(cartMessage("totalChanged", locale, { total: formatMoney(next.total.cents, locale) }));
        }
        setCart(next);
        setNotice(messages.join(" "));
      } else if (err instanceof ApiError && err.status === 422 && err.fields) {
        setErrors(err.fields);
      } else if (err instanceof ApiError && err.status === 503) {
        setNotice(cartMessage("networkFailure", locale));
      } else {
        setNotice(cartMessage("networkFailure", locale));
      }
      setPaying(false);
    }
  };

  return (
    <div class="page checkout-page">
      <h1>{t("checkout", locale)}</h1>
      <section aria-label={t("heldBars", locale)} class="held-bars">
        {holds.map((hold) => {
          return (
            <div class="hold-row" data-hold-id={hold.id}>
              <p>{t("holdRow", locale, { k: hold.bar, scent: scentName(cart?.batches.find((batch) => batch.code === hold.batch)?.code ? hold.batch : hold.batch, locale), batch: hold.batch })}</p>
              <span class="hold-timer" role="timer" aria-label={t("holdTimer", locale, { k: hold.bar })}>
                {formatCountdown((new Date(hold.expires_at).getTime() - Date.now()) / 1000)}
              </span>
              <button type="button" class="button release-button" onClick={() => release(hold)}>
                {t("releaseBar", locale, { k: hold.bar })}
              </button>
            </div>
          );
        })}
        {holds.length === 0 && <p>{notice}</p>}
      </section>
      <div class="checkout-layout">
        <div class="checkout-form">
          {Object.keys(errors).length > 0 && (
            <ErrorSummary locale={locale} errors={errors} labels={shippingLabels(locale)} />
          )}
          <div class="field">
            <label for="field-province">{t("province", locale)}</label>
            <select id="field-province" value={province} onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              setProvince(value);
              setShipping((current) => ({ ...current, province: value }));
            }}>
              <option value="QC">{locale === "fr-CA" ? "Québec" : "Québec"}</option>
              <option value="ON">Ontario</option>
              <option value="AB">Alberta</option>
              <option value="BC">{locale === "fr-CA" ? "Colombie-Britannique" : "British Columbia"}</option>
              <option value="MB">Manitoba</option>
              <option value="NB">{locale === "fr-CA" ? "Nouveau-Brunswick" : "New Brunswick"}</option>
              <option value="NL">{locale === "fr-CA" ? "Terre-Neuve-et-Labrador" : "Newfoundland and Labrador"}</option>
              <option value="NS">{locale === "fr-CA" ? "Nouvelle-Écosse" : "Nova Scotia"}</option>
              <option value="NT">{locale === "fr-CA" ? "Territoires du Nord-Ouest" : "Northwest Territories"}</option>
              <option value="NU">Nunavut</option>
              <option value="PE">{locale === "fr-CA" ? "Île-du-Prince-Édouard" : "Prince Edward Island"}</option>
              <option value="SK">Saskatchewan</option>
              <option value="YT">Yukon</option>
            </select>
          </div>
          <EmailStep
            locale={locale}
            state={emailState}
            setState={(patch) => setEmailState({ ...emailState, ...patch })}
            serverErrors={{}}
            purpose="checkout"
          />
          <ShippingFields
            locale={locale}
            values={shipping}
            errors={errors}
            onField={(field, value) => setShipping({ ...shipping, [field]: value })}
          />
          <button
            type="button"
            class="button primary pay-button"
            disabled={paying || billingDown || holds.length === 0 || !emailState.verified}
            onClick={pay}
          >
            {payLabel}
          </button>
          <a href="/" class="back-to-drop">{t("backToDrop", locale)}</a>
          <div role="status" class="cart-updates" aria-live="polite" aria-label={t("cartUpdates", locale)}>
            {holds.length > 0 ? notice : ""}
          </div>
        </div>
        <aside class="order-total" aria-label={t("orderTotal", locale)}>
          <h2>{t("orderTotal", locale)}</h2>
          <dl>
            <div><dt>{t("subtotal", locale)}</dt><dd>{formatMoney(cart?.subtotal.cents ?? 0, locale)}</dd></div>
            <div><dt>{t("shippingLine", locale)}</dt><dd>{formatMoney(cart?.shipping_fee.cents ?? 0, locale)}</dd></div>
            {(cart?.taxes ?? []).map((tax) => (
              <div key={tax.code}>
                <dt>{formatTaxCode(tax.code, locale)} ({formatRate(tax.rate, locale)})</dt>
                <dd>{formatMoney(tax.amount.cents, locale)}</dd>
              </div>
            ))}
            <div><dt>{t("total", locale)}</dt><dd>{formatMoney(cart?.total.cents ?? 0, locale)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}

export function PlacedPage({ locale, params }: PageProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void api<Order>(`/account/orders/${params.number}`)
      .then(setOrder)
      .catch(() => setMissing(true));
  }, []);
  if (missing) {
    return <NotFoundContent locale={locale} />;
  }
  if (!order) return <div class="page"><h1>{t("orderPlaced", locale, { order: params.number })}</h1></div>;
  return (
    <div class="page placed-page">
      <h1>{t("orderPlaced", locale, { order: order.number })}</h1>
      <p>{t("confirmationLine", locale, { email: order.email })}</p>
      <ul class="placed-lines">
        {order.lines.map((line) => (
          <li key={`${line.batch}-${line.bar}`}>
            {t("holdRow", locale, { k: line.bar, scent: scentName(line.scent, locale), batch: line.batch })}
            {" · "}
            {formatMoney(line.unit_price.cents, locale)}
          </li>
        ))}
      </ul>
      <dl class="placed-total">
        <div><dt>{t("subtotal", locale)}</dt><dd>{formatMoney(order.subtotal.cents, locale)}</dd></div>
        <div><dt>{t("shippingLine", locale)}</dt><dd>{formatMoney(order.shipping_fee.cents, locale)}</dd></div>
        {order.taxes.map((tax) => (
          <div key={tax.code}><dt>{formatTaxCode(tax.code, locale)} ({formatRate(tax.rate, locale)})</dt><dd>{formatMoney(tax.amount.cents, locale)}</dd></div>
        ))}
        <div><dt>{t("total", locale)}</dt><dd>{formatMoney(order.total.cents, locale)}</dd></div>
      </dl>
      <p>{t("shipsOn", locale)}: {order.ship_on}</p>
    </div>
  );
}

export function NotFoundContent({ locale }: { locale: "fr-CA" | "en-CA" }) {
  return (
    <div class="page not-found">
      <h1>{t("notFoundHeading", locale)}</h1>
      <p>{t("notFoundLine", locale)}</p>
      <a href="/">{t("goDrop", locale)}</a>
    </div>
  );
}
