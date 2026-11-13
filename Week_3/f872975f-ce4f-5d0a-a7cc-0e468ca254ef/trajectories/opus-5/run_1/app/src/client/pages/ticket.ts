import { getJson } from '../api';
import { clear, el } from '../dom';
import { formatInstant, length } from '../fmt';
import { Page } from '../shell';
import { onUnitChange, unit } from '../store';
import { Ticket } from '../types';
import { notFoundPage } from './notfound';

const STATUS_LABELS: Record<string, string> = { issued: 'Issued', 'at-saw': 'At saw', done: 'Done' };
const EVENT_LABELS: Record<string, string> = { issued: 'Issued', started: 'Started', done: 'Done' };

export async function ticketPage(id: string): Promise<Page> {
  const result = await getJson<{ ticket: Ticket }>(`/api/tickets/${encodeURIComponent(id)}`);
  if (!result.ok || result.data === null) return notFoundPage();
  const ticket = result.data.ticket;

  const piecesHolder = el('div', { class: 'ticket-pieces' });
  const figures = el('dl', { class: 'figures mono' });

  function renderPieces(): void {
    clear(piecesHolder);
    const wide = window.matchMedia('(min-width: 768px)').matches;
    if (wide) {
      piecesHolder.appendChild(
        el('table', { class: 'pieces-table mono' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Piece' }),
              el('th', { text: 'Length' }),
              el('th', { text: 'Width' }),
              el('th', { text: 'Starts at' })
            ])
          ]),
          el(
            'tbody',
            {},
            ticket.pieces.map((piece) =>
              el('tr', {}, [
                el('td', { text: piece.label }),
                el('td', { text: length(piece.length_mm, unit()) }),
                el('td', { text: length(piece.width_mm, unit()) }),
                el('td', { text: length(piece.start_mm, unit()) })
              ])
            )
          )
        ])
      );
    } else {
      piecesHolder.appendChild(
        el(
          'ul',
          { class: 'pieces-stack mono', attrs: { role: 'list' } },
          ticket.pieces.map((piece) =>
            el('li', { attrs: { role: 'listitem' } }, [
              el('span', { text: piece.label }),
              el('span', { text: `${length(piece.length_mm, unit())} × ${length(piece.width_mm, unit())}` }),
              el('span', { text: `starts at ${length(piece.start_mm, unit())}` })
            ])
          )
        )
      );
    }
  }

  function renderFigures(): void {
    clear(figures);
    const add = (term: string, value: string): void => {
      figures.appendChild(el('dt', { text: term }));
      figures.appendChild(el('dd', { text: value }));
    };
    add('Cuts', ticket.cuts_mm.map((cut) => length(cut, unit())).join(', '));
    add('Take', length(ticket.take_mm, unit()));
    add('Planned offcut', ticket.offcut === null ? 'none' : length(ticket.offcut.planned_mm, unit()));
    add(
      'Measured offcut',
      ticket.offcut === null || ticket.offcut.measured_mm === null ? 'not measured' : length(ticket.offcut.measured_mm, unit())
    );
  }

  renderPieces();
  renderFigures();

  const element = el('section', { class: 'page ticket' }, [
    el('h1', { class: 'page-title mono', text: ticket.id }),
    el('p', { class: 'row' }, [
      el('span', { class: 'badge', text: STATUS_LABELS[ticket.status] ?? ticket.status }),
      el('span', { class: 'mono', text: `Cut from ${ticket.board}` })
    ]),
    el('h2', { text: 'Pieces' }),
    piecesHolder,
    figures,
    el('h2', { text: 'History' }),
    el(
      'ul',
      { class: 'history', attrs: { role: 'list', 'aria-label': 'Ticket history' } },
      ticket.events.map((event) =>
        el('li', {
          attrs: { role: 'listitem' },
          text: `${EVENT_LABELS[event.kind] ?? event.kind} by ${event.by.name}, ${formatInstant(event.at)}`
        })
      )
    ),
    el('a', { text: 'Ticket PDF', attrs: { href: `/api/tickets/${ticket.id}/pdf`, target: '_blank', rel: 'noopener' } })
  ]);

  let resizeTimer = 0;
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(renderPieces, 120);
  };
  window.addEventListener('resize', onResize);
  const stopUnits = onUnitChange(() => {
    renderPieces();
    renderFigures();
  });

  return {
    element,
    banners: ['storage'],
    destroy: () => {
      window.removeEventListener('resize', onResize);
      stopUnits();
    }
  };
}
