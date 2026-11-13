import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyPassword } from '../db/store.js';
import type { Store, User } from '../db/store.js';
import { Actions, type KillBillLike, type StorageLike } from '../db/actions.js';
import { ApiError } from './errors.js';
import { JSON_LIMIT, PHOTO_LIMIT, readBody, sendBytes, sendJson } from './request.js';
import { canViewBoard, isStaff } from '../api/shapes.js';
import {
  listBoards,
  boardDetail,
  intakeBoard,
  uploadPhoto,
  gradeBoard,
  listBoard,
  correctDimensions,
  reparent,
  lineage,
  fitCheck,
  importLayout,
  exportLayout,
  holdJsonFor,
  holdsWithNames,
  createHold,
  cancelHold,
  purchaseHold,
  startTicket,
  doneTicket,
  ticketJson,
  invoiceJson,
  movementJson,
} from '../db/api-actions.js';
import { validateIdempotencyKey, validateIntake, validateLot, validateRateBody, asRecord } from '../domain/validation.js';

export interface RouteState {
  store: Store;
  actions: Actions;
  holdSeconds: number;
  killbill: KillBillLike;
  storage: StorageLike;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  user: User | null;
  sessionToken: string | null;
  body: Buffer;
  bodyOverflow: boolean;
  contentType: string;
  origin: string | null;
  ownOrigin: string;
  idempotencyKey: string | undefined;
}

export async function handleApi(
  state: RouteState,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  pathname: string,
  query: URLSearchParams,
  sessionToken: string | null,
  user: User | null,
  origin: string | null,
): Promise<void> {
  const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
  const bodyResult = await readBody(req, isPhotoPath(pathname) ? PHOTO_LIMIT : JSON_LIMIT);
  const ctx: Ctx = {
    req,
    res,
    method,
    path: pathname,
    query,
    user,
    sessionToken,
    body: bodyResult.buffer,
    bodyOverflow: bodyResult.overflow,
    contentType,
    origin,
    ownOrigin: `http://${req.headers.host ?? ''}`,
    idempotencyKey: typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined,
  };
  try {
    await route(state, ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, JSON.parse(error.body()));
      return;
    }
    console.error('api error', error);
    sendJson(res, 500, { error: 'not_found', message: 'Something went wrong. Try again.' });
  }
}

function isPhotoPath(path: string): boolean {
  return /^\/api\/boards\/[^/]+\/photos$/.test(path);
}

async function route(state: RouteState, ctx: Ctx): Promise<void> {
  const { res, method, path, query, user } = ctx;
  function jsonParse(): unknown {
    if (!ctx.contentType.startsWith('application/json')) throw new ApiError('unsupported_media_type', 'JSON required');
    if (ctx.bodyOverflow) throw new ApiError('too_large', 'Body too large');
    if (ctx.body.length > JSON_LIMIT) throw new ApiError('too_large', 'Body too large');
    try {
      return JSON.parse(ctx.body.toString('utf8'));
    } catch {
      throw new ApiError('bad_json', 'Body is not valid JSON');
    }
  }
  const json = <T>(): T => {
    if (parsedJson === undefined) parsedJson = jsonParse();
    return parsedJson as T;
  };

  // Health and services first: they never need auth.
  if (path === '/api/health' && method === 'GET') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }
  if (path === '/api/services' && method === 'GET') {
    const [billing, storage] = await Promise.all([state.killbill.ping(), state.storage.ping()]);
    sendJson(res, 200, { billing: billing ? 'up' : 'down', storage: storage ? 'up' : 'down' });
    return;
  }

  // Boundary content checks run before auth for JSON routes.
  const jsonRoute = method === 'POST' || method === 'PUT' ? !isPhotoPath(path) : false;
  let parsedJson: unknown = undefined;
  if (jsonRoute) {
    parsedJson = jsonParse();
  }

  // Boundary check for state-changing requests.
  if (['POST', 'PUT', 'DELETE'].includes(method) && ctx.origin !== null && ctx.origin !== ctx.ownOrigin) {
    throw new ApiError('cross_origin', 'Cross-origin request refused');
  }

  const requireUser = (): User => {
    if (user === null) throw new ApiError('unauthenticated', 'Sign in required');
    return user;
  };

  // ---- session ----
  if (path === '/api/session' && method === 'POST') {
    const body = asRecord(json());
    const email = typeof body['email'] === 'string' ? body['email'] : '';
    const password = typeof body['password'] === 'string' ? body['password'] : '';
    const found = await state.store.userByEmail(email);
    const stored = found ? await state.store.passwordHash(found.id) : null;
    if (found === null || stored === null || !verifyPassword(password, stored)) {
      throw new ApiError('invalid_credentials', "That email and password don't match.");
    }
    const token = await state.store.createSession(found.id);
    setSessionCookie(res, token);
    sendJson(res, 200, { user: { id: found.id, name: found.name, email: found.email, role: found.role } });
    return;
  }
  if (path === '/api/session' && method === 'GET') {
    const current = requireUser();
    sendJson(res, 200, { user: { id: current.id, name: current.name, email: current.email, role: current.role } });
    return;
  }
  if (path === '/api/session' && method === 'DELETE') {
    requireUser();
    if (ctx.sessionToken) await state.store.deleteSession(ctx.sessionToken);
    clearSessionCookie(res);
    sendJson(res, 204, '');
    return;
  }

  // ---- lots ----
  if (path === '/api/lots' && method === 'GET') {
    sendJson(res, 200, { lots: (await state.store.lots()).map((lot) => ({ id: lot.id, name: lot.name, origin: lot.origin, built_year: lot.built_year })) });
    return;
  }
  if (path === '/api/lots' && method === 'POST') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may create lots');
    const data = validateLot(json());
    const id = await state.store.nextLotId();
    await state.actions.withClient(async (client) => {
      await client.query('INSERT INTO lots (id, name, origin, built_year) VALUES ($1, $2, $3, $4)', [id, data.name, data.origin, data.builtYear]);
    });
    const lot = await state.store.lot(id);
    sendJson(res, 201, { lot });
    return;
  }

  // ---- boards ----
  if (path === '/api/boards' && method === 'GET') {
    const result = await listBoards(state, ctx);
    sendJson(res, 200, result);
    return;
  }
  if (path === '/api/boards' && method === 'POST') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may tag boards');
    const data = validateIntake(json());
    const result = await intakeBoard(state, current, data);
    sendJson(res, 201, result);
    return;
  }

  const boardTagMatch = path.match(/^\/api\/boards\/([^/]+)$/);
  if (boardTagMatch && method === 'GET') {
    const detail = await boardDetail(state, ctx, decodeURIComponent(boardTagMatch[1]));
    sendJson(res, 200, detail);
    return;
  }

  const photoUploadMatch = path.match(/^\/api\/boards\/([^/]+)\/photos$/);
  if (photoUploadMatch && method === 'POST') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may add photos');
    const result = await uploadPhoto(state, decodeURIComponent(photoUploadMatch[1]), ctx);
    sendJson(res, 201, result);
    return;
  }

  const gradeMatch = path.match(/^\/api\/boards\/([^/]+)\/grade$/);
  if (gradeMatch && method === 'POST') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may grade boards');
    const result = await gradeBoard(state, decodeURIComponent(gradeMatch[1]), asRecord(json()));
    sendJson(res, 200, result);
    return;
  }
  const listMatch = path.match(/^\/api\/boards\/([^/]+)\/list$/);
  if (listMatch && method === 'POST') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may list boards');
    const result = await listBoard(state, decodeURIComponent(listMatch[1]));
    sendJson(res, 200, result);
    return;
  }

  const dimensionsMatch = path.match(/^\/api\/boards\/([^/]+)\/dimensions$/);
  if (dimensionsMatch && method === 'PUT') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may correct boards');
    const result = await correctDimensions(state, current, decodeURIComponent(dimensionsMatch[1]), asRecord(json()));
    sendJson(res, 200, result);
    return;
  }

  const parentMatch = path.match(/^\/api\/boards\/([^/]+)\/parent$/);
  if (parentMatch && method === 'PUT') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may re-parent boards');
    const result = await reparent(state, decodeURIComponent(parentMatch[1]), asRecord(json()));
    sendJson(res, 200, result);
    return;
  }

  const lineageMatch = path.match(/^\/api\/boards\/([^/]+)\/lineage$/);
  if (lineageMatch && method === 'GET') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may read lineage');
    const result = await lineage(state, decodeURIComponent(lineageMatch[1]));
    sendJson(res, 200, result);
    return;
  }

  const fitMatch = path.match(/^\/api\/boards\/([^/]+)\/fit$/);
  if (fitMatch && method === 'POST') {
    const body = asRecord(json());
    const result = await fitCheck(state, ctx, decodeURIComponent(fitMatch[1]), body);
    sendJson(res, 200, result);
    return;
  }

  const layoutMatch = path.match(/^\/api\/boards\/([^/]+)\/layout$/);
  if (layoutMatch && method === 'POST') {
    const current = requireUser();
    if (current.role !== 'maker') throw new ApiError('forbidden', 'Only makers may import layouts');
    const result = await importLayout(state, ctx, current, decodeURIComponent(layoutMatch[1]));
    sendJson(res, 200, result);
    return;
  }

  const layoutExportMatch = path.match(/^\/api\/boards\/([^/]+)\/layout\.kerf$/);
  if (layoutExportMatch && method === 'GET') {
    const current = requireUser();
    if (current.role !== 'maker') throw new ApiError('forbidden', 'Only makers may export layouts');
    const file = await exportLayout(state, current, decodeURIComponent(layoutExportMatch[1]));
    sendBytes(res, 200, 'application/json', file, {
      'Content-Disposition': `attachment; filename="${decodeURIComponent(layoutExportMatch[1])}.kerf"`,
    });
    return;
  }

  // ---- rates ----
  if (path === '/api/rates' && method === 'GET') {
    const now = new Date();
    const rates = await state.store.allRatesInForce(now);
    const scheduled = await state.store.scheduledRates(now);
    sendJson(res, 200, {
      rates: rates.map((r) => ({ species: r.species, grade: r.grade, rate_cents: r.rate_cents, effective_at: r.effective_at })),
      scheduled: scheduled.map((r) => ({ species: r.species, grade: r.grade, rate_cents: r.rate_cents, effective_at: r.effective_at })),
    });
    return;
  }
  if (path === '/api/rates' && method === 'PUT') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may set rates');
    const data = validateRateBody(json());
    const now = new Date();
    const effectiveAt = data.effectiveAt ?? now;
    if (data.effectiveAt !== null) {
      if (effectiveAt.getTime() < now.getTime() - 60000 || effectiveAt.getTime() > now.getTime() + 365 * 86400000) {
        throw new ApiError('validation', 'Check the highlighted fields.', { effective_at: 'Effective from must be within the allowed window.' });
      }
    }
    const created = await state.store.insertRateVersion(data.species, data.grade, data.rateCents, effectiveAt);
    sendJson(res, 200, { rate: { species: created.species, grade: created.grade, rate_cents: created.rate_cents, effective_at: created.effective_at } });
    return;
  }

  // ---- stock, ledger ----
  if (path === '/api/stock' && method === 'GET') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may read stock');
    const stock = await state.store.stockRows();
    sendJson(res, 200, {
      species: stock.species.map((row) => ({
        species: row.species,
        open_boards: row.open_boards,
        on_rack: row.on_rack,
        held: row.held,
        volume_mm3: String(row.volume_mm3),
        board_feet: row.board_feet,
      })),
      totals: {
        open_boards: stock.totals.open_boards,
        on_rack: stock.totals.on_rack,
        held: stock.totals.held,
        volume_mm3: String(stock.totals.volume_mm3),
        board_feet: stock.totals.board_feet,
      },
    });
    return;
  }
  if (path === '/api/ledger' && method === 'GET') {
    const current = requireUser();
    if (current.role !== 'owner') throw new ApiError('forbidden', 'Only the owner may read the ledger');
    const account = query.get('account');
    const movements = await state.store.movements(account ?? undefined);
    const names = new Map<number, string>();
    for (const movement of movements) {
      if (movement.by_user_id !== null && !names.has(movement.by_user_id)) {
        const person = await state.store.userById(movement.by_user_id);
        names.set(movement.by_user_id, person?.name ?? '');
      }
    }
    sendJson(res, 200, {
      movements: movements.map((m) =>
        movementJson({
          id: m.id,
          kind: m.kind,
          ticket: m.ticket,
          by_user_id: m.by_user_id,
          created_at: m.created_at,
          entries: m.entries,
          by_name: m.by_user_id === null ? null : (names.get(m.by_user_id) ?? null),
        }),
      ),
    });
    return;
  }

  // ---- holds ----
  if (path === '/api/holds' && method === 'POST') {
    const current = requireUser();
    if (current.role !== 'maker') throw new ApiError('forbidden', 'Only makers may hold boards');
    const key = validateIdempotencyKey(ctx.idempotencyKey);
    const body = asRecord(json());
    const result = await createHold(state, ctx, current, key, body);
    sendJson(res, result.status, JSON.parse(result.body));
    return;
  }
  if (path === '/api/holds' && method === 'GET') {
    const current = requireUser();
    if (current.role === 'maker') {
      const holds = await state.store.holds({ makerId: current.id });
      sendJson(res, 200, { holds: holds.map((h) => holdJsonFor(h, false)) });
      return;
    }
    if (current.role === 'owner') {
      const holds = await holdsWithNames(state);
      sendJson(res, 200, { holds });
      return;
    }
    throw new ApiError('forbidden', 'The yard hand may not read holds');
  }
  const holdMatch = path.match(/^\/api\/holds\/([^/]+)$/);
  if (holdMatch && method === 'GET') {
    const current = requireUser();
    const hold = await state.store.hold(holdMatch[1]);
    if (hold === null) throw new ApiError('not_found', 'Hold not found');
    if (current.role === 'maker' && hold.maker_id !== current.id) throw new ApiError('not_found', 'Hold not found');
    if (current.role === 'hand') throw new ApiError('forbidden', 'The yard hand may not read holds');
    const person = await state.store.userById(hold.maker_id);
    sendJson(res, 200, { hold: holdJsonFor(hold, current.role === 'owner', person?.name ?? '') });
    return;
  }
  const cancelMatch = path.match(/^\/api\/holds\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const current = requireUser();
    const result = await cancelHold(state, current, cancelMatch[1]);
    sendJson(res, 200, { hold: holdJsonFor(result, false) });
    return;
  }
  const purchaseMatch = path.match(/^\/api\/holds\/([^/]+)\/purchase$/);
  if (purchaseMatch && method === 'POST') {
    const current = requireUser();
    if (current.role !== 'maker') throw new ApiError('forbidden', 'Only makers may purchase');
    const key = validateIdempotencyKey(ctx.idempotencyKey);
    asRecord(json());
    const result = await purchaseHold(state, ctx, current, purchaseMatch[1], key);
    sendJson(res, result.status, JSON.parse(result.body));
    return;
  }

  // ---- tickets ----
  if (path === '/api/tickets' && method === 'GET') {
    const current = requireUser();
    const status = query.get('status');
    const statuses = status ? [status] : undefined;
    if (current.role === 'maker') {
      const tickets = await state.store.tickets({ makerId: current.id, status: statuses });
      const rendered = await Promise.all(tickets.map(async (t) => ticketJson(t, await ticketEvents(state, t.id), await makerName(state, t.maker_id))));
      sendJson(res, 200, { tickets: rendered });
      return;
    }
    if (isStaff(current)) {
      const tickets = await state.store.tickets({ status: statuses });
      const rendered = await Promise.all(tickets.map(async (t) => ticketJson(t, await ticketEvents(state, t.id), await makerName(state, t.maker_id))));
      sendJson(res, 200, { tickets: rendered });
      return;
    }
    throw new ApiError('forbidden', 'Only makers and staff may read tickets');
  }
  const ticketMatch = path.match(/^\/api\/tickets\/([^/]+)$/);
  if (ticketMatch && method === 'GET') {
    const current = requireUser();
    const ticket = await state.store.ticket(ticketMatch[1]);
    if (ticket === null) throw new ApiError('not_found', 'Ticket not found');
    if (current.role === 'maker' && ticket.maker_id !== current.id) throw new ApiError('not_found', 'Ticket not found');
    if (!isStaff(current) && !(current.role === 'maker' && ticket.maker_id === current.id)) {
      throw new ApiError('forbidden', 'You may not read this ticket');
    }
    sendJson(res, 200, { ticket: ticketJson(ticket, await ticketEvents(state, ticket.id), await makerName(state, ticket.maker_id)) });
    return;
  }
  const pdfMatch = path.match(/^\/api\/tickets\/([^/]+)\/pdf$/);
  if (pdfMatch && method === 'GET') {
    const current = requireUser();
    const ticket = await state.store.ticket(pdfMatch[1]);
    if (ticket === null) throw new ApiError('not_found', 'Ticket not found');
    if (current.role === 'maker' && ticket.maker_id !== current.id) throw new ApiError('not_found', 'Ticket not found');
    if (!isStaff(current) && !(current.role === 'maker' && ticket.maker_id === current.id)) {
      throw new ApiError('forbidden', 'You may not read this ticket');
    }
    let object: { body: Buffer; contentType: string } | null;
    try {
      object = await state.storage.get(ticket.pdf_key);
    } catch {
      throw new ApiError('storage_unavailable', 'Photo storage is offline');
    }
    if (object === null) throw new ApiError('not_found', 'Ticket not found');
    sendBytes(res, 200, 'application/pdf', object.body);
    return;
  }
  const startMatch = path.match(/^\/api\/tickets\/([^/]+)\/start$/);
  if (startMatch && method === 'POST') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may work tickets');
    asRecord(json());
    const result = await startTicket(state, current, startMatch[1]);
    sendJson(res, 200, { ticket: ticketJson(result, await ticketEvents(state, result.id), await makerName(state, result.maker_id)) });
    return;
  }
  const doneMatch = path.match(/^\/api\/tickets\/([^/]+)\/done$/);
  if (doneMatch && method === 'POST') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('forbidden', 'Only staff may work tickets');
    const body = asRecord(json());
    const result = await doneTicket(state, current, doneMatch[1], body);
    sendJson(res, 200, { ticket: ticketJson(result, await ticketEvents(state, result.id), await makerName(state, result.maker_id)) });
    return;
  }

  // ---- invoices ----
  if (path === '/api/invoices' && method === 'GET') {
    const current = requireUser();
    if (current.role === 'maker') {
      const invoices = await state.store.invoices({ makerId: current.id });
      sendJson(res, 200, { invoices: invoices.map(invoiceJson) });
      return;
    }
    if (current.role === 'owner') {
      const invoices = await state.store.invoices({});
      sendJson(res, 200, { invoices: invoices.map(invoiceJson) });
      return;
    }
    throw new ApiError('forbidden', 'The yard hand may not read invoices');
  }
  const invoiceMatch = path.match(/^\/api\/invoices\/([^/]+)$/);
  if (invoiceMatch && method === 'GET') {
    const current = requireUser();
    const invoice = await state.store.invoice(invoiceMatch[1]);
    if (invoice === null) throw new ApiError('not_found', 'Invoice not found');
    if (current.role === 'maker' && invoice.maker_id !== current.id) throw new ApiError('not_found', 'Invoice not found');
    if (current.role === 'hand') throw new ApiError('forbidden', 'The yard hand may not read invoices');
    sendJson(res, 200, { invoice: invoiceJson(invoice) });
    return;
  }

  // ---- photos ----
  const photoMatch = path.match(/^\/api\/photos\/([^/]+)$/);
  if (photoMatch && method === 'GET') {
    const photo = await state.store.photo(photoMatch[1]);
    if (photo === null) throw new ApiError('not_found', 'Photo not found');
    const board = await state.store.board(photo.board_tag);
    if (board === null) throw new ApiError('not_found', 'Photo not found');
    if (!canViewBoard(ctx.user, board.status)) throw new ApiError('not_found', 'Photo not found');
    const key = photo.key.replace(/original\.[a-z]+$/, 'display.' + extOf(photo.content_type));
    let object: { body: Buffer; contentType: string } | null;
    try {
      object = await state.storage.get(key);
    } catch {
      throw new ApiError('storage_unavailable', 'Photo storage is offline');
    }
    if (object === null) throw new ApiError('storage_unavailable', 'Photo storage is offline');
    sendBytes(res, 200, photo.content_type, object.body);
    return;
  }
  const thumbMatch = path.match(/^\/api\/photos\/([^/]+)\/thumb$/);
  if (thumbMatch && method === 'GET') {
    const photo = await state.store.photo(thumbMatch[1]);
    if (photo === null) throw new ApiError('not_found', 'Photo not found');
    const board = await state.store.board(photo.board_tag);
    if (board === null) throw new ApiError('not_found', 'Photo not found');
    if (!canViewBoard(ctx.user, board.status)) throw new ApiError('not_found', 'Photo not found');
    const key = photo.key.replace(/original\.[a-z]+$/, 'thumb.' + extOf(photo.content_type));
    let object: { body: Buffer; contentType: string } | null;
    try {
      object = await state.storage.get(key);
    } catch {
      throw new ApiError('storage_unavailable', 'Photo storage is offline');
    }
    if (object === null) throw new ApiError('storage_unavailable', 'Photo storage is offline');
    sendBytes(res, 200, photo.content_type, object.body);
    return;
  }
  const originalMatch = path.match(/^\/api\/photos\/([^/]+)\/original$/);
  if (originalMatch && method === 'GET') {
    const current = requireUser();
    if (!isStaff(current)) throw new ApiError('not_found', 'Photo not found');
    const photo = await state.store.photo(originalMatch[1]);
    if (photo === null) throw new ApiError('not_found', 'Photo not found');
    let object: { body: Buffer; contentType: string } | null;
    try {
      object = await state.storage.get(photo.key);
    } catch {
      throw new ApiError('storage_unavailable', 'Photo storage is offline');
    }
    if (object === null) throw new ApiError('storage_unavailable', 'Photo storage is offline');
    sendBytes(res, 200, photo.content_type, object.body);
    return;
  }

  throw new ApiError('not_found', 'Not found');
}

function extOf(contentType: string): string {
  return contentType === 'image/png' ? 'png' : 'jpg';
}

async function ticketEvents(state: RouteState, ticketId: string): Promise<Array<{ kind: string; byName: string; at: string }>> {
  const events = await state.store.ticketEvents(ticketId);
  const out: Array<{ kind: string; byName: string; at: string }> = [];
  for (const event of events) {
    const person = await state.store.userById(event.by_user_id);
    out.push({ kind: event.kind, byName: person?.name ?? '', at: event.at });
  }
  return out;
}

async function makerName(state: RouteState, makerId: number): Promise<string> {
  const person = await state.store.userById(makerId);
  return person?.name ?? '';
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `kerfwell_session=${token}; HttpOnly; SameSite=Lax; Path=/`);
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', 'kerfwell_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
