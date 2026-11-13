import { useEffect, useState } from "react";
import type { AuditEventJson, DocumentJson } from "../../shared/types";
import { api } from "../lib/api";
import { utcSecond } from "../lib/format";
import { useLiveEvents } from "../lib/live";
import { Link } from "../lib/router";
import { NotFound } from "./NotFound";

export function Audit({ id }: { id: string }) {
  const [events, setEvents] = useState<AuditEventJson[] | null>(null);
  const [doc, setDoc] = useState<DocumentJson | null>(null);
  const [missing, setMissing] = useState(false);

  const load = async () => {
    try {
      const [trail, document] = await Promise.all([
        api.get<{ events: AuditEventJson[] }>(`/api/documents/${id}/audit`),
        api.get<DocumentJson>(`/api/documents/${id}`),
      ]);
      setEvents(trail.events);
      setDoc(document);
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);
  useLiveEvents((event) => {
    if (event.type === "resync" || (event.type === "document" && event.documentId === id)) void load();
  });

  if (missing) return <NotFound />;
  // The table waits for both reads, so the title and hash never land above rows already drawn and push them down.
  if (!doc || !events) {
    return (
      <>
        <h1>Audit trail</h1>
        <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>
      </>
    );
  }
  return (
    <>
      <h1>Audit trail</h1>
      {doc ? (
        <p className="muted">
          <Link to={`/documents/${doc.id}`} className="textlink">
            {doc.title}
          </Link>
        </p>
      ) : null}
      {doc?.status === "completed" && doc.completedSha256 ? (
        <p className="completed-hash">
          <span className="muted">Completed PDF SHA-256</span> <span className="hash">{doc.completedSha256}</span>
        </p>
      ) : null}
      <div className="table-scroll">
        <table aria-label="Audit trail" className="table audit-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">#</th>
              <th scope="col" role="columnheader">Event</th>
              <th scope="col" role="columnheader">By</th>
              <th scope="col" role="columnheader">Time (UTC)</th>
              <th scope="col" role="columnheader">Hash</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {events.map((event) => (
              <tr key={event.seq} role="row">
                <td role="cell" className="mono">{event.seq}</td>
                <td role="cell" className="mono">{event.type}</td>
                <td role="cell">{event.actor}</td>
                <td role="cell" className="mono">{utcSecond(event.at)}</td>
                <td role="cell" className="mono hash-cell" title={event.hash}>
                  {event.hash.slice(0, 12)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
