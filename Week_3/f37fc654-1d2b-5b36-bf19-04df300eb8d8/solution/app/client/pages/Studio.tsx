// `/studio` (the producer's live board) and `/studio/jobs` (every durable job).
import { useEffect, useRef, useState } from "react";
import { formatDay, usd } from "../../shared/format";
import { AppLink } from "../components/Shell";
import { onEvent } from "../lib/events";
import { Badge, Empty, Failed, Skeleton, useLoad, useScene } from "./common";
import type { CommissionRow } from "./Commissions";

export function Studio() {
  useScene("working");
  const [load, reload] = useLoad<{ commissions: CommissionRow[] }>("/api/commissions");
  const [announcement, setAnnouncement] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const rows = useRef<CommissionRow[]>([]);
  if (load.status === "ready") rows.current = load.data.commissions;

  useEffect(() => onEvent((event, data) => {
    if (event === "payment.confirmed") {
      const title = rows.current.find((r) => r.id === data.commissionId)?.title ?? "a commission";
      setAnnouncement(`${String(data.payerName)} paid ${usd(Number(data.amountCents))} toward ${title}.`);
      setFlash(String(data.commissionId));
      void reload();
    } else if (event === "commission.updated" || event === "hold.updated") void reload();
  }), [reload]);

  return (
    <main className="column wide">
      <header className="page-head">
        <p className="eyebrow">Spindrift Rooms studio</p>
        <h1>Studio</h1>
      </header>
      <p role="status" aria-label="Board updates" className="status-line">{announcement}</p>
      {load.status === "loading" && <Skeleton rows={4} />}
      {load.status === "failed" && <Failed message={load.message} />}
      {load.status === "ready" && (load.data.commissions.length ? (
        <div className="table-wrap" role="region" aria-label="Commissions board" tabIndex={0}>
          <table aria-label="Commissions">
            <thead><tr><th>Commission</th><th>Client</th><th>State</th><th>Install day</th><th className="num">Paid</th><th>Next due</th></tr></thead>
            <tbody>
              {load.data.commissions.map((c) => (
                <tr key={c.id} className={flash === c.id ? "flash" : undefined}>
                  <td><AppLink href={`/c/${c.id}`}>{c.title}</AppLink><br /><span className="muted">{c.venueName}</span></td>
                  <td>{c.clientName}</td>
                  <td><Badge state={c.state} on /></td>
                  <td className="nowrap">{c.installDate ? formatDay(c.installDate) : "—"}</td>
                  <td className="num nowrap">{usd(c.paidCents)} <span className="muted">of {usd(c.totalCents)}</span></td>
                  <td className="nowrap">{c.nextDueCents !== null && c.nextDueAt ? <>{usd(c.nextDueCents)}<br /><span className="muted">by {formatDay(c.nextDueAt.slice(0, 10))}</span></> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty question="Nothing commissioned yet. Start with the room?" drawing="room" />)}
    </main>
  );
}

interface Job { id: string; kind: string; commissionId: string | null; commissionTitle: string | null; status: string; attempts: number; lastError: string | null; createdAt: string; finishedAt: string | null }

const KIND_WORDS: Record<string, string> = { render_submit: "Render submit", render_store: "Preview storage", pdf: "PDF", email: "Email", crew_alert: "Crew alert", webhook: "CRM event" };

export function Jobs() {
  useScene("working");
  const [load, reload] = useLoad<{ jobs: Job[] }>("/api/jobs");
  useEffect(() => {
    const stop = onEvent((event) => {
      if (event === "job.updated") void reload();
    });
    const timer = setInterval(() => void reload(), 5000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [reload]);
  return (
    <main className="column wide">
      <header className="page-head">
        <p className="eyebrow">Durable jobs</p>
        <h1>Jobs</h1>
        <p className="muted">Every email, PDF, render, crew alert and CRM event waits here until its service answers, then takes effect once.</p>
      </header>
      {load.status === "loading" && <Skeleton rows={4} />}
      {load.status === "failed" && <Failed message={load.message} />}
      {load.status === "ready" && (load.data.jobs.length ? (
        <div className="table-wrap" role="region" aria-label="Jobs board" tabIndex={0}>
          <table aria-label="Jobs">
            <thead><tr><th>Kind</th><th>Commission</th><th>Status</th><th className="num">Attempts</th><th>Last error</th><th>Finished</th></tr></thead>
            <tbody>
              {load.data.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{KIND_WORDS[j.kind] ?? j.kind}</td>
                  <td>{j.commissionId ? <AppLink href={`/c/${j.commissionId}`}>{j.commissionTitle ?? j.commissionId}</AppLink> : "—"}</td>
                  <td><Badge state={j.status} on={j.status === "done"} /></td>
                  <td className="num">{j.attempts}</td>
                  <td className="muted">{j.lastError ?? "—"}</td>
                  <td>{j.finishedAt ? j.finishedAt.replace("T", " ").slice(0, 19) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty question="No jobs waiting. All quiet?" drawing="queue" />)}
    </main>
  );
}
