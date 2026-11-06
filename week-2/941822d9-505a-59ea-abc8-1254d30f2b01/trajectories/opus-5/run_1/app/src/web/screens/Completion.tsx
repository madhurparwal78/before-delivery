import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { StatusGlyph } from '../components/Glyph.js';
import { Seal, type SealState } from '../components/Seal.js';
import { ShareDialog } from '../components/ShareDialog.js';
import { takePressPending } from '../lib/press.js';
import type { Certificate, Enrolment } from '../lib/types.js';

const POLL_MS = 5000;

export function Completion({ enrolmentId }: { readonly enrolmentId: string }): ReactNode {
  const feedback = useFeedback();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [press, setPress] = useState<'unknown' | 'play' | 'static'>('unknown');
  const [jump, setJump] = useState(false);
  const [pressDone, setPressDone] = useState(false);
  const consumedPressFlag = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const downloadLink = useRef<HTMLAnchorElement>(null);
  const [focusAfterPress, setFocusAfterPress] = useState(false);

  const load = useCallback(async (): Promise<Certificate | null> => {
    const enrolmentResult = await request<{ enrolment: Enrolment }>(`/api/enrolments/${enrolmentId}`);
    setEnrolment(enrolmentResult.enrolment);
    if (enrolmentResult.enrolment.certificate_id === null) {
      setCertificate(null);
      return null;
    }
    const result = await request<{ certificate: Certificate }>(
      `/api/certificates/${enrolmentResult.enrolment.certificate_id}`,
    );
    setCertificate(result.certificate);
    return result.certificate;
  }, [enrolmentId]);

  useEffect(() => {
    if (!consumedPressFlag.current) {
      consumedPressFlag.current = true;
      setPress(takePressPending(enrolmentId) ? 'play' : 'static');
    }
    void load().catch(() => undefined);
  }, [enrolmentId, load]);

  useEffect(() => {
    if (press === 'play' && !pressDone && enrolment !== null) heading.current?.focus();
  }, [press, pressDone, enrolment]);

  useEffect(() => {
    if (certificate === null || certificate.state !== 'sealing') return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [certificate, load]);

  const onFinished = useCallback(() => {
    setPressDone(true);
    setFocusAfterPress(true);
  }, []);

  useEffect(() => {
    if (!focusAfterPress || certificate === null) return;
    setFocusAfterPress(false);
    if (certificate.state === 'sealed') shareButton.current?.focus();
    else downloadLink.current?.focus();
  }, [focusAfterPress, certificate]);

  const sealState: SealState =
    certificate === null ? 'open' : certificate.state === 'sealing' ? 'pending' : certificate.state;
  const modules = (enrolment?.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    minutes: module.minutes,
    verified: module.status === 'verified',
  }));
  const sealStatus =
    certificate === null
      ? ''
      : certificate.state === 'sealing'
        ? 'Certificate PDF pending'
        : `Certificate sealed: ${certificate.contact_hours} contact hours, serial ${certificate.serial}`;

  return (
    <>
      <h1 tabIndex={-1} ref={heading}>
        Your contact-hour seal
      </h1>
      {enrolment === null ? <p className="hint">Loading your seal…</p> : null}
      <div className="completion">
        <div className="seal-wrap">
          {press === 'unknown' || enrolment === null ? null : (
            <Seal
              state={sealState}
              modules={modules}
              hours={certificate?.contact_hours ?? '0.00'}
              serial={certificate?.serial ?? null}
              issuedOn={certificate?.issued_on ?? null}
              play={press === 'play'}
              jump={jump}
              onFinished={onFinished}
            />
          )}
          {sealState === 'pending' ? <p className="hint">Certificate PDF pending</p> : null}
          <div
            role="status"
            aria-label="Seal status"
            aria-live="polite"
            className="status-line"
            style={{ textAlign: 'center' }}
          >
            {pressDone ? sealStatus : ''}
          </div>
          <div className="seal-actions">
            {press === 'play' && !pressDone ? (
              <button type="button" className="quiet" onClick={() => setJump(true)}>
                Show result now
              </button>
            ) : null}
            <button
              type="button"
              ref={shareButton}
              disabled={certificate === null || certificate.state !== 'sealed' || !pressDone}
              onClick={() => setShareOpen(true)}
            >
              Share with a verifier
            </button>
            {certificate === null ? null : (
              <a
                className="button button--quiet"
                ref={downloadLink}
                href={`/api/certificates/${certificate.id}/pdf`}
                onClick={(event) => {
                  if (certificate.state === 'sealing') {
                    event.preventDefault();
                    feedback.warn('The certificate PDF is still being stored.');
                  }
                }}
              >
                Download certificate PDF
              </a>
            )}
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 'var(--h5)' }}>Modules</h2>
          <ul className="rows" aria-label="Modules">
            {(enrolment?.modules ?? []).map((module) => (
              <li key={module.id} className="row">
                <span className="row__main">
                  <span className="row__title">{module.title}</span>
                </span>
                <span className="row__figures">
                  <span className="nowrap">{module.minutes} min</span>
                  <span data-chip-for={module.id}>
                    <StatusGlyph verified={module.status === 'verified'} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {shareOpen && certificate !== null ? (
        <ShareDialog certificate={certificate} onClose={() => setShareOpen(false)} />
      ) : null}
    </>
  );
}
