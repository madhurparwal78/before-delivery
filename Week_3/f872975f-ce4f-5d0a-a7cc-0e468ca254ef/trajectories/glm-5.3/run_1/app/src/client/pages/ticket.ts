import { api, type Ticket } from '../api.js';
import { escapeHtml, type ShellState } from '../shell.js';
import { formatLength, formatUtc, readStoredUnit, ticketLabel, type Unit } from '../format.js';

export function renderTicketPage(_state: ShellState, id: string): string {
  return `<h1 class="page-title">Cut ticket</h1>
  <p class="live-status" id="ticket-loading">Loading ticket ${escapeHtml(id)}…</p>
  <div id="ticket-body"></div>`;
}

export function mountTicketPage(id: string): void {
  const host = document.getElementById('ticket-body') as HTMLElement;
  let unit: Unit = readStoredUnit();

  async function refresh(): Promise<void> {
    try {
      const result = await api.ticket(id);
      render(result.ticket);
    } catch {
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = notFoundHtml();
        document.getElementById('ticket-back-to-rack')?.focus();
      } else {
        host.innerHTML = notFoundHtml();
      }
    }
  }

  function render(ticket: Ticket): void {
    const isTable = window.innerWidth >= 768;
    const piecesHtml = ticket.pieces.map((piece, index) => {
      if (isTable) {
        return `<tr><td>${escapeHtml(piece.label)}</td><td class="mono">${formatLength(piece.start_mm, unit)}</td><td class="mono">${formatLength(piece.length_mm, unit)}</td></tr>`;
      }
      return `<div class="card"><div>${index + 1}. ${escapeHtml(piece.label)}</div><div class="mono">at ${formatLength(piece.start_mm, unit)}</div><div class="mono">${formatLength(piece.length_mm, unit)}</div></div>`;
    }).join('');
    const cuts = ticket.cuts_mm.map((cut) => formatLength(cut, unit)).join(', ');
    const events = ticket.events.map((event) => {
      const kind = event.kind === 'issued' ? 'Issued' : event.kind === 'started' ? 'Started' : 'Done';
      return `<li>${kind} by ${escapeHtml(event.by.name)}, ${formatUtc(event.at)}</li>`;
    }).join('');
    host.innerHTML = `
      <div class="board-meta">
        <span class="mono">${escapeHtml(ticket.id)}</span>
        <span class="badge">${ticketLabel(ticket.status)}</span>
        <span>Board <a href="/boards/${encodeURIComponent(ticket.board)}">${escapeHtml(ticket.board)}</a></span>
        <span>Maker ${escapeHtml(ticket.maker.name)}</span>
      </div>
      <div class="section">
        <h2>Pieces</h2>
        ${isTable ? `<table><thead><tr><th>Piece</th><th class="mono">Start</th><th class="mono">Length</th></tr></thead><tbody>${piecesHtml}</tbody></table>` : `<div>${piecesHtml}</div>`}
        <p class="mono">Cut positions ${cuts || '—'}</p>
        <p class="mono">Take ${formatLength(ticket.take_mm, unit)}</p>
        <p class="mono">Planned offcut ${ticket.offcut ? formatLength(ticket.offcut.planned_mm, unit) : 'none'}</p>
        <p class="mono">Measured offcut ${ticket.offcut?.measured_mm != null ? formatLength(ticket.offcut.measured_mm, unit) : '—'}</p>
      </div>
      <div class="section">
        <h2>Ticket history</h2>
        <ul class="plain" aria-label="Ticket history">${events || '<li>No events.</li>'}</ul>
      </div>
      <div class="section">
        <a href="/api/tickets/${encodeURIComponent(ticket.id)}/pdf" id="ticket-pdf">Ticket PDF</a>
      </div>`;
  }

  function notFoundHtml(): string {
    return `<div class="not-found">
      <h1>Not on this rack</h1>
      <p>Check the link, or go back to the rack.</p>
      <p><a href="/" id="ticket-back-to-rack">Back to the rack</a></p>
    </div>`;
  }

  void refresh();
}
