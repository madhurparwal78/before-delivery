import { useEffect, useState } from "react";
import { api, ApiFailure, type Verified } from "../api";
import { monDYyyy } from "../format";
import { NETWORK_COPY } from "../ui/feedback";
import { Icon } from "../ui/icons";

/** The public verification page: one certificate's summary and PDF, nothing else. */
export function Verify({ token }: { token: string }) {
  const [result, setResult] = useState<Verified | "invalid" | "offline" | null>(null);

  useEffect(() => {
    api<{ certificate: Verified }>("GET", `/api/verify/${encodeURIComponent(token)}`).then(
      (body) => setResult(body.certificate),
      (error: unknown) => setResult(error instanceof ApiFailure ? "invalid" : "offline"),
    );
  }, [token]);

  return (
    <div className="centre">
      <div role="status" aria-label="Activity status" aria-live="polite" className="sr-only" />
      {result === null && <p className="muted" aria-busy="true">Checking the certificate…</p>}
      {result === "offline" && <p role="alert">{NETWORK_COPY}</p>}
      {result === "invalid" && (
        <section className="card">
          <p className="eyebrow">Credwell verification</p>
          <h1>Link not valid</h1>
          <p className="muted">This verification link has expired, was revoked by the nurse, or was replaced by a newer link. Ask the nurse to share a new one.</p>
        </section>
      )}
      {result !== null && typeof result === "object" && (
        <section className="card wide">
          <div className="stack">
            <p className="eyebrow">{result.provider}</p>
            <h1>Certificate verification</h1>
            <p className="statement">{result.accreditation_statement}</p>
          </div>
          <dl className="facts">
            <dt>Nurse</dt>
            <dd>{result.nurse_name}</dd>
            <dt>Course</dt>
            <dd className="serif" style={{ fontSize: "19.2px" }}>
              {result.course_title}
            </dd>
            <dt>Contact hours</dt>
            <dd className="fig" style={{ textAlign: "left" }}>
              {result.contact_hours}
            </dd>
            <dt>Serial</dt>
            <dd className="fig" style={{ textAlign: "left" }}>
              {result.serial}
            </dd>
            <dt>Issued</dt>
            <dd>{monDYyyy(result.issued_on)}</dd>
            <dt>Status</dt>
            <dd>
              <strong>{result.state === "sealed" ? "Sealed" : "Revoked"}</strong>
              {result.state === "revoked" && <span className="muted"> — the provider has withdrawn this certificate.</span>}
            </dd>
          </dl>
          {result.state === "sealed" && (
            <a className="btn" href={`/api/verify/${encodeURIComponent(token)}/pdf`}>
              <Icon name="download" />
              Download PDF
            </a>
          )}
        </section>
      )}
    </div>
  );
}
