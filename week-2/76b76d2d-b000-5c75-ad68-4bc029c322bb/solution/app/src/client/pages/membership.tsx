import { useRef, useState } from "preact/hooks";
import type { Invoice, Membership } from "../../shared/api.ts";
import { CADENCE_LABELS, CADENCES, formatMoney, TIER_LABELS, TIER_PRICES, TIERS, type Cadence, type Tier } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { billingDown, useApp } from "../context.tsx";
import { StepUp } from "../stepup.tsx";
import { Feedback, Num, withNum, OptionMenu, RadioCards, useAction } from "../ui.tsx";
import { MembershipFacts } from "./account.tsx";

/** Live verification judged from the server's valid_until and the server clock learned from status polls. */
export function useVerification() {
  const { serverOffset } = useApp();
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const live = validUntil !== null && Date.now() + serverOffset < Date.parse(validUntil);
  return { live, setValidUntil };
}

export function MembershipPage() {
  const { t, me } = useApp();
  if (me === undefined) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.membershipHeading}</h1><p class="muted">{t.loading}</p></section>;
  return <MembershipForm />;
}

function MembershipForm() {
  const ctx = useApp();
  const { locale, t, me, refreshMe } = ctx;
  const current = me?.membership ?? null;
  const [tier, setTier] = useState<Tier>(current?.tier ?? "friend");
  const [cadence, setCadence] = useState<Cadence>(current && current.cadence !== "gift" ? current.cadence : "annual");
  const [joined, setJoined] = useState<Invoice | null>(null);
  const [stepupOpen, setStepupOpen] = useState(false);
  const verification = useVerification();
  const action = useAction();
  const actionRef = useRef<HTMLButtonElement>(null);

  const isMember = Boolean(current);
  /** The step-up rule as the brief states it for this screen: every tier change; a join while credit is held. */
  const needsStepup = isMember || (me?.credit_balance_cents ?? 0) > 0;
  const blocked = (needsStepup && !verification.live) || billingDown(ctx) || action.busy || !me || me.role !== "patron";
  const price = TIER_PRICES[tier][cadence];

  const join = () => {
    void action.run(
      () => api<{ membership: Membership; invoice: Invoice }>("POST", "/api/membership", { tier, cadence }),
      (data) => {
        setJoined(data.invoice);
        refreshMe();
        return t.amountCharged(formatMoney(data.invoice.amount_cents, locale));
      },
    );
  };
  const change = () => {
    void action.run(
      () => api<{ membership: Membership; effective: "immediate" | "end-of-term"; effective_date: string; invoice: Invoice | null }>("POST", "/api/membership/change", { tier, cadence }),
      (data) => {
        refreshMe();
        return data.effective === "immediate" && data.invoice
          ? t.upgradeDone(formatMoney(data.invoice.paid_cents, locale))
          : t.scheduledDone(data.effective_date);
      },
    );
  };

  return (
    <section class="page membership-page">
      <h1 tabIndex={-1} class="page-title">{t.membershipHeading}</h1>
      <p class="lede">{t.membershipIntro}</p>
      {joined ? (
        <div class="confirmation">
          <h2 class="panel-title">{t.membershipActive}</h2>
          <p>{t.amountCharged("")}<Num>{formatMoney(joined.amount_cents, locale)}</Num></p>
        </div>
      ) : null}
      {current ? (
        <section class="panel" aria-labelledby="current-heading">
          <h2 id="current-heading" class="panel-title">{t.currentPlan}</h2>
          <MembershipFacts membership={current} number={me?.number ?? null} locale={locale} t={t} />
        </section>
      ) : null}
      {!me ? <p class="muted"><a href={`/${locale}/signin?next=${encodeURIComponent(location.pathname)}`}>{t.signInFirst}</a></p> : null}
      <form class="membership-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!blocked) (isMember ? change : join)(); }}>
        <RadioCards name="tier" legend={t.tierGroup} value={tier} onChange={setTier}
          options={TIERS.map((value) => ({
            value, label: TIER_LABELS[value][locale],
            detail: <><Num>{formatMoney(TIER_PRICES[value][cadence], locale)}</Num> {cadence === "annual" ? t.perYear : t.perMonth}<br />{t.tierPerks[value]}</>,
          }))} />
        <div class="cadence-row">
          <OptionMenu openerLabel={t.billingButton(CADENCE_LABELS[cadence][locale])} listLabel={t.billingCadence} value={cadence}
            options={CADENCES.map((value) => ({ value, label: CADENCE_LABELS[value][locale] }))} onChange={setCadence} />
          <p class="preview"><Num>{formatMoney(price, locale)}</Num> {cadence === "annual" ? t.perYear : t.perMonth}</p>
        </div>
        <div class="pay-actions">
          {needsStepup && !verification.live && me ? (
            <button type="button" class="button ghost" onClick={() => setStepupOpen(true)}>{t.verify}</button>
          ) : null}
          <button ref={actionRef} type="submit" class="button primary" disabled={blocked}>
            {action.busy ? t.working : isMember ? t.changeTier : withNum(t.join(formatMoney(price, locale)), [formatMoney(price, locale)])}
          </button>
        </div>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
      <StepUp purpose="membership" open={stepupOpen} onClose={() => setStepupOpen(false)} unlocked={actionRef}
        onVerified={async (validUntil) => { verification.setValidUntil(validUntil); }} />
    </section>
  );
}
