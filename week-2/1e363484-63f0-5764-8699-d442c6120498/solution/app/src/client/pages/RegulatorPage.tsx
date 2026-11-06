// Public regulator pages: one sealed figure from a link, decided by the server at every request.

import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../api";
import { COPY, rederived } from "../copy";
import { minuteDisplay, secondDisplay } from "../format";
import { useAnnouncer } from "../hooks";
import { Link } from "../router";
import type { AuditTrail, PublicFigure } from "../types";
import { FigureFacts } from "../ui/FigureFacts";
import { Wordmark } from "../ui/Shell";
import { Num } from "../ui/tables";
import { AuditView } from "./AuditPage";

type Ended = keyof Pick<typeof COPY, "expired" | "revoked" | "unknown">;

/** The ended page for a refused public request, or null when the request was answered. */
function endedBy(status: number, body: unknown): Ended | null {
  if (status === 404) return "unknown";
  if (status !== 410) return null;
  return (body as { error?: string } | null)?.error === "link_revoked" ? "revoked" : "expired";
}

function EndedPage({ which }: { which: Ended }) {
  return (
    <main className="public-page ended">
      <h1>{COPY[which].heading}</h1>
      <p>{COPY[which].line}</p>
    </main>
  );
}

function PublicFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-frame">
      <div className="public-mark" aria-hidden="true"><Wordmark /></div>
      {children}
    </div>
  );
}

const VERDICT = { sealed: "Intact", broken: "Broken", superseded: "Superseded" } as const;

export function RegulatorPage({ token }: { token: string }) {
  const [view, setView] = useState<PublicFigure | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const { region, announce } = useAnnouncer();
  const base = `/api/public/links/${token}`;

  useEffect(() => {
    void request<PublicFigure>("GET", base, undefined, { allowUnauthenticated: true }).then((r) => {
      if (r.status === 200) setView(r.data);
      else setEnded(endedBy(r.status, r.data) ?? "unknown");
    });
  }, [base]);

  const rederive = async () => {
    announce(COPY.rederivePending);
    const r = await request<PublicFigure>("POST", `${base}/rederive`, {}, { allowUnauthenticated: true }).catch(() => null);
    const end = r && endedBy(r.status, r.data);
    if (end) return setEnded(end);
    if (!r || r.status !== 200) return announce(COPY.rederiveFailed);
    setView(r.data);
    announce(rederived(secondDisplay(r.data.figure.checked_at), VERDICT[r.data.figure.status]));
  };

  const download = async () => {
    setAlert(null);
    const response = await fetch(`${base}/evidence`).catch(() => null);
    if (!response) return setAlert(COPY.fileUnavailable);
    const body = response.ok ? null : await response.json().catch(() => null);
    const end = endedBy(response.status, body);
    if (end) return setEnded(end);
    if (response.status === 409) return setAlert(COPY.fileMismatch);
    if (!response.ok) return setAlert(COPY.fileUnavailable);
    const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "readings.csv";
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (ended) return <EndedPage which={ended} />;
  if (!view) return <PublicFrame><p className="loading num">Loading…</p></PublicFrame>;
  const { figure, link, project } = view;
  const statusText = figure.status === "superseded" ? `Status: Superseded by ${figure.superseded_by}` : `Status: ${VERDICT[figure.status]}`;

  return (
    <PublicFrame>
      <main className="public-page page-reading">
        <header className="page-header">
          <p className="eyebrow">{project.name} · {project.kind}</p>
          <h1>Sealed figure {figure.id}</h1>
          <p className={`regulator-status status-${figure.status}`}>
            <span className="status-text">{statusText}</span>
            <span className="checked">Checked at <Num>{secondDisplay(figure.checked_at)}</Num></span>
          </p>
          <p className="expiry">Link expires <Num>{minuteDisplay(link.expires_at)}</Num></p>
        </header>
        {alert && <p role="alert" className="alert">{alert}</p>}
        <div className="regulator-actions">
          <button type="button" className="btn" onClick={() => void rederive()}>
            <RefreshCw size={16} aria-hidden="true" /> Re-derive
          </button>
          <Link href={`/r/${token}/audit`} className="btn">Readings audit trail</Link>
          <button type="button" className="btn" onClick={() => void download()}>
            <Download size={16} aria-hidden="true" /> Download readings file
          </button>
        </div>
        <div role="status" aria-label="Re-derivation status" className="status-line num" ref={region} />
        <FigureFacts figure={figure} />
      </main>
    </PublicFrame>
  );
}

export function RegulatorAuditPage({ token }: { token: string }) {
  const [trail, setTrail] = useState<AuditTrail | null>(null);
  const [ended, setEnded] = useState<Ended | null>(null);
  useEffect(() => {
    void request<AuditTrail>("GET", `/api/public/links/${token}/audit`, undefined, { allowUnauthenticated: true }).then((r) => {
      if (r.status === 200) setTrail(r.data);
      else setEnded(endedBy(r.status, r.data) ?? "unknown");
    });
  }, [token]);
  if (ended) return <EndedPage which={ended} />;
  return (
    <PublicFrame>
      <main className="public-page page-reading">
        {trail ? <AuditView trail={trail} back={{ href: `/r/${token}`, label: `Sealed figure ${trail.figure_id}` }} /> : <p className="loading num">Loading…</p>}
      </main>
    </PublicFrame>
  );
}
