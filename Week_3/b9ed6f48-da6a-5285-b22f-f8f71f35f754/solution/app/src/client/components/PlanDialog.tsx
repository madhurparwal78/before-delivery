// The Supporter plan dialog (brief: Public screens › Supporter plan; Interactions › Plan dialog).
// Its tier, currency and card stay as the supporter left them while page timers run; after any
// answer it reads the membership again and shows only the confirmed state.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, fixedCurrency, LostReply, newKey, type Catalog, type Membership } from "../api.js";
import { useApp } from "../state.js";
import { Dialog } from "./Dialog.js";
import { ErrorSummary, Field, type FieldErrors } from "./ui.js";
import { COPY, TIERS, TIER_NAMES, copyFor, type Tier } from "../../shared/copy.js";
import { CURRENCIES, formatPrice, type Currency } from "../../shared/money.js";
import { formatLisbonDate } from "../../shared/lisbon.js";

export function ChoiceGroup<T extends string>({ label, options, value, onChange, disabled, name }: { label: string; name: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="choices">
      <span className="choices-label" aria-hidden="true">
        {label}
      </span>
      <div className="choices-row">
        {options.map((o) => (
          <label key={o.value} className="choice">
            <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled?.(o.value)} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ScheduledChanges({ changes }: { changes: { currency: Currency; amount_minor: number; effective_on: string }[] }) {
  if (!changes.length) return null;
  return (
    <ul className="scheduled-changes">
      {changes.map((c) => (
        <li key={`${c.currency}-${c.effective_on}`}>{copyFor.scheduledChange(formatLisbonDate(c.effective_on), formatPrice(c.amount_minor, c.currency))}</li>
      ))}
    </ul>
  );
}

type Action = "join" | "change" | "cancel" | "undo";

export function PlanDialog() {
  const app = useApp();
  const open = app.dialog.kind === "plan";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [pricesDown, setPricesDown] = useState(false);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [locked, setLocked] = useState<Currency | null>(null);
  const [tier, setTier] = useState<Tier>("fellow");
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [card, setCard] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = useRef(false);

  /**
   * Shows the confirmed membership. A tier the supporter picked since the dialog opened or since
   * their last action started is kept, so a late reply never repaints their choice.
   */
  const readMembership = useCallback(async () => {
    if (!app.user) return null;
    const { membership: m, currency: fixed } = await fixedCurrency();
    setMembership(m);
    setLocked(fixed);
    if (m && m.status !== "cancelled" && !chosen.current) setTier(m.tier);
    if (fixed) setCurrency(fixed);
    return m;
  }, [app.user]);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage("");
    setCard("");
    chosen.current = false;
    api<Catalog>("/api/catalog").then(
      (c) => {
        setCatalog(c);
        setPricesDown(false);
      },
      () => setPricesDown(true),
    );
    readMembership().catch(() => undefined);
  }, [open, app.dialog.serial, readMembership]);

  const tierEntry = catalog?.tiers.find((t) => t.tier === tier);
  const price = tierEntry?.prices[currency];
  const member = membership && membership.status !== "cancelled" ? membership : null;

  const act = async (action: Action) => {
    if (busy) return;
    setErrors({});
    setMessage("");
    const paying = action === "join" || (action === "change" && member !== null && TIERS.indexOf(tier) > TIERS.indexOf(member.tier));
    if (paying) app.announce(COPY.processing);
    chosen.current = false;
    setBusy(true);
    try {
      const key = newKey();
      const result =
        action === "join"
          ? await api<{ membership: Membership; receipt_email: string }>("/api/me/membership", { body: { tier, currency, card_number: card }, key })
          : action === "change"
            ? await api<{ membership: Membership; receipt_email: string | null }>("/api/me/membership/change", { body: { tier }, key })
            : await api<{ membership: Membership; receipt_email?: string }>(`/api/me/membership/${action}`, { body: {}, key });
      const m = result.membership;
      setMembership(m);
      if (action === "join") app.announce(copyFor.welcome(m.tier_name));
      if (action === "change") {
        app.announce(m.pending?.kind === "downgrade" ? copyFor.downgradePending(TIER_NAMES[m.pending.tier], formatLisbonDate(m.pending.effective_on)) : copyFor.upgraded(m.tier_name));
      }
      if (action === "cancel") app.announce(m.status === "cancelled" ? COPY.cancelledOverdue : copyFor.endsOn(formatLisbonDate(m.pending?.effective_on ?? "")));
      if (action === "undo") app.announce(COPY.undone);
      if (result.receipt_email === "delayed") app.setServiceNotice(COPY.receiptDelayed);
      setCard("");
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.error.fields ?? {});
        setMessage(error.error.fields ? COPY.validation : error.error.message);
        app.announce(error.error.message);
      } else if (error instanceof LostReply) setMessage(COPY.billingDown);
    } finally {
      await readMembership().catch(() => undefined);
      setBusy(false);
    }
  };

  const ids = { card_number: "plan-card", tier: "plan-tier", currency: "plan-currency" };

  return (
    <Dialog open={open} label="Supporter plan" onClose={app.closeDialog} returnFocus={() => app.dialog.opener}>
      <h2>Supporter plan</h2>
      <p className="dialog-lede">A monthly plan in your own currency keeps the reading room open. Change or cancel whenever you like.</p>
      <ErrorSummary errors={errors} message={message} ids={ids} />
      <ChoiceGroup
        label="Tier"
        name="plan-tier"
        value={tier}
        onChange={(t) => {
          chosen.current = true;
          setTier(t);
        }}
       options={TIERS.map((t) => ({ value: t, label: TIER_NAMES[t] }))} />
      <ChoiceGroup label="Currency" name="plan-currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c, label: c }))} disabled={(c) => locked !== null && c !== locked} />
      {locked && <p className="hint">{copyFor.currencyLocked(locked)}</p>}
      <div role="status" aria-label="Plan price" className="live-price">
        {pricesDown ? COPY.pricesDown : price !== undefined ? copyFor.planPrice(formatPrice(price, currency)) : ""}
      </div>
      {tierEntry && <ScheduledChanges changes={tierEntry.scheduled_changes.filter((c) => c.currency === currency)} />}
      {member && (
        <p className="plan-current">
          You are a <strong>{member.tier_name}</strong> supporter.
          {member.pending?.kind === "downgrade" && ` ${copyFor.changesTo(TIER_NAMES[member.pending.tier], formatLisbonDate(member.pending.effective_on))}`}
          {member.pending?.kind === "cancel" && ` ${copyFor.membershipEnds(formatLisbonDate(member.pending.effective_on))}`}
        </p>
      )}
      {!app.user ? (
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => app.openSignIn(app.dialog.opener)}>
            Sign in to join
          </button>
        </div>
      ) : !member ? (
        <>
          <Field id={ids.card_number} label="Card number" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.currentTarget.value)} error={errors.card_number} />
          <div className="actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void act("join")}>
              Join
            </button>
          </div>
        </>
      ) : (
        <div className="actions">
          {member.status === "active" && (
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void act("change")}>
              Change plan
            </button>
          )}
          {member.status !== "pending_change" && (
            <button type="button" className="button" disabled={busy} onClick={() => void act("cancel")}>
              Cancel membership
            </button>
          )}
          {member.pending && (
            <button type="button" className="button" disabled={busy} onClick={() => void act("undo")}>
              Undo pending change
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}
