import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { formatMoney, formatTaxPercent } from '../../shared/money';
import { formatStoreDateTime } from '../../shared/time';
import type { Agreement } from '../../shared/types';
import { api, ApiFailure, NetworkFailure } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { serverNow } from '../lib/serverClock';
import { StatusLine } from '../components/StatusLine';

const EXPIRED_COPY = 'This signing link has expired. Ask Keel & Bell for a new one.';

export function SignAgreement(): ReactNode {
  const { token } = useParams();
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [status, setStatus] = useState<string>(PENDING.loadAgreement);
  const [statusError, setStatusError] = useState(false);
  const [fullName, setFullName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signed, setSigned] = useState(false);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const answer = await api<{ server_now: string; agreement: Agreement }>(`/signing/${token ?? ''}`);
        setAgreement(answer.agreement);
        setStatus('');
      } catch (error) {
        setStatusError(true);
        if (error instanceof ApiFailure && error.status === 404) setStatus('This signing link is not valid.');
        else if (error instanceof ApiFailure && error.code === 'link_expired') setStatus(EXPIRED_COPY);
        else if (error instanceof ApiFailure && error.code === 'link_used') {
          setStatus('This agreement has already been signed.');
        } else if (error instanceof NetworkFailure) setStatus(NETWORK_COPY);
        else if (error instanceof ApiFailure) setStatus(error.message);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (agreement === null || signed || expired) return;
    const check = (): void => {
      const estimate = serverNow();
      if (estimate === null) return;
      if (estimate >= Date.parse(agreement.link_expires_at)) {
        const focusWasInForm = formRef.current?.contains(document.activeElement) ?? false;
        setExpired(true);
        setStatus(EXPIRED_COPY);
        setStatusError(true);
        if (focusWasInForm) requestAnimationFrame(() => statusRef.current?.focus());
      }
    };
    check();
    const timer = setInterval(check, 500);
    return () => clearInterval(timer);
  }, [agreement, signed, expired]);

  useEffect(() => {
    if (agreement === null || signed || expired) return;
    const timer = setInterval(() => {
      void api(`/signing/${token ?? ''}`).catch(() => undefined);
    }, 60000);
    return () => clearInterval(timer);
  }, [agreement, signed, expired, token]);

  const sign = async (): Promise<void> => {
    setBusy(true);
    setStatus(PENDING.sign);
    setStatusError(false);
    try {
      await api(`/signing/${token ?? ''}`, { method: 'POST', body: { full_name: fullName, agree } });
      setSigned(true);
      setStatus('Agreement signed. Keel & Bell will confirm delivery.');
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (error) {
      setStatusError(true);
      if (error instanceof ApiFailure && error.status === 422) {
        if (error.fields?.full_name !== undefined) setStatus('Type your full legal name.');
        else setStatus('Tick the box to agree.');
      } else if (error instanceof ApiFailure && error.code === 'link_expired') {
        setExpired(true);
        setStatus(EXPIRED_COPY);
      } else if (error instanceof ApiFailure && error.code === 'link_used') {
        setStatus('This agreement has already been signed.');
      } else if (error instanceof ApiFailure && error.status === 404) {
        setStatus('This signing link is not valid.');
      } else if (error instanceof ApiFailure && error.status === 503) {
        setStatus("We couldn't save your signed agreement. Nothing was signed; try again in a moment.");
      } else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
      } else if (error instanceof ApiFailure) {
        setStatus(error.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="sign-page">
      <h1>Rental agreement</h1>
      {agreement === null ? null : (
        <>
          <section className="agreement-text" aria-label="Agreement text" tabIndex={0}>
            <p>
              Keel &amp; Bell Music rents the instrument below to the family of {agreement.student_name} at{' '}
              {agreement.school_name} on a rent-to-own contract.
            </p>
            <ul className="plain">
              <li>
                <span className="label">Contract</span> <span className="mono">{agreement.contract_id}</span>
              </li>
              <li>
                <span className="label">Student</span> {agreement.student_name}
              </li>
              <li>
                <span className="label">Instrument</span> {agreement.instrument_label}{' '}
                <span className="mono">{agreement.serial}</span>
              </li>
              <li>
                <span className="label">Price list</span> <span className="mono">{agreement.terms.price_list_id}</span>
              </li>
              <li>
                <span className="label">Monthly base rent</span>{' '}
                <span className="figure">{formatMoney(agreement.terms.base_rent_cents)}</span>
              </li>
              {agreement.waiver ? (
                <li>
                  <span className="label">Monthly waiver</span>{' '}
                  <span className="figure">{formatMoney(agreement.terms.waiver_cents)}</span>
                </li>
              ) : null}
              <li>
                <span className="label">Purchase price</span>{' '}
                <span className="figure">{formatMoney(agreement.terms.purchase_price_cents)}</span>
              </li>
              <li>
                <span className="label">Term</span>{' '}
                <span className="figure">{`${agreement.terms.term_months} months`}</span>
              </li>
            </ul>
            <p>
              {`Sales tax at ${formatTaxPercent(agreement.terms.tax_rate_bp)} (the rate in force when billed applies).`}
            </p>
            <p>Each month of base rent builds equity toward the purchase price.</p>
            <ul className="plain">
              {agreement.terms.tiers.map((tier) => (
                <li key={tier.name}>{tier.label}</li>
              ))}
            </ul>
          </section>
          <p>{`This link works until ${formatStoreDateTime(agreement.link_expires_at)}.`}</p>
        </>
      )}

      {agreement !== null && !signed && !expired ? (
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            void sign();
          }}
        >
          <div className="field">
            <label htmlFor="full-legal-name">Full legal name</label>
            <input
              id="full-legal-name"
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} /> I have read
              and agree to this rental agreement
            </label>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            Sign agreement
          </button>
        </form>
      ) : null}

      <StatusLine name="Signing status" text={status} error={statusError} ref={statusRef} />
    </main>
  );
}
