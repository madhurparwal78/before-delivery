import { PiecePlacement, SaleKind, clipDefects, pieceShapes } from '../../shared/geometry';
import { volumeMm3 } from '../../shared/money';
import { LOCK_SCOPE_TICKET, advisoryLock, pool, rows, transaction } from '../db/pool';
import { loadBoard } from '../domain/boards';
import { KERF_ACCOUNT, boardAccount, writeMovement } from '../domain/ledger';
import { ApiError } from '../errors';
import { Reply, RequestContext, STAFF, jsonReply, pathParam, requireRole, requireUser } from '../http';
import { getObject } from '../services/s3';
import { Route, route } from './types';

type TicketStatus = 'issued' | 'at-saw' | 'done';

interface TicketRow {
  id: string;
  status: TicketStatus;
  board_tag: string;
  maker_id: string;
  maker_name: string;
  pieces: PiecePlacement[];
  cuts_mm: number[];
  take_mm: number;
  sale: SaleKind;
  offcut_tag: string | null;
  offcut_planned_mm: number | null;
  offcut_measured_mm: number | null;
  pdf_key: string;
  created_at: Date;
}

interface TicketEventRow {
  ticket_id: string;
  kind: string;
  by_name: string;
  at: Date;
}

const TICKET_COLUMNS = `
  t.id, t.status, t.board_tag, t.maker_id, t.pieces, t.cuts_mm, t.take_mm, t.sale, t.offcut_tag,
  t.offcut_planned_mm, t.offcut_measured_mm, t.pdf_key, t.created_at, u.name AS maker_name
`;

async function loadTicket(id: string): Promise<TicketRow | null> {
  const found = await rows<TicketRow>(
    pool,
    `SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.id = t.maker_id WHERE t.id = $1`,
    [id]
  );
  return found[0] ?? null;
}

async function loadEvents(ticketIds: string[]): Promise<Map<string, TicketEventRow[]>> {
  const byTicket = new Map<string, TicketEventRow[]>();
  if (ticketIds.length === 0) return byTicket;
  const found = await rows<TicketEventRow>(
    pool,
    `SELECT e.ticket_id, e.kind, e.at, u.name AS by_name FROM ticket_events e JOIN users u ON u.id = e.by_user_id
     WHERE e.ticket_id = ANY($1::text[]) ORDER BY e.id`,
    [ticketIds]
  );
  for (const event of found) {
    const list = byTicket.get(event.ticket_id) ?? [];
    list.push(event);
    byTicket.set(event.ticket_id, list);
  }
  return byTicket;
}

function ticketShape(ticket: TicketRow, events: TicketEventRow[]): Record<string, unknown> {
  return {
    id: ticket.id,
    status: ticket.status,
    board: ticket.board_tag,
    maker: { name: ticket.maker_name },
    pieces: pieceShapes(ticket.pieces),
    cuts_mm: ticket.cuts_mm,
    take_mm: ticket.take_mm,
    sale: ticket.sale,
    offcut:
      ticket.offcut_tag === null
        ? null
        : { tag: ticket.offcut_tag, planned_mm: ticket.offcut_planned_mm, measured_mm: ticket.offcut_measured_mm },
    pdf_key: ticket.pdf_key,
    created_at: ticket.created_at.toISOString(),
    events: events.map((event) => ({ kind: event.kind, by: { name: event.by_name }, at: event.at.toISOString() }))
  };
}

async function listTickets(context: RequestContext): Promise<Reply> {
  const user = requireUser(context);
  const status = context.url.searchParams.get('status');
  const mineOnly = user.role === 'maker';
  const found = await rows<TicketRow>(
    pool,
    `SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.id = t.maker_id
     WHERE ($1::text IS NULL OR t.maker_id = $1) AND ($2::text IS NULL OR t.status = $2)
     ORDER BY t.created_at DESC, t.id DESC`,
    [mineOnly ? user.id : null, status === '' ? null : status]
  );
  const events = await loadEvents(found.map((ticket) => ticket.id));
  return jsonReply(200, { tickets: found.map((ticket) => ticketShape(ticket, events.get(ticket.id) ?? [])) });
}

async function requireVisibleTicket(context: RequestContext, id: string): Promise<TicketRow> {
  const user = requireUser(context);
  const ticket = await loadTicket(id);
  if (ticket === null) throw new ApiError('not_found');
  if (user.role === 'maker' && ticket.maker_id !== user.id) throw new ApiError('not_found');
  return ticket;
}

async function readTicket(context: RequestContext): Promise<Reply> {
  const ticket = await requireVisibleTicket(context, pathParam(context, 'id'));
  const events = await loadEvents([ticket.id]);
  return jsonReply(200, { ticket: ticketShape(ticket, events.get(ticket.id) ?? []) });
}

async function readTicketPdf(context: RequestContext): Promise<Reply> {
  const ticket = await requireVisibleTicket(context, pathParam(context, 'id'));
  const stored = await getObject(ticket.pdf_key);
  if (stored === null) throw new ApiError('not_found');
  return {
    status: 200,
    body: stored.body,
    headers: { 'content-type': 'application/pdf', 'x-content-type-options': 'nosniff' }
  };
}

async function startTicket(context: RequestContext): Promise<Reply> {
  const staff = requireRole(context, STAFF);
  const id = pathParam(context, 'id');
  if ((await loadTicket(id)) === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    await advisoryLock(client, LOCK_SCOPE_TICKET, id);
    const current = await rows<{ status: TicketStatus }>(client, 'SELECT status FROM tickets WHERE id = $1 FOR UPDATE', [id]);
    if (current[0]?.status !== 'issued') throw new ApiError('ticket_state');
    await client.query(`UPDATE tickets SET status = 'at-saw' WHERE id = $1`, [id]);
    await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id, at) VALUES ($1, $2, $3, $4)', [
      id,
      'started',
      staff.id,
      context.now
    ]);
  });

  const ticket = await loadTicket(id);
  if (ticket === null) throw new Error('ticket vanished at the saw');
  const events = await loadEvents([id]);
  return jsonReply(200, { ticket: ticketShape(ticket, events.get(id) ?? []) });
}

async function finishTicket(context: RequestContext): Promise<Reply> {
  const staff = requireRole(context, STAFF);
  const id = pathParam(context, 'id');
  const before = await loadTicket(id);
  if (before === null) throw new ApiError('not_found');

  await transaction(async (client) => {
    await advisoryLock(client, LOCK_SCOPE_TICKET, id);
    const locked = await rows<TicketRow>(
      client,
      `SELECT ${TICKET_COLUMNS} FROM tickets t JOIN users u ON u.id = t.maker_id WHERE t.id = $1 FOR UPDATE OF t`,
      [id]
    );
    const ticket = locked[0];
    if (ticket === undefined) throw new ApiError('not_found');
    if (ticket.status !== 'at-saw') throw new ApiError('ticket_state');

    const planned = ticket.offcut_planned_mm;
    const given = context.json.offcut_mm;
    let measured: number | null = null;
    if (ticket.offcut_tag === null || planned === null) {
      if (given !== undefined) throw new ApiError('validation', { offcut_mm: 'This ticket has no offcut.' });
    } else {
      if (typeof given !== 'number' || !Number.isInteger(given) || given < 1 || given > planned) {
        throw new ApiError('validation', { offcut_mm: `Give a whole number of millimetres from 1 to ${planned}.` });
      }
      measured = given;
    }

    await client.query(`UPDATE tickets SET status = 'done', offcut_measured_mm = $2 WHERE id = $1`, [id, measured]);
    await client.query('INSERT INTO ticket_events (ticket_id, kind, by_user_id, at) VALUES ($1, $2, $3, $4)', [
      id,
      'done',
      staff.id,
      context.now
    ]);

    if (ticket.offcut_tag !== null && planned !== null && measured !== null) {
      const offcut = await loadBoard(client, ticket.offcut_tag);
      if (offcut === null) throw new Error('the offcut board is missing');
      await client.query('UPDATE boards SET length_mm = $2, defects = $3::jsonb WHERE tag = $1', [
        offcut.tag,
        measured,
        JSON.stringify(clipDefects(offcut.defects, measured))
      ]);
      const shortfall = planned - measured;
      if (shortfall > 0) {
        const trimmed = volumeMm3(offcut.thickness_mm, offcut.width_mm, shortfall);
        await writeMovement(client, {
          kind: 'trim',
          ticketId: id,
          byUserId: staff.id,
          at: context.now,
          entries: [
            { account: boardAccount(offcut.tag), volume_mm3: -trimmed },
            { account: KERF_ACCOUNT, volume_mm3: trimmed }
          ]
        });
      }
    }
  });

  const ticket = await loadTicket(id);
  if (ticket === null) throw new Error('ticket vanished at the saw');
  const events = await loadEvents([id]);
  return jsonReply(200, { ticket: ticketShape(ticket, events.get(id) ?? []) });
}

export const ticketRoutes: Route[] = [
  route('GET', '/api/tickets', true, listTickets),
  route('GET', '/api/tickets/:id', true, readTicket),
  route('GET', '/api/tickets/:id/pdf', true, readTicketPdf),
  route('POST', '/api/tickets/:id/start', true, startTicket),
  route('POST', '/api/tickets/:id/done', true, finishTicket)
];
