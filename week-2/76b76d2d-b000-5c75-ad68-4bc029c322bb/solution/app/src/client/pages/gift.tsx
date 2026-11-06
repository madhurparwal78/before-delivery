import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Gift, Membership } from "../../shared/api.ts";
import { formatMoney, TIER_LABELS, TIER_PRICES, TIERS, type Locale, type Tier } from "../../shared/domain.ts";
import { api, newIdempotencyKey } from "../api.ts";
import { billingDown, mailDown, useApp } from "../context.tsx";
import { StepUp } from "../stepup.tsx";
import { Feedback, Field, Num, withNum, RadioCards, SelectField, useAction } from "../ui.tsx";
import { useVerification } from "./membership.tsx";

export function GiftPage() {
  const ctx = useApp();
  const { locale, t, me } = ctx;
  const [tier, setTier] = useState<Tier>("friend");
  const [yourName, setYourName] = useState("");
  const [yourEmail, setYourEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientLocale, setRecipientLocale] = useState<Locale>(locale);
  const [message, setMessage] = useState("");
  const [cardholder, setCardholder] = useState("");
  const [purchased, setPurchased] = useState<Gift | null>(null);
  const [stepupOpen, setStepupOpen] = useState(false);
  const verification = useVerification();
  const action = useAction();
  const key = useRef(newIdempotencyKey()).current;
  const buyRef = useRef<HTMLButtonElement>(null);
  const price = TIER_PRICES[tier].annual;
  /** The step-up rule as the brief states it for this screen: a signed-in purchase while credit is held. */
  const needsStepup = Boolean(me) && (me?.credit_balance_cents ?? 0) > 0;
  const blocked = (needsStepup && !verification.live) || billingDown(ctx) || action.busy;
  const f = action.fields;

  const buy = () => {
    const body: Record<string, unknown> = {
      tier, recipient: { name: recipientName, email: recipientEmail, locale: recipientLocale }, message, cardholder_name: cardholder,
    };
    if (!me) body["purchaser"] = { name: yourName, email: yourEmail };
    void action.run(
      () => api<{ gift: Gift }>("POST", "/api/gifts", body, { "Idempotency-Key": key }),
      (data) => {
        setPurchased(data.gift);
        return t.giftLine(data.gift.recipient_email);
      },
    );
  };

  if (purchased) {
    return (
      <section class="page gift-page">
        <h1 tabIndex={-1} class="page-title">{t.giftPurchased}</h1>
        <div class="confirmation">
          <p>{t.giftLine(purchased.recipient_email)}</p>
          {mailDown(ctx) ? <p class="muted">{t.mailDelayed}</p> : null}
          <dl class="facts">
            <div><dt>{t.reference}</dt><dd><Num>{purchased.ref}</Num></dd></div>
            <div><dt>{t.tier}</dt><dd>{TIER_LABELS[purchased.tier][locale]}</dd></div>
            <div><dt>{t.price}</dt><dd><Num>{formatMoney(purchased.price_cents, locale)}</Num></dd></div>
          </dl>
        </div>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </section>
    );
  }

  // The form appears once the session is known: the purchaser fields shown only without one would push the rest down.
  if (me === undefined) return <section class="page gift-page"><h1 tabIndex={-1} class="page-title">{t.giftHeading}</h1><p class="muted">{t.loading}</p></section>;

  return (
    <section class="page gift-page">
      <h1 tabIndex={-1} class="page-title">{t.giftHeading}</h1>
      <p class="lede">{t.giftIntro}</p>
      <form class="gift-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!blocked) buy(); }}>
        <RadioCards name="tier" legend={t.tierGroup} value={tier} onChange={setTier}
          options={TIERS.map((value) => ({ value, label: TIER_LABELS[value][locale], detail: <Num>{formatMoney(TIER_PRICES[value].annual, locale)}</Num> }))} />
        {me === null ? (
          <fieldset class="form-group">
            <legend>{t.yourDetails}</legend>
            <Field label={t.yourName} value={yourName} onInput={setYourName} autocomplete="name" error={f["purchaser.name"]} />
            <Field label={t.yourEmail} type="email" value={yourEmail} onInput={setYourEmail} autocomplete="email" error={f["purchaser.email"]} />
          </fieldset>
        ) : null}
        <fieldset class="form-group">
          <legend>{t.recipient}</legend>
          <Field label={t.recipientName} value={recipientName} onInput={setRecipientName} error={f["recipient.name"]} />
          <Field label={t.recipientEmail} type="email" value={recipientEmail} onInput={setRecipientEmail} error={f["recipient.email"]} />
          <SelectField label={t.recipientLanguage} value={recipientLocale} onChange={(v) => setRecipientLocale(v === "fr" ? "fr" : "en")}
            options={[{ value: "en", label: "English" }, { value: "fr", label: "Français" }]} error={f["recipient.locale"]} />
          <Field label={t.message} value={message} onInput={setMessage} multiline error={f["message"]} />
        </fieldset>
        <fieldset class="form-group">
          <legend>{t.payment}</legend>
          <Field label={t.cardholder} value={cardholder} onInput={setCardholder} autocomplete="cc-name" error={f["cardholder_name"]} />
        </fieldset>
        <div class="pay-actions">
          {needsStepup && !verification.live ? (
            <button type="button" class="button ghost" onClick={() => setStepupOpen(true)}>{t.verify}</button>
          ) : null}
          <button ref={buyRef} type="submit" class="button primary" disabled={blocked}>{action.busy ? t.working : withNum(t.buyGift(formatMoney(price, locale)), [formatMoney(price, locale)])}</button>
        </div>
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </form>
      <StepUp purpose="gift" open={stepupOpen} onClose={() => setStepupOpen(false)} unlocked={buyRef}
        onVerified={async (validUntil) => { verification.setValidUntil(validUntil); }} />
    </section>
  );
}

type Redemption = { ref: string; tier: Tier; from_name: string; message: string; term_months: number };

export function GiftRedeemPage({ token }: { token: string }) {
  const ctx = useApp();
  const { locale, t, me } = ctx;
  const [gift, setGift] = useState<Redemption | null | undefined>(undefined);
  const [redeemed, setRedeemed] = useState<Membership | null>(null);
  const action = useAction();
  const path = `/api/gift-redemptions/${encodeURIComponent(token)}`;

  useLayoutEffect(() => {
    void api<{ gift: Redemption }>("GET", path).then((r) => setGift(r.ok ? r.data.gift : null));
  }, []);

  if (redeemed) {
    return (
      <section class="page">
        <h1 tabIndex={-1} class="page-title">{t.redeemed}</h1>
        <dl class="facts">
          <div><dt>{t.tier}</dt><dd>{TIER_LABELS[redeemed.tier][locale]}</dd></div>
          <div><dt>{t.billing}</dt><dd>{t.giftCadence}</dd></div>
          {redeemed.ends_on ? <div><dt>{t.endsOn}</dt><dd><Num>{redeemed.ends_on}</Num></dd></div> : null}
        </dl>
        {mailDown(ctx) ? <p class="muted">{t.mailDelayed}</p> : null}
        <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
      </section>
    );
  }
  if (gift === undefined) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.redeemHeading}</h1><p class="muted">{t.loading}</p></section>;
  if (gift === null) return <section class="page"><h1 tabIndex={-1} class="page-title">{t.notFound}</h1></section>;

  const redeem = () => {
    void action.run(
      () => api<{ membership: Membership; first_invoice_cents: number }>("POST", `${path}/redeem`, {}),
      (data) => {
        setRedeemed(data.membership);
        return t.redeemed;
      },
    );
  };
  return (
    <section class="page">
      <h1 tabIndex={-1} class="page-title">{t.redeemHeading}</h1>
      <div class="panel gift-card">
        <p class="gift-term">{t.giftTerm(TIER_LABELS[gift.tier][locale], gift.term_months)}</p>
        <p>{t.giftFrom(gift.from_name)}</p>
        {gift.message ? <blockquote class="gift-message">{gift.message}</blockquote> : null}
        <p class="muted"><Num>{gift.ref}</Num></p>
      </div>
      {me === null ? (
        <p class="muted">
          {t.signInToRedeem} <a href={`/${locale}/signin?next=${encodeURIComponent(location.pathname)}`}>{t.signIn}</a> · <a href={`/${locale}/signup`}>{t.createAccountLink}</a>
        </p>
      ) : null}
      <button type="button" class="button primary" disabled={action.busy || billingDown(ctx)} onClick={redeem}>{action.busy ? t.working : t.redeemButton}</button>
      <Feedback statusName={t.formStatus} alertName={t.formError} status={action.status} error={action.error} />
    </section>
  );
}
