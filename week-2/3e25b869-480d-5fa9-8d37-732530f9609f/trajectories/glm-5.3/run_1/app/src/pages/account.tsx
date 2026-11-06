// Account: sign-in by code, the record lists, and the order and subscription pages.
import { useEffect, useState } from "preact/hooks";
import type { PageProps } from "../app.js";
import { t } from "../state/i18n.js";
import { api, ApiError, scentName, cadenceLabel, TRIO_SCENTS, trioScentName } from "../state/api.js";
import type { Order, Subscription } from "../state/api.js";
import { formatMoney, formatLongDate, formatTaxCode, formatRate } from "../state/format.js";
import { EmailStep, Dialog, type EmailStepState } from "../components/controls.js";
import { NotFoundContent } from "./checkout.js";

interface AccountData {
  customer: { email: string; locale: string };
  orders: { number: string; placed_at: string; total: { cents: number }; status: string }[];
  subscriptions: { number: string; state: string; scent: string; cadence: string; next_bill_date: string | null }[];
}

export function AccountPage({ locale, onNavigate }: PageProps) {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [emailState, setEmailState] = useState<EmailStepState>({
    email: "", code: "", verified: false, pending: null, rateLimited: false, lockedOut: false
  });

  const load = async () => {
    try {
      const data = await api<AccountData>("/account");
      setAccount(data);
      setUnauthenticated(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUnauthenticated(true);
        setAccount(null);
      }
    }
  };
  useEffect(() => {
    void load();
  }, [emailState.verified]);

  if (unauthenticated) {
    return (
      <div class="page account-page">
        <h1>{t("signIn", locale)}</h1>
        <EmailStep
          locale={locale}
          state={emailState}
          setState={(patch) => setEmailState({ ...emailState, ...patch })}
          serverErrors={{}}
          purpose="sign_in"
        />
      </div>
    );
  }
  return (
    <div class="page account-page">
      <h1>{t("yourAccount", locale)}</h1>
      {account && (
        <>
          <section aria-label={t("orders", locale)}>
            <h2>{t("orders", locale)}</h2>
            <ul class="record-list">
              {account.orders.map((order) => (
                <li key={order.number}>
                  <a href={`/account/orders/${order.number}`} onClick={(event) => { event.preventDefault(); onNavigate(`/account/orders/${order.number}`); }}>
                    {order.number} · {formatMoney(order.total.cents, locale)}
                  </a>
                </li>
              ))}
              {account.orders.length === 0 && <li>{t("noOrders", locale)}</li>}
            </ul>
          </section>
          <section aria-label={t("subscriptions", locale)}>
            <h2>{t("subscriptions", locale)}</h2>
            <ul class="record-list">
              {account.subscriptions.map((subscription) => (
                <li key={subscription.number}>
                  <a href={`/account/subscriptions/${subscription.number}`} onClick={(event) => { event.preventDefault(); onNavigate(`/account/subscriptions/${subscription.number}`); }}>
                    {subscription.number} · {cadenceLabel(subscription.cadence, locale)}
                  </a>
                </li>
              ))}
              {account.subscriptions.length === 0 && <li>{t("noSubscriptions", locale)}</li>}
            </ul>
          </section>
          <button
            type="button"
            class="button"
            onClick={async () => {
              await api("/auth/sign-out", { method: "POST" });
              setUnauthenticated(true);
              setAccount(null);
            }}
          >
            {t("signOut", locale)}
          </button>
        </>
      )}
    </div>
  );
}

export function OrderPage({ locale, params }: PageProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void api<Order>(`/account/orders/${params.number}`)
      .then(setOrder)
      .catch(() => setMissing(true));
  }, []);
  if (missing) return <NotFoundContent locale={locale} />;
  if (!order) return <div class="page"><h1>{t("orderHeading", locale, { order: params.number })}</h1></div>;
  return (
    <div class="page order-page">
      <h1>{t("orderHeading", locale, { order: order.number })}</h1>
      <dl class="record-facts">
        <div><dt>{t("total", locale)}</dt><dd>{formatMoney(order.total.cents, locale)}</dd></div>
        <div><dt>{t("shipsOn", locale)}</dt><dd>{order.ship_on}</dd></div>
      </dl>
      <ul class="placed-lines">
        {order.lines.map((line) => (
          <li key={`${line.batch}-${line.bar}`}>
            {t("holdRow", locale, { k: line.bar, scent: scentName(line.scent, locale), batch: line.batch })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SubscriptionPage({ locale, params }: PageProps) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [swapScent, setSwapScent] = useState(TRIO_SCENTS[0].slug);

  const load = async () => {
    try {
      const data = await api<Subscription>(`/account/subscriptions/${params.number}`);
      setSubscription(data);
    } catch {
      setMissing(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const act = async (action: "skip" | "unskip" | "pause" | "resume" | "cancel" | "patch", patch?: { scent?: string; cadence?: string }) => {
    setPending(true);
    try {
      if (action === "cancel") {
        const data = await api<{ subscription: Subscription }>(`/account/subscriptions/${params.number}/cancel`, { method: "POST", body: {} });
        setSubscription(data.subscription);
        setNotice(t("accountUpdates", locale));
      } else if (action === "patch" && patch) {
        const data = await api<{ subscription: Subscription }>(`/account/subscriptions/${params.number}`, { method: "PATCH", body: patch });
        setSubscription(data.subscription);
      } else {
        const data = await api<{ subscription: Subscription }>(`/account/subscriptions/${params.number}/${action}`, { method: "POST", body: {} });
        setSubscription(data.subscription);
      }
      if (action === "skip") {
        setNotice("skip");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotice(t("outageSubscription", locale));
      }
    } finally {
      setPending(false);
    }
  };

  if (missing) return <NotFoundContent locale={locale} />;
  if (!subscription) return <div class="page"><h1>{t("subscriptionHeading", locale, { sub: params.number })}</h1></div>;
  const message = subscription.state === "paused"
    ? t("paused", locale)
    : subscription.next_bill_date
      ? formatLongDate(subscription.next_bill_date, locale)
      : "—";
  return (
    <div class="page subscription-page">
      <h1>{t("subscriptionHeading", locale, { sub: subscription.number })}</h1>
      <dl class="record-facts">
        <div><dt>{t("studio", locale)}</dt><dd>{subscription.state}</dd></div>
        <div><dt>{t("trioScent", locale)}</dt><dd>{trioScentName(subscription.scent, locale)}</dd></div>
        <div><dt>{t("cadence", locale)}</dt><dd>{cadenceLabel(subscription.cadence, locale)}</dd></div>
        {subscription.pending_cadence && (
          <div><dt>{t("cadence", locale)}</dt><dd>{cadenceLabel(subscription.pending_cadence, locale)}</dd></div>
        )}
        <div><dt>{t("nextBillDate", locale)}</dt><dd>{message}</dd></div>
      </dl>
      <aside class="order-total" aria-label={t("trioPrice", locale)}>
        <h2>{t("trioPrice", locale)}</h2>
        <dl>
          <div><dt>{t("subtotal", locale)}</dt><dd>{formatMoney(subscription.price.subtotal.cents, locale)}</dd></div>
          <div><dt>{t("discountLine", locale)} (12%)</dt><dd class="discount">-{formatMoney(subscription.price.discount.cents, locale)}</dd></div>
          {subscription.price.taxes.map((tax) => (
            <div key={tax.code}><dt>{formatTaxCode(tax.code, locale)} ({formatRate(tax.rate, locale)})</dt><dd>{formatMoney(tax.amount.cents, locale)}</dd></div>
          ))}
          <div><dt>{t("total", locale)}</dt><dd>{formatMoney(subscription.price.total.cents, locale)}</dd></div>
        </dl>
      </aside>
      <fieldset class="trio-scents" role="radiogroup" aria-label={t("trioScent", locale)}>
        {TRIO_SCENTS.map((candidate) => (
          <label key={candidate.slug} class="scent-chip">
            <input
              type="radio"
              name="swap-scent"
              value={candidate.slug}
              checked={swapScent === candidate.slug}
              onChange={() => setSwapScent(candidate.slug)}
            />
            {trioScentName(candidate.slug, locale)}
          </label>
        ))}
      </fieldset>
      <div class="subscription-controls">
        {subscription.state === "active" && !subscription.skipped_bill_date && (
          <button type="button" class="button" disabled={pending} onClick={() => act("skip")}>
            {pending ? t("saving", locale) : t("skipNext", locale)}
          </button>
        )}
        {subscription.state === "active" && subscription.skipped_bill_date && (
          <button type="button" class="button" disabled={pending} onClick={() => act("unskip")}>
            {pending ? t("saving", locale) : t("undoSkip", locale)}
          </button>
        )}
        <button type="button" class="button" disabled={pending} onClick={() => act("patch", { scent: swapScent })}>
          {pending ? t("saving", locale) : t("swapScent", locale)}
        </button>
        {subscription.state === "active" && (
          <button type="button" class="button" disabled={pending} onClick={() => act("pause")}>
            {pending ? t("saving", locale) : t("pause", locale)}
          </button>
        )}
        {subscription.state === "paused" && (
          <button type="button" class="button" disabled={pending} onClick={() => act("resume")}>
            {pending ? t("saving", locale) : t("resume", locale)}
          </button>
        )}
        {subscription.state === "active" && (
          <button type="button" class="button" onClick={() => setCancelOpen(true)}>
            {t("cancelSubscription", locale)}
          </button>
        )}
      </div>
      <Dialog
        title={t("cancelDialog", locale)}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => act("cancel")}
        confirmLabel={t("yesCancel", locale)}
        closeLabel={t("keepIt", locale)}
      />
      <div role="status" class="account-updates" aria-live="polite" aria-label={t("accountUpdates", locale)}>
        {notice}
      </div>
    </div>
  );
}
