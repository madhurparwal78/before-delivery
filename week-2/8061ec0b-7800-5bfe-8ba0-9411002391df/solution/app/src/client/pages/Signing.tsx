// The signing page, reached from the emailed link without signing in. It states how long the link works and replaces
// the form with the expired message when the link expires on the server's clock while the page is open.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { SigningAgreement } from "../../shared/api.js";
import { formatMoney, formatTaxPercent } from "../../shared/money.js";
import { formatDateTime } from "../../shared/storeTime.js";
import { call, NETWORK_COPY } from "../api.js";
import { errorNotice, Field, info, Status, type Notice } from "../components/ui.js";
import { hasPassed, SERVER_CLOCK_REFRESH_MS } from "../serverClock.js";

const EXPIRED = "This signing link has expired. Ask Keel & Bell for a new one.";

function loadCopy(code: string | undefined, status: number): string {
  if (status === 404) return "This signing link is not valid.";
  if (code === "link_used") return "This agreement has already been signed.";
  if (code === "link_expired") return EXPIRED;
  return NETWORK_COPY;
}

export function Signing({ token }: { token: string }): ReactNode {
  const [agreement, setAgreement] = useState<SigningAgreement | null>(null);
  const [state, setState] = useState<"loading" | "open" | "closed">("loading");
  const [notice, setNotice] = useState<Notice>(info("Loading agreement…"));
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);

  const requestFocus = useRef(false);
  const closeWith = (copy: Notice, focus: boolean): void => {
    setState("closed");
    setNotice(copy);
    if (focus) requestFocus.current = true;
  };

  useEffect(() => {
    void call<{ agreement: SigningAgreement; server_now: string }>("GET", `/api/signing/${encodeURIComponent(token)}`).then((r) => {
      if (r.ok) {
        setAgreement(r.data.agreement);
        setState("open");
        setNotice(info(""));
      } else {
        setState("closed");
        setNotice(errorNotice(loadCopy(r.error?.code, r.status)));
      }
    });
  }, [token]);

  useEffect(() => {
    if (state !== "open" || agreement === null) return;
    const timer = window.setInterval(() => {
      if (!hasPassed(agreement.link_expires_at)) return;
      const focusInside = form.current?.contains(document.activeElement) ?? false;
      closeWith(errorNotice(EXPIRED), focusInside);
    }, 250);
    // Asking again keeps the page's estimate of the server clock fresh, and closes a link that died meanwhile.
    const recheck = window.setInterval(() => {
      void call("GET", `/api/signing/${encodeURIComponent(token)}`).then((r) => {
        if (!r.ok && r.status !== 0 && r.status < 500) {
          closeWith(errorNotice(loadCopy(r.error?.code, r.status)), form.current?.contains(document.activeElement) ?? false);
        }
      });
    }, SERVER_CLOCK_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(recheck);
    };
  }, [state, agreement, token]);

  useLayoutEffect(() => {
    if (requestFocus.current) {
      status.current?.focus();
      requestFocus.current = false;
    }
  });

  const terms = agreement?.terms;
  return (
    <section className="page signing">
      <header className="page__head">
        <p className="eyebrow">Keel &amp; Bell Music</p>
        <h1>Rental agreement</h1>
      </header>
      {agreement && terms && (
        <>
          <section className="agreement" aria-label="Agreement text" tabIndex={0}>
            <p className="agreement__lead">
              Rent-to-own agreement for <strong>{agreement.student_name}</strong> of {agreement.school_name}, contract <span className="figure">{agreement.contract_id}</span>.
            </p>
            <dl className="terms-list">
              <div><dt>Instrument</dt><dd>{agreement.instrument_label}, serial <span className="figure">{agreement.serial}</span></dd></div>
              <div><dt>Price list</dt><dd className="figure">{terms.price_list_id}</dd></div>
              <div><dt>Monthly base rent</dt><dd className="figure">{formatMoney(terms.base_rent_cents)}</dd></div>
              <div><dt>Maintenance and damage waiver</dt><dd className="figure">{agreement.waiver ? `${formatMoney(terms.waiver_cents)} a month` : "Not chosen"}</dd></div>
              <div><dt>Purchase price</dt><dd className="figure">{formatMoney(terms.purchase_price_cents)}</dd></div>
              <div><dt>Term</dt><dd className="figure">{terms.term_months} months</dd></div>
            </dl>
            <p>Sales tax at {formatTaxPercent(terms.tax_rate_bp)} applies to each month's rent and waiver; the rate in force when billed applies.</p>
            <p>Each month's base rent adds equity toward the purchase price. When equity reaches the purchase price, the instrument is yours and Keel &amp; Bell sends a bill of sale. You may buy out early; a stepped discount comes off the remaining balance:</p>
            <ul className="tier-list">
              {terms.tiers.map((t) => (
                <li key={t.from_month}><span className="label-caps">{t.name}</span> months <span className="figure">{t.from_month}{t.to_month === null ? " onward" : `–${t.to_month}`}</span>: {t.percent}% off remaining</li>
              ))}
            </ul>
            <p>The instrument stays the property of Keel &amp; Bell Music until it is paid off. Return it in the condition recorded at check-out, allowing for ordinary wear.</p>
          </section>
          <p className="agreement__expiry">This link works until {formatDateTime(agreement.link_expires_at)}.</p>
        </>
      )}
      {state === "open" && (
        <form ref={form} className="form signing__form" noValidate onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setNotice(info("Signing…"));
          void call("POST", `/api/signing/${encodeURIComponent(token)}`, { full_name: name, agree }).then((r) => {
            setBusy(false);
            if (r.ok) {
              closeWith(info("Agreement signed. Keel & Bell will confirm delivery."), true);
            } else if (r.status === 422) {
              const fields = r.error?.fields ?? {};
              setNotice(errorNotice(fields.full_name ? "Type your full legal name." : "Tick the box to agree."));
            } else if (r.status === 503) {
              setNotice(errorNotice("We couldn't save your signed agreement. Nothing was signed; try again in a moment."));
            } else if (r.status === 404 || r.status === 410) {
              closeWith(errorNotice(loadCopy(r.error?.code, r.status)), true);
            } else {
              setNotice(errorNotice(NETWORK_COPY));
            }
          });
        }}>
          <Field label="Full legal name" htmlFor="signer-name">
            <input id="signer-name" autoComplete="name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.currentTarget.checked)} />
            <span>I have read and agree to this rental agreement</span>
          </label>
          <button type="submit" className="button button--primary" disabled={busy}>Sign agreement</button>
        </form>
      )}
      <Status ref={status} label="Signing status" notice={notice} />
    </section>
  );
}
