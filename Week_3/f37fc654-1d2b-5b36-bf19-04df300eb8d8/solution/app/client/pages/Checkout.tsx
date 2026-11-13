// `/c/<commission id>/checkout` — review, sign the agreement and pay the deposit while the hold lasts.
import { useState } from "react";
import { formatDay, percent, usd } from "../../shared/format";
import { Icon } from "../components/icons";
import { Countdown, PaymentSheet, holdEndedText, useHold } from "../components/Pay";
import { AppLink } from "../components/Shell";
import { HttpError, call } from "../lib/api";
import { toast } from "../lib/notices";
import { CommissionLinks, Failed, Missing, Skeleton, failureText, useLoad, useScene, type Commission } from "./common";
import { holdDay } from "./InstallDay";

export function Checkout({ id }: { id: string }) {
  useScene("working");
  const [load, reload] = useLoad<Commission>(`/api/commissions/${id}`);
  const { hold, secondsLeft, ended, refresh } = useHold(id);
  const [signature, setSignature] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [holdStatus, setHoldStatus] = useState("");

  if (load.status === "missing") return <Missing />;
  if (load.status === "failed") return <Failed message={load.message} />;
  if (load.status === "loading") return <main className="column"><Skeleton rows={5} /></main>;
  const c = load.data;
  const deposit = c.milestones.find((m) => m.label === "Deposit");
  const signed = Boolean(deposit?.id && deposit.killbillInvoiceId);
  const held = hold?.status === "held";

  const sign = async (): Promise<void> => {
    setErrors({});
    try {
      await call(`/api/commissions/${id}/sign`, { json: { signatureName: signature, acceptTerms: agree } });
      toast("Agreement signed. Your contract PDF is being prepared.");
      await reload();
    } catch (error) {
      if (error instanceof HttpError && error.status === 422) setErrors(error.errors);
      else if (error instanceof HttpError && error.code === "quote_expired") toast("This quote has expired. Refresh the quote to continue.");
      else if (error instanceof HttpError && error.code === "hold_expired") toast(hold ? holdEndedText(hold.date) : "Your hold has ended.");
      else toast(failureText(error));
    }
  };

  const holdAgain = async (): Promise<void> => {
    if (hold && (await holdDay(id, hold.date, setHoldStatus))) await Promise.all([refresh(), reload()]);
  };

  const endedPanel = ended && hold ? (
    <div className="held-ended">
      <h2>Your hold has ended</h2>
      <button type="button" className="button primary" onClick={() => void holdAgain()}>Hold {formatDay(hold.date)} again</button>
    </div>
  ) : null;
  const holdText = ended && hold ? holdEndedText(hold.date) : holdStatus;

  return (
    <main className="column">
      <header className="page-head">
        <p className="eyebrow">{c.title} · {c.venue.name}</p>
        <h1>Checkout</h1>
        <div className="row-actions">
          {held && <Countdown seconds={secondsLeft} />}
          {hold && <span className="badge">Install day {formatDay(hold.date)}</span>}
        </div>
      </header>
      <p role="status" aria-label="Hold status" className="status-line">{holdText}</p>
      {!paying && endedPanel}
      {!hold && (
        <div className="row-actions">
          <p className="muted">Hold an install day first.</p>
          <AppLink href={`/c/${id}/day`} className="button">Pick a day</AppLink>
        </div>
      )}

      <section className="section" aria-labelledby="review-title">
        <h2 id="review-title">Review</h2>
        {c.quote && (
          <div className="panel quote-lines">
            {c.quote.lines.map((l) => <div key={l.label}><span>{l.label}</span><span>{usd(l.amountCents)}</span></div>)}
            <div className="quote-total"><span>Total</span><span>{usd(c.quote.totalCents)}</span></div>
          </div>
        )}
        <h3>Payment schedule</h3>
        <ul className="list">
          {c.milestones.map((m) => <li key={m.label} className="section-head"><span>{m.label} · {percent(m.scheduleBp)}%</span><span>{usd(m.amountCents)}</span></li>)}
        </ul>
        {c.funders.length > 0 && (
          <>
            <h3>Funders</h3>
            <ul className="list">{c.funders.map((f) => <li key={f.id} className="section-head"><span>{f.kind === "client" ? "You (lead client)" : f.name}</span><span>{percent(f.bp)}%</span></li>)}</ul>
          </>
        )}
      </section>

      <section className="section" aria-labelledby="sign-title">
        <h2 id="sign-title">Agreement</h2>
        <form className="stack" noValidate onSubmit={(e) => {
          e.preventDefault();
          void sign();
        }}>
          <div className="field">
            <label htmlFor="signature">Full name as signature</label>
            <input id="signature" className="input" placeholder="Your full name" autoComplete="name" value={signature} onChange={(e) => setSignature(e.target.value)} aria-describedby={errors.signatureName ? "signature-error" : undefined} />
            {errors.signatureName && <p className="field-error" id="signature-error">{errors.signatureName}</p>}
          </div>
          <label className="checkbox-line">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I agree to the commission agreement</span>
          </label>
          {errors.acceptTerms && <p className="field-error">{errors.acceptTerms}</p>}
          <div className="row-actions">
            <button type="submit" className={signed ? "button" : "button primary"}>Sign agreement</button>
          </div>
        </form>
      </section>

      <section className="section">
        {deposit && (
          <div className="row-actions">
            <button type="button" className="button primary" disabled={!signed || !held || deposit.state === "paid"} onClick={() => setPaying(true)}>
              Pay deposit {usd(deposit.amountCents)} <Icon name="arrowRight" />
            </button>
            {deposit.state === "paid" && <span className="badge on">Paid</span>}
          </div>
        )}
      </section>
      <section className="section" aria-label="Commission pages"><CommissionLinks id={id} /></section>

      {paying && deposit?.id && (
        <PaymentSheet amountCents={deposit.amountCents} path={`/api/milestones/${deposit.id}/payments`} holdDate={hold?.date} extra={endedPanel}
          onClose={() => setPaying(false)} onPaid={() => void reload()} />
      )}
    </main>
  );
}
