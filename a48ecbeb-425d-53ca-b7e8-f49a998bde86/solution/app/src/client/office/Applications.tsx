import { Check, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { longDateTime, PROVINCE_NAMES } from "../../shared/format";
import { EmptyCrate, failureOf, Loading, PageFailure, useOfficeData } from "./shared";

// Retailer applications, newest first; submitted ones can be approved or declined once.

interface Application {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  province: string;
  status: "submitted" | "approved" | "declined";
  submitted_at: string;
}

const STATUS_WORDS: Record<Application["status"], string> = { submitted: "Submitted", approved: "Approved", declined: "Declined" };
const STATUS_BADGES: Record<Application["status"], string> = { submitted: "badge-pending", approved: "badge-applied", declined: "badge-rejected" };

export function Applications() {
  const { data, setData, failure } = useOfficeData<{ applications: Application[] }>("/api/owner/applications");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const decide = async (application: Application, decision: "approved" | "declined") => {
    setBusy(application.id);
    try {
      const { application: decided } = await api<{ application: Application }>("POST", `/api/owner/applications/${application.id}/decision`, { decision });
      setData((prev) => prev && { applications: prev.applications.map((a) => (a.id === decided.id ? decided : a)) });
      setStatus(`${decided.business_name}: ${STATUS_WORDS[decided.status]}.`);
    } catch (error) {
      setStatus(failureOf(error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="office-page">
      <h1>Applications</h1>
      <p role="status" aria-label="Decision status" className="status-line">
        {status}
      </p>
      {failure && !data && <PageFailure failure={failure} />}
      {!data && !failure && <Loading />}
      {data && data.applications.length === 0 && (
        <div className="empty">
          <EmptyCrate />
          <p>No applications yet.</p>
        </div>
      )}
      {data && data.applications.length > 0 && (
        <ul className="card-list">
          {data.applications.map((application) => (
            <li key={application.id}>
              <article aria-labelledby={`application-${application.id}`} className="office-card">
                <div className="office-card-head">
                  <h2 id={`application-${application.id}`}>{application.business_name}</h2>
                  <span className={`badge ${STATUS_BADGES[application.status]}`}>{STATUS_WORDS[application.status]}</span>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Contact</dt>
                    <dd>{application.contact_name}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>
                      <a href={`mailto:${application.email}`}>{application.email}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Province</dt>
                    <dd>{PROVINCE_NAMES[application.province] ?? application.province}</dd>
                  </div>
                  <div>
                    <dt>Submitted</dt>
                    <dd className="num">{longDateTime(new Date(application.submitted_at))}</dd>
                  </div>
                </dl>
                <div className="card-actions" aria-busy={busy === application.id}>
                  {application.status === "submitted" && (
                    <>
                      <button type="button" className="btn btn-primary" disabled={busy === application.id} onClick={() => void decide(application, "approved")}>
                        <Check size={18} aria-hidden="true" />
                        Approve
                      </button>
                      <button type="button" className="btn btn-secondary" disabled={busy === application.id} onClick={() => void decide(application, "declined")}>
                        <X size={18} aria-hidden="true" />
                        Decline
                      </button>
                    </>
                  )}
                  <a className="btn btn-quiet" href={`/api/owner/applications/${application.id}/licence`} target="_blank" rel="noopener">
                    <ExternalLink size={18} aria-hidden="true" />
                    View licence
                  </a>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
