// The subscribe page: Trio scent, cadence menu, price breakdown, start.
import { useEffect, useRef, useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t, cartMessage } from "../state/i18n.js";
import { api, ApiError, TRIO_SCENTS, trioScentName, cadenceLabel, newIdempotencyKey } from "../state/api.js";
import type { Subscription } from "../state/api.js";
import { formatMoney, formatTaxCode, formatRate } from "../state/format.js";
import {
  EmailStep, ErrorSummary, ShippingFields, shippingLabels,
  type EmailStepState, type FieldError
} from "../components/controls.js";

const CADENCES: { value: string; key: string }[] = [
  { value: "MONTHLY", key: "cadenceMonthly" },
  { value: "BIMESTRIAL", key: "cadenceBimonthly" },
  { value: "QUARTERLY", key: "cadenceQuarterly" }
];

export function SubscribePage({ locale, onNavigate, status }: PageProps) {
  const [scent, setScent] = useState(TRIO_SCENTS[0].slug);
  const [cadence, setCadence] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [province, setProvince] = useState("QC");
  const [emailState, setEmailState] = useState<EmailStepState>({
    email: "", code: "", verified: false, pending: null, rateLimited: false, lockedOut: false
  });
  const [shipping, setShipping] = useState({ name: "", line1: "", city: "", province: "QC", postal_code: "" });
  const [errors, setErrors] = useState<FieldError>({});
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState("");
  const idempotencyRef = useRef(newIdempotencyKey());
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setShipping((current) => ({ ...current, province }));
  }, [province]);

  const billingDown = status.billing === "down";
  const startLabel = starting
    ? t("starting", locale)
    : billingDown
      ? t("subscriptionsPaused", locale)
      : !emailState.verified
        ? t("verifyEmailFirst", locale)
        : t("startSubscription", locale);

  // A client-side price breakdown for the chosen province.
  const price = (() => {
    const subtotal = 3300;
    const discount = Math.floor((subtotal * 12000 + 50000) / 100000);
    const preTax = subtotal - discount;
    const taxes: [string, string, number][] = province === "QC"
      ? [["GST", "5%", Math.floor((preTax * 5000 + 50000) / 100000)], ["QST", "9.975%", Math.floor((preTax * 9975 + 50000) / 100000)]]
      : province === "ON"
        ? [["HST", "13%", Math.floor((preTax * 13000 + 50000) / 100000)]]
        : [["GST", "5%", Math.floor((preTax * 5000 + 50000) / 100000)]];
    const total = preTax + taxes.reduce((sum, entry) => sum + entry[2], 0);
    return { subtotal, discount, taxes, total };
  })();

  const start = async () => {
    setStarting(true);
    try {
      const result = await api<{ subscription: Subscription }>("/subscriptions", {
        method: "POST",
        idempotencyKey: idempotencyRef.current,
        body: { scent, cadence, shipping }
      });
      onNavigate(`/account/subscriptions/${result.subscription.number}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.fields) {
        setErrors(err.fields);
      } else if (err instanceof ApiError && err.status === 409) {
        setNotice(cartMessage("allHeld", locale));
      } else {
        setNotice(cartMessage("networkFailure", locale));
      }
      setStarting(false);
    }
  };

  return (
    <div class="page subscribe-page">
      <h1>{t("trioSubscription", locale)}</h1>
      <p>{t("trioDescription", locale)}</p>
      <div class="checkout-layout">
        <div class="checkout-form">
          {Object.keys(errors).length > 0 && (
            <ErrorSummary locale={locale} errors={errors} labels={shippingLabels(locale)} />
          )}
          <fieldset class="trio-scents" role="radiogroup" aria-label={t("trioScent", locale)}>
            {TRIO_SCENTS.map((candidate) => (
              <label key={candidate.slug} class="scent-chip">
                <input
                  type="radio"
                  name="trio-scent"
                  value={candidate.slug}
                  checked={scent === candidate.slug}
                  onChange={() => setScent(candidate.slug)}
                />
                {trioScentName(candidate.slug, locale)}
              </label>
            ))}
          </fieldset>
          <div class="cadence-menu" ref={menuRef}>
            <button
              ref={buttonRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={menuOpen ? "true" : "false"}
              aria-label={t("cadence", locale)}
              class="button cadence-button"
              onClick={() => setMenuOpen(!menuOpen)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setMenuOpen(true);
                  setTimeout(() => {
                    menuRef.current?.querySelector<HTMLElement>("[role=option]")?.focus();
                  }, 0);
                }
              }}
            >
              {cadence ? cadenceLabel(cadence, locale) : t("choose", locale)}
            </button>
            {menuOpen && (
              <ul
                role="listbox"
                aria-label={t("cadence", locale)}
                class="cadence-list"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setMenuOpen(false);
                    buttonRef.current?.focus();
                  }
                  if (event.key === "Tab") {
                    setMenuOpen(false);
                  }
                }}
              >
                {CADENCES.map((option) => (
                  <li
                    key={option.value}
                    role="option"
                    aria-selected={cadence === option.value ? "true" : "false"}
                    tabIndex={0}
                    onClick={() => {
                      setCadence(option.value);
                      setMenuOpen(false);
                      buttonRef.current?.focus();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setCadence(option.value);
                        setMenuOpen(false);
                        buttonRef.current?.focus();
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role=option]") ?? []);
                        const index = options.findIndex((candidate) => candidate === document.activeElement);
                        const nextIndex = event.key === "ArrowDown"
                          ? Math.min(options.length - 1, index + 1)
                          : Math.max(0, index - 1);
                        options[nextIndex]?.focus();
                      }
                    }}
                  >
                    {t(option.key, locale)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div class="field">
            <label for="field-province">{t("province", locale)}</label>
            <select
              id="field-province"
              value={province}
              onChange={(event) => setProvince((event.target as HTMLSelectElement).value)}
            >
              <option value="QC">Québec</option>
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
            class="button primary"
            disabled={starting || billingDown || !emailState.verified}
            onClick={start}
          >
            {startLabel}
          </button>
          <div role="status" class="account-updates" aria-live="polite" aria-label={t("accountUpdates", locale)}>
            {notice}
          </div>
        </div>
        <aside class="order-total" aria-label={t("trioPrice", locale)}>
          <h2>{t("trioPrice", locale)}</h2>
          <dl>
            <div><dt>{t("subtotal", locale)}</dt><dd>{formatMoney(price.subtotal, locale)}</dd></div>
            <div><dt>{t("discountLine", locale)} (12%)</dt><dd class="discount">-{formatMoney(price.discount, locale)}</dd></div>
            {price.taxes.map((entry) => (
              <div key={entry[0]}><dt>{formatTaxCode(entry[0], locale)} ({formatRate(entry[1], locale)})</dt><dd>{formatMoney(entry[2], locale)}</dd></div>
            ))}
            <div><dt>{t("total", locale)}</dt><dd>{formatMoney(price.total, locale)}</dd></div>
            <div><dt>{t("chargedToday", locale)}</dt><dd>{formatMoney(price.total, locale)}</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  );
}
