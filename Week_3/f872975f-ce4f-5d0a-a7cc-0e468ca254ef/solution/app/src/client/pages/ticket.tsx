// A cut ticket: pieces and cuts, take and offcut, its attributed history and the stored PDF.
import { useEffect, useState } from "react";
import type { Ticket } from "../../shared/api";
import { formatWhen, lengthText, TICKET_LABELS } from "../../shared/domain";
import { api, useUnit } from "../api";
import { NotFound } from "./notfound";

const KIND_LABELS = { issued: "Issued", started: "Started", done: "Done" } as const;

export function TicketPage({ id }: { id: string }) {
  const unit = useUnit();
  const [ticket, setTicket] = useState<Ticket | null | "missing">(null);
  useEffect(() => {
    void api<{ ticket: Ticket }>("GET", `/api/tickets/${encodeURIComponent(id)}`).then((r) => setTicket(r.ok ? r.data.ticket : "missing"));
  }, [id]);
  if (ticket === "missing") return <NotFound />;
  if (ticket === null) return <p className="muted loading">Loading the ticket…</p>;
  const len = (mm: number): string => lengthText(mm, unit);
  return (
    <article className="ticket">
      <header className="board-head">
        <div>
          <h1 className="mono-title">{ticket.id}</h1>
          <p className="board-species">Cut from <span className="mono">{ticket.board}</span> for {ticket.maker.name}</p>
        </div>
        <span className={`badge ${ticket.status}`}>{TICKET_LABELS[ticket.status]}</span>
      </header>
      <section aria-labelledby="pieces-heading">
        <h2 id="pieces-heading">Pieces</h2>
        <table className="data wide-only">
          <thead><tr><th scope="col">Piece</th><th scope="col">Length</th><th scope="col">Width</th><th scope="col">Starts at</th></tr></thead>
          <tbody>
            {ticket.pieces.map((p, i) => (
              <tr key={i}><th scope="row">{p.label}</th><td className="mono measure">{len(p.length_mm)}</td><td className="mono measure">{len(p.width_mm)}</td><td className="mono measure">{len(p.start_mm)}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="stacked narrow-only">
          {ticket.pieces.map((p, i) => (
            <li key={i}>
              <strong>{p.label}</strong>
              <span className="mono measure">{len(p.length_mm)} × {len(p.width_mm)}</span>
              <span>starts at <span className="mono measure">{len(p.start_mm)}</span></span>
            </li>
          ))}
        </ul>
      </section>
      <dl className="facts">
        <div><dt>Cuts at</dt> <dd className="mono measure">{ticket.cuts_mm.length ? ticket.cuts_mm.map(len).join(", ") : "No cuts"}</dd></div>
        <div><dt>Take</dt> <dd className="mono measure">{len(ticket.take_mm)}</dd></div>
        <div><dt>Planned offcut</dt> <dd className="mono measure">{ticket.offcut ? `${len(ticket.offcut.planned_mm)} (${ticket.offcut.tag})` : "None, whole board"}</dd></div>
        {ticket.offcut && <div><dt>Measured offcut</dt> <dd className="mono measure">{ticket.offcut.measured_mm === null ? "Not measured yet" : len(ticket.offcut.measured_mm)}</dd></div>}
      </dl>
      <section aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
        <ol aria-label="Ticket history" className="rows">
          {ticket.events.map((e, i) => <li key={i} className="row-line">{`${KIND_LABELS[e.kind]} by ${e.by.name}, ${formatWhen(e.at)}`}</li>)}
        </ol>
      </section>
      <p><a className="button quiet" href={`/api/tickets/${ticket.id}/pdf`} target="_blank" rel="noopener">Ticket PDF</a></p>
    </article>
  );
}
