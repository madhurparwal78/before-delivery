// New-face applications (scout, director): the queue and one application's review, with the decisions the
// application's status allows.

import { useState } from "react";
import { api } from "../../../api.js";
import { Link, definePage } from "../../../router.js";
import { Button } from "../../../ui/button.js";
import { useAnnouncer } from "../../../ui/status.js";
import { formatDate } from "../../../../shared/format.js";
import { heightBoth } from "../../../../shared/measure.js";
import { LOADING, RecordsPage, useOfficeTime } from "./common.js";
import { failureCopy, useResource } from "../../../workspace/data.js";

type Status = "submitted" | "awaiting_guardian" | "approved" | "declined" | "signed";

interface Application {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string | null;
  office: "toronto" | "vancouver";
  heightCm: number | null;
  instagramFollowers: number | null;
  bio: string;
  status: Status;
  minor: boolean;
  guardianName: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  photos: Array<{ slot: string; url: string }>;
}

const STATUS_NAMES: Record<Status, string> = {
  submitted: "Submitted",
  awaiting_guardian: "Awaiting guardian consent",
  approved: "Approved",
  declined: "Declined",
  signed: "Signed",
};
const SLOT_NAMES: Record<string, string> = { front: "Front", profile: "Profile", full_length: "Full-length", smile: "Smiling" };

type Decision = "approve" | "decline" | "sign";

function ApplicationCard({ application, detail, onDecided, announce }: {
  application: Application;
  detail: boolean;
  onDecided: () => Promise<unknown>;
  announce: (text: string) => void;
}) {
  const officeTime = useOfficeTime();
  const [pending, setPending] = useState<Decision | null>(null);
  const name = `${application.firstName} ${application.lastName}`.trim();
  const titleId = `application-${application.id}`;

  const decide = async (decision: Decision) => {
    setPending(decision);
    const result = decision === "sign"
      ? await api("POST", `/api/applications/${application.id}/sign`, {})
      : await api("POST", `/api/applications/${application.id}/decision`, { decision });
    setPending(null);
    if (result.ok) {
      announce({
        approve: `Approved ${name}'s application.`,
        decline: `Declined ${name}'s application.`,
        sign: `Signed ${name} to the New Faces board.`,
      }[decision]);
      await onDecided();
      return;
    }
    const { error } = result;
    if (error.error === "awaiting_guardian") {
      announce("This applicant is a minor and a guardian has not approved yet.");
    } else if (error.error === "already_decided" && typeof error.decidedBy === "string" && typeof error.decidedAt === "string") {
      announce(`${error.decidedBy} already decided this application at ${officeTime(error.decidedAt)}.`);
      await onDecided();
    } else announce(failureCopy(error));
  };

  return (
    <article className={`application-card${detail ? " detail" : ""}`} aria-labelledby={titleId}>
      <header className="application-head">
        <h2 id={titleId}>{detail ? name : <Link href={`/workspace/applications/${application.id}`}>{name}</Link>}</h2>
        <p className="application-tags">
          {application.minor ? <span className="tag">Minor</span> : null}
          <span className="tag quiet">{STATUS_NAMES[application.status]}</span>
        </p>
      </header>
      <ul className="application-photos" aria-label={`Photos of ${name}`}>
        {application.photos.map((photo) => (
          <li key={photo.slot}>
            <img src={photo.url} alt={`${name}, ${SLOT_NAMES[photo.slot] ?? photo.slot} photo`} loading="lazy" />
          </li>
        ))}
      </ul>
      <dl className="facts compact">
        <div><dt>Office</dt><dd>{application.office === "toronto" ? "Toronto" : "Vancouver"}</dd></div>
        {application.dateOfBirth ? <div><dt>Date of birth</dt><dd>{formatDate(application.dateOfBirth)}</dd></div> : null}
        {application.heightCm !== null ? <div><dt>Height</dt><dd>{heightBoth(application.heightCm)}</dd></div> : null}
        {application.submittedAt ? <div><dt>Sent</dt><dd>{officeTime(application.submittedAt)}</dd></div> : null}
        {application.decidedBy && application.decidedAt ? (
          <div><dt>Decided</dt><dd>{application.decidedBy}, {officeTime(application.decidedAt)}</dd></div>
        ) : null}
        {detail && application.guardianName ? <div><dt>Guardian</dt><dd>{application.guardianName}</dd></div> : null}
      </dl>
      {detail && application.bio ? <p className="application-bio">{application.bio}</p> : null}
      {application.status === "awaiting_guardian" ? (
        <p className="muted">Decisions open once the guardian approves through their consent link.</p>
      ) : null}
      <div className="btn-row">
        {application.status === "submitted" ? (
          <>
            <Button pending={pending === "approve"} pendingLabel="Saving decision…" disabled={pending !== null}
              onClick={() => void decide("approve")}>Approve</Button>
            <Button variant="quiet" pending={pending === "decline"} pendingLabel="Saving decision…" disabled={pending !== null}
              onClick={() => void decide("decline")}>Decline</Button>
          </>
        ) : null}
        {application.status === "approved" ? (
          <Button pending={pending === "sign"} pendingLabel="Saving decision…" onClick={() => void decide("sign")}>Sign</Button>
        ) : null}
      </div>
    </article>
  );
}

function Queue() {
  const { data, reload } = useResource<{ applications: Application[] }>("/api/applications");
  const { message, announce } = useAnnouncer();
  const open = data?.applications.filter((a) => a.status !== "declined" && a.status !== "signed") ?? [];
  const closed = data?.applications.filter((a) => a.status === "declined" || a.status === "signed") ?? [];
  return (
    <RecordsPage title="Applications" lede="New faces waiting for a decision, newest first." statusName="Application"
      message={message}>
      {data ? (
        <>
          {open.length ? (
            <div className="application-grid">
              {open.map((application) => (
                <ApplicationCard key={application.id} application={application} detail={false} onDecided={reload}
                  announce={announce} />
              ))}
            </div>
          ) : <p className="empty-panel">No applications are waiting. New ones appear here as soon as they are sent.</p>}
          {closed.length ? (
            <section className="closed-applications" aria-labelledby="closed-title">
              <h2 id="closed-title">Decided</h2>
              <ul className="plain-list">
                {closed.map((application) => (
                  <li key={application.id}>
                    <Link href={`/workspace/applications/${application.id}`}>
                      {application.firstName} {application.lastName}
                    </Link>{" "}
                    <span className="muted">{STATUS_NAMES[application.status]}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : LOADING}
    </RecordsPage>
  );
}

function Review({ id }: { id: string }) {
  const { data, reload, failed } = useResource<Application>(`/api/applications/${id}`);
  const { message, announce } = useAnnouncer();
  return (
    <RecordsPage title={data ? `${data.firstName} ${data.lastName}` : "Application"}
      lede={<Link href="/workspace/applications">Back to the queue</Link>} statusName="Application" message={message}>
      {data ? <ApplicationCard application={data} detail onDecided={reload} announce={announce} />
        : failed ? <p className="empty-panel">This application is not in the queue.</p> : LOADING}
    </RecordsPage>
  );
}

definePage({ pattern: "/workspace/applications", kind: "workspace", roles: ["agency_director", "scout"],
  render: () => <Queue /> });
definePage({ pattern: "/workspace/applications/:id", kind: "workspace", roles: ["agency_director", "scout"],
  render: (match) => <Review key={match.params.id} id={match.params.id} /> });
