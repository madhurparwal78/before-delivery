import { useEffect, useState } from "react";
import { FileText, Image, Sheet } from "lucide-react";
import { api, ApiFailure } from "../api.js";
import { euro, wallClock } from "../format.js";
import { useTitle } from "../ui.js";
import { RECAP_REASON_COPY, type RecapReason } from "../../shared/copy.js";

interface PublicRecap {
  workshop: { title: string; scheduledStart: string; scheduledEnd: string; timeZone: string };
  status: "queued" | "complete";
  reason: RecapReason | null;
  invoice: { number: string; amount: string; currency: "EUR" } | null;
  files: { name: string; label: string; url: string; contentType: string }[];
  clusters: { frame: string; title: string; dotTotal: number; notes: string[] }[];
}

const ICONS = { "application/pdf": FileText, "text/csv; charset=utf-8": Sheet, "image/png": Image } as const;

export function Recap({ token }: { token: string }) {
  const [recap, setRecap] = useState<PublicRecap | null>(null);
  const [missing, setMissing] = useState(false);
  useTitle(recap ? `Recap: ${recap.workshop.title}` : "Recap");

  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = () =>
      api<PublicRecap>("GET", `/api/recaps/${encodeURIComponent(token)}`).then(
        (r) => {
          if (!live) return;
          setRecap(r);
          if (r.status === "queued") timer = window.setTimeout(load, 5000);
        },
        (e: unknown) => {
          if (!live) return;
          if (e instanceof ApiFailure && e.status === 404) setMissing(true);
          else timer = window.setTimeout(load, 5000);
        },
      );
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [token]);

  if (missing)
    return (
      <div className="page">
        <main className="column">
          <h1 className="display-sm">Recap not found</h1>
          <p className="muted">This recap link doesn't match a workshop. Check the link in your email.</p>
        </main>
      </div>
    );
  if (!recap)
    return (
      <div className="page">
        <main className="column">
          <h1 className="display-sm">Recap</h1>
          <p className="muted">Loading the recap…</p>
        </main>
      </div>
    );

  const status = recap.status === "complete" ? "Recap sent" : recap.reason ? RECAP_REASON_COPY[recap.reason] : "Recap in progress";
  return (
    <div className="page">
      <header className="site-header">
        <span className="wordmark">Lanternfold Rooms</span>
      </header>
      <main className="column recap">
        <p className="eyebrow">
          {wallClock(recap.workshop.scheduledStart)} · {recap.workshop.timeZone}
        </p>
        <h1 className="display">Recap: {recap.workshop.title}</h1>
        <p className={recap.status === "complete" ? "recap-status" : "recap-status queued"}>{status}</p>
        {recap.invoice && (
          <p className="mono invoice-line">
            Invoice {recap.invoice.number} — {euro(recap.invoice.amount)}
          </p>
        )}
        <section className="ruled-section">
          <h2 className="h3">Files</h2>
          <ul aria-label="Recap files" className="ruled-list">
            {recap.files.map((f) => {
              const Icon = ICONS[f.contentType as keyof typeof ICONS] ?? FileText;
              return (
                <li key={f.name} className="ruled-row">
                  <a href={f.url} className="file-link" download>
                    <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
                    {f.label}
                  </a>
                </li>
              );
            })}
          </ul>
          {recap.files.length === 0 && <p className="empty">The files appear here once they're stored.</p>}
        </section>
        <section className="ruled-section">
          <h2 className="h3">Cluster ranking</h2>
          <ol aria-label="Cluster ranking" className="ranking">
            {recap.clusters.map((c, i) => (
              <li key={`${c.frame}-${c.title}-${i}`} className="ranking-row">
                <p className="ranking-head">
                  <span className="ranking-title">{c.title}</span>
                  <span className="muted">{c.frame}</span>
                  <span className="mono">{c.dotTotal} dots</span>
                </p>
                <div className="ranking-notes">
                  {c.notes.map((n, j) => (
                    <p key={j}>{n}</p>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          {recap.clusters.length === 0 && <p className="empty">No clusters were made in this workshop.</p>}
        </section>
      </main>
    </div>
  );
}
