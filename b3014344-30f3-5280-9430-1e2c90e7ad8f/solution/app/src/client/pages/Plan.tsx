import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CardFields, EMPTY_CARD, type CardValue } from "../components/CardFields";
import { Dialog } from "../components/Dialog";
import { QuoteSheet, type SheetFigures, type SheetState } from "../components/QuoteSheet";
import { api, newKey, RequestError } from "../lib/api";
import { Link } from "../lib/router";
import { COPY, copyFor } from "../../shared/copy";
import { longDate, type Plan, type Preview } from "../../shared/domain";
import { money } from "../../shared/money";

/** The status label the plan page shows, from the plan as billing holds it. */
export function planLabel(plan: Plan): string {
  if (plan.status === "active" && plan.pauseOn) return `Pauses on ${longDate(plan.pauseOn)}`;
  if (plan.status === "pending_cancel" && plan.endsOn) return `Ends on ${longDate(plan.endsOn)}`;
  return { active: "Active", paused: "Paused", pending_cancel: "Ends on", past_due: "Past due", cancelled: "Cancelled" }[plan.status];
}

function sheetOf(preview: Preview): SheetFigures {
  return { currency: preview.currency, first: preview.credit, second: preview.charge, total: preview.total, share: preview.creditShare };
}

export function PlanPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [view, setView] = useState<"loading" | "none" | "outage" | "ok">("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheetState, setSheetState] = useState<SheetState>("quoting");
  const [cancelling, setCancelling] = useState(false);
  const [card, setCard] = useState<CardValue>(EMPTY_CARD);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [refocusSwitch, setRefocusSwitch] = useState(false);
  const cardKey = useRef<string | null>(null);
  const switchButton = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    api<{ plan: Plan }>("/api/plan")
      .then((body) => {
        setPlan(body.plan);
        setView("ok");
      })
      .catch((error) => setView(error instanceof RequestError && error.status === 404 ? "none" : "outage"));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (refocusSwitch) {
      switchButton.current?.focus();
      setRefocusSwitch(false);
    }
  }, [refocusSwitch]);

  /** Every plan action answers with the plan as billing confirmed it. */
  const act = async (path: string, success: (plan: Plan) => string, body: unknown = {}): Promise<Plan | null> => {
    setBusy(true);
    setMessage(COPY.confirming);
    try {
      const result = await api<{ plan: Plan }>(path, { body, key: newKey() });
      setPlan(result.plan);
      setView("ok");
      setMessage(success(result.plan));
      return result.plan;
    } catch (error) {
      setMessage(error instanceof RequestError ? describe(error) : COPY.planActionOutage);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const describe = (error: RequestError): string => {
    if (error.code === "card_declined") return COPY.declined;
    if (error.code === "billing_unavailable" || error.status === 0) return COPY.planActionOutage;
    return error.body.message;
  };

  const openChange = async () => {
    if (!plan) return;
    setChanging(true);
    setPreview(null);
    setSheetState("quoting");
    setMessage(COPY.prorating);
    try {
      const fresh = await api<Preview>("/api/plan/previews", { body: { tier: plan.tier === "lite" ? "plus" : "lite" } });
      setPreview(fresh);
      setSheetState("ready");
      setMessage(copyFor.previewReady(money(fresh.credit, fresh.currency), money(fresh.charge, fresh.currency), money(fresh.total, fresh.currency)));
    } catch (error) {
      setSheetState("outage");
      setMessage(error instanceof RequestError && error.code !== "billing_unavailable" ? error.body.message : COPY.planActionOutage);
    }
  };

  const confirmChange = async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(COPY.confirming);
    try {
      const result = await api<{ plan: Plan }>("/api/plan/changes", { body: { previewId: preview.previewId }, key: newKey() });
      setPlan(result.plan);
      setChanging(false);
      setMessage(copyFor.planChanged(result.plan.planName));
      setRefocusSwitch(true);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      if (error.code === "preview_stale") {
        const updated = error.body.preview as Preview;
        setPreview(updated);
        setMessage(COPY.previewStale);
      } else if (error.code === "preview_expired") {
        setPreview(null);
        setSheetState("outage");
        setMessage(COPY.previewExpired);
      } else setMessage(describe(error));
    } finally {
      setBusy(false);
    }
  };

  const updateCard = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCardErrors({});
    setMessage(COPY.processing);
    cardKey.current ??= newKey();
    try {
      const result = await api<{ plan: Plan }>("/api/plan/card", { body: { card }, key: cardKey.current });
      cardKey.current = null;
      setPlan(result.plan);
      setMessage(COPY.cardPaid);
    } catch (error) {
      if (!(error instanceof RequestError)) throw error;
      if (error.status === 422) {
        setCardErrors(error.body.fields ?? {});
        setMessage("");
      } else setMessage(error.code === "billing_unavailable" ? COPY.billingOutage : describe(error));
    } finally {
      setBusy(false);
    }
  };

  const other = plan?.tier === "lite" ? "Care Plus" : "Care Lite";
  const status = plan?.status;
  const canChange = status === "active" && !plan?.pauseOn;

  return (
    <div className="ledger-page plan-page">
      <p className="eyebrow">Care plan</p>
      <h1>{plan ? plan.planName : "Your care plan"}</h1>
      {view === "outage" ? (
        <p className="notice notice--seam">{COPY.planReadOutage}</p>
      ) : view === "none" ? (
        <p className="muted">
          This account has no care plan. <Link href="/#pricing">Compare the care plans</Link>.
        </p>
      ) : plan ? (
        <>
          {status === "past_due" ? (
            <p role="alert" className="banner banner--outage">
              <TriangleAlert aria-hidden="true" size={20} />
              {COPY.pastDue}
            </p>
          ) : null}
          <p className="plan-status">Status: {planLabel(plan)}</p>
          <dl className="facts">
            <div>
              <dt>Tier</dt>
              <dd>{plan.planName}</dd>
            </div>
            <div>
              <dt>Monthly price</dt>
              <dd className="mono">{money(plan.monthlyPrice, plan.currency)}</dd>
            </div>
            <div>
              <dt>Period start</dt>
              <dd className="mono">{plan.periodStart ? longDate(plan.periodStart) : "—"}</dd>
            </div>
            <div>
              <dt>Charged through</dt>
              <dd className="mono">{plan.chargedThrough ? longDate(plan.chargedThrough) : "—"}</dd>
            </div>
            {plan.pauseOn ? (
              <div>
                <dt>{status === "paused" ? "Paused since" : "Pauses on"}</dt>
                <dd className="mono">{longDate(plan.pauseOn)}</dd>
              </div>
            ) : null}
            {plan.endsOn ? (
              <div>
                <dt>{status === "cancelled" ? "Ended on" : "Ends on"}</dt>
                <dd className="mono">{longDate(plan.endsOn)}</dd>
              </div>
            ) : null}
            {status === "past_due" ? (
              <div>
                <dt>Failed attempts</dt>
                <dd className="mono">{plan.failedAttempts} of 3</dd>
              </div>
            ) : null}
          </dl>
          <div className="plan-actions">
            {canChange ? (
              <button ref={switchButton} type="button" className="button button--primary" onClick={openChange} disabled={busy}>
                Switch to {other}
              </button>
            ) : null}
            {canChange ? (
              <button type="button" className="button button--secondary" disabled={busy} onClick={() => act("/api/plan/pause", (p) => copyFor.pauses(longDate(p.pauseOn ?? "")))}>
                Pause plan
              </button>
            ) : null}
            {(status === "active" && plan.pauseOn) || status === "paused" ? (
              <button type="button" className="button button--secondary" disabled={busy} onClick={() => act("/api/plan/resume", () => COPY.planActiveAgain)}>
                Resume plan
              </button>
            ) : null}
            {canChange ? (
              <button type="button" className="button button--danger" disabled={busy} onClick={() => setCancelling(true)}>
                Cancel plan
              </button>
            ) : null}
          </div>
          {status === "past_due" ? (
            <form aria-label="Update card" className="sheet-form" onSubmit={updateCard} noValidate>
              <h2 className="form-title">Update card</h2>
              <CardFields idPrefix="plan-card" value={card} errors={cardErrors} onChange={(value) => { setCard(value); cardKey.current = null; }} />
              <button type="submit" className="button button--primary" disabled={busy}>
                Update card and pay
              </button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="muted">Loading your plan from billing…</p>
      )}
      <p role="status" aria-label="Plan status" className="live">{message}</p>

      <Dialog open={changing} label="Confirm plan change" onClose={() => setChanging(false)}>
        <h2 className="dialog__title">Switch to {other}</h2>
        <p className="dialog__text">Billing credits the unused days of your current plan and charges {other} for the same days. The change takes effect now.</p>
        <QuoteSheet
          state={sheetState}
          figures={preview ? sheetOf(preview) : null}
          labels={["Credit", "New plan charge"]}
          outageCopy={message === COPY.previewExpired ? COPY.previewExpired : COPY.planActionOutage}
          note={preview ? `${preview.daysLeft} of ${preview.daysInPeriod} days left in this period.` : undefined}
        />
        <div className="dialog__actions">
          <button type="button" className="button button--primary" disabled={!preview || busy} onClick={confirmChange}>
            Confirm change
          </button>
          <button type="button" className="button button--secondary" onClick={() => setChanging(false)}>
            Keep current plan
          </button>
        </div>
      </Dialog>

      <Dialog open={cancelling} label="Cancel care plan" onClose={() => setCancelling(false)}>
        <h2 className="dialog__title">Cancel your care plan?</h2>
        <p className="dialog__text">
          Your plan keeps running until {plan?.chargedThrough ? longDate(plan.chargedThrough) : "the end of the paid period"}, the end of the period you've paid for. Nothing more is charged.
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={async () => {
              setCancelling(false);
              await act("/api/plan/cancel", (p) => copyFor.ends(longDate(p.endsOn ?? "")));
            }}
          >
            Cancel at period end
          </button>
          <button type="button" className="button button--secondary" onClick={() => setCancelling(false)}>
            Keep plan
          </button>
        </div>
      </Dialog>
    </div>
  );
}
