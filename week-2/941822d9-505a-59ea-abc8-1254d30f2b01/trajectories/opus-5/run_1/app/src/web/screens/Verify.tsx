import { useEffect, useState, type ReactNode } from 'react';
import { request } from '../lib/api.js';
import { CERTIFICATE_STATE_LABELS, formatProviderDate } from '../lib/format.js';
import type { VerificationCertificate } from '../lib/types.js';

type Outcome =
  | { readonly kind: 'loading' }
  | { readonly kind: 'valid'; readonly certificate: VerificationCertificate }
  | { readonly kind: 'invalid' };

export function Verify({ token }: { readonly token: string }): ReactNode {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'loading' });

  useEffect(() => {
    void request<{ certificate: VerificationCertificate }>(`/api/verify/${encodeURIComponent(token)}`).then(
      (result) => setOutcome({ kind: 'valid', certificate: result.certificate }),
      () => setOutcome({ kind: 'invalid' }),
    );
  }, [token]);

  if (outcome.kind === 'loading') {
    return (
      <main className="verify-page">
        <div className="verify-card">
          <p className="hint">Checking this verification link…</p>
        </div>
      </main>
    );
  }

  if (outcome.kind === 'invalid') {
    return (
      <main className="verify-page">
        <div className="verify-card">
          <h1>Link not valid</h1>
          <p>This verification link has been revoked, replaced or has expired.</p>
        </div>
      </main>
    );
  }

  const certificate = outcome.certificate;
  return (
    <main className="verify-page">
      <div className="verify-card">
        <h1>Certificate verification</h1>
        <p className="hint">{certificate.provider}</p>
        <p>{certificate.accreditation_statement}</p>
        <hr className="card-rule" />
        <dl>
          <dt>Nurse</dt>
          <dd>{certificate.nurse_name}</dd>
          <dt>Course</dt>
          <dd>{certificate.course_title}</dd>
          <dt>Contact hours</dt>
          <dd>{certificate.contact_hours}</dd>
          <dt>Serial</dt>
          <dd>{certificate.serial}</dd>
          <dt>Issued</dt>
          <dd>{certificate.issued_on === null ? 'Pending' : formatProviderDate(certificate.issued_on)}</dd>
          <dt>Status</dt>
          <dd>{CERTIFICATE_STATE_LABELS[certificate.state] ?? certificate.state}</dd>
        </dl>
        {certificate.state === 'sealed' ? (
          <a className="button" href={`/api/verify/${encodeURIComponent(token)}/pdf`}>
            Download PDF
          </a>
        ) : null}
      </div>
    </main>
  );
}
