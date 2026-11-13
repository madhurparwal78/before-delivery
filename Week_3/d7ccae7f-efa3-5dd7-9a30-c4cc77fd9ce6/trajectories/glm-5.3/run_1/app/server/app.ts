import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { errors, asyncHandler, sendError, HttpError } from './errors.ts';
import { hashPassword, tokenHash } from './seed.ts';
import type {
  DeckRecord,
  HostCommand,
  RevealPayload,
  RoomSnapshot,
} from './domain.ts';
import { loadDeck, loadSeats } from './db.ts';
import { validateDeckTitle, validateQuestion } from './validation.ts';
import { presignedGet, sniffImage, storeObject, objectKeyFor, imageInfo } from './images.ts';
import {
  isLiveUp,
  readEvents,
  subscribeRoom,
} from './live.ts';
import {
  applyHostCommand,
  createRoom,
  joinRoom,
  loadRoomById,
  rejoinRoom,
  submitAnswer,
  loadRoomForQuizmaster,
} from './roomsService.ts';
import { rankSeats, itemIdFor } from './roomEngine.ts';

const JSON_BODY_LIMIT = 64_000;
const UPLOAD_BODY_LIMIT = 2_100_000;
const IMAGE_MAX_BYTES = 2_000_000;
const DECK_MAX_QUESTIONS = 50;
const COOKIE_NAME = 'lastbell_session';
const SESSION_DAYS = 30;

export interface AppDeps {
  db: Pool;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      quizmasterId?: string;
      rawBody?: Buffer;
    }
  }
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  res.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Expires=${expires.toUTCString()}`);
}

function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function requireQuizmaster(db: Pool, req: Request): Promise<string> {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) throw errors.notSignedIn();
  const row = await db.query('select * from sessions where token_hash = $1', [tokenHash(token)]);
  if (row.rowCount === 0) throw errors.notSignedIn();
  const session = row.rows[0];
  if (Number(session.expires_at) < Date.now()) {
    await db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
    throw errors.notSignedIn();
  }
  return String(session.quizmaster_id);
}

function sameOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.trim() !== '') {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = req.headers.host;
    if (!host || originHost !== host) {
      res.status(403).json({ error: 'cross_origin' });
      return;
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // state-changing requests with a foreign Origin were refused above
  }
  next();
}

function bodyLimitGuard(limit: number): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const lengthHeader = req.headers['content-length'];
    if (lengthHeader && Number(lengthHeader) > limit) {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    let seen = 0;
    const originalOn = req.on.bind(req);
    void originalOn;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > limit) {
        if (!res.headersSent) {
          res.status(413).json({ error: 'payload_too_large' });
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', () => {
      if (!res.headersSent) res.status(400).json({ error: 'bad_request' });
    });
  };
}

function jsonBody(req: Request): Record<string, unknown> {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to validation failure */
  }
  throw errors.validationFailed({ body: 'Expected a JSON object' });
}

function buildApp(db: Pool): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(sameOriginGuard);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/time', (_req, res) => {
    res.json({ serverNow: Date.now() });
  });

  // ---------------- auth ----------------
  app.post('/api/auth/signup', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const body = jsonBody(req);
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    const fields: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address';
    if (password.length < 10) fields.password = 'A password is at least 10 characters';
    if (displayName.length < 1 || displayName.length > 60) fields.displayName = 'A display name is 1 to 60 characters';
    if (Object.keys(fields).length > 0) throw errors.validationFailed(fields);
    const emailLower = email.toLowerCase();
    const existing = await db.query('select 1 from quizmasters where email_lower = $1', [emailLower]);
    if ((existing.rowCount ?? 0) > 0) throw errors.emailTaken();
    const id = randomUUID();
    const salt = randomBytes(16).toString('hex');
    await db.query('insert into passwords (email_lower, salt) values ($1, $2) on conflict (email_lower) do nothing', [emailLower, salt]);
    await db.query(
      `insert into quizmasters (id, email, email_lower, password_hash, display_name, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, email, emailLower, hashPassword(password, salt), displayName, Date.now()],
    );
    const token = randomBytes(32).toString('hex');
    await db.query(
      'insert into sessions (token_hash, quizmaster_id, expires_at) values ($1, $2, $3)',
      [tokenHash(token), id, Date.now() + SESSION_DAYS * 24 * 3600 * 1000],
    );
    setSessionCookie(res, token);
    res.status(201).json({ quizmaster: { id, email, displayName } });
  }));

  app.post('/api/auth/login', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const body = jsonBody(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = await db.query('select id, password_hash, display_name, email from quizmasters where email_lower = $1', [email]);
    if (row.rowCount === 0) throw errors.invalidCredentials();
    const account = row.rows[0];
    const saltRow = await db.query('select salt from passwords where email_lower = $1', [email]);
    const salt = saltRow.rowCount && saltRow.rowCount > 0 ? String(saltRow.rows[0].salt) : '';
    const expected = String(account.password_hash);
    const supplied = hashPassword(password, salt);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(supplied, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw errors.invalidCredentials();
    const token = randomBytes(32).toString('hex');
    await db.query(
      'insert into sessions (token_hash, quizmaster_id, expires_at) values ($1, $2, $3)',
      [tokenHash(token), String(account.id), Date.now() + SESSION_DAYS * 24 * 3600 * 1000],
    );
    setSessionCookie(res, token);
    res.status(200).json({
      quizmaster: { id: String(account.id), email: String(account.email), displayName: String(account.display_name) },
    });
  }));

  app.post('/api/auth/logout', asyncHandler(async (req, res) => {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) {
      await db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
    }
    clearSessionCookie(res);
    res.status(204).end();
  }));

  app.get('/api/auth/me', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const row = await db.query('select id, email, display_name from quizmasters where id = $1', [quizmasterId]);
    if (row.rowCount === 0) throw errors.notSignedIn();
    const account = row.rows[0];
    res.json({ quizmaster: { id: String(account.id), email: String(account.email), displayName: String(account.display_name) } });
  }));

  // ---------------- decks ----------------
  app.get('/api/decks', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const rows = await db.query(
      `select d.id, d.title, d.version, d.updated_at,
              (select count(*) from questions q where q.deck_id = d.id)::int as question_count
       from decks d where d.quizmaster_id = $1 order by d.updated_at desc`,
      [quizmasterId],
    );
    res.json({
      decks: (rows.rows as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        title: String(row.title),
        version: Number(row.version),
        questionCount: Number(row.question_count),
        updatedAt: Number(row.updated_at),
      })),
    });
  }));

  app.post('/api/decks', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const body = jsonBody(req);
    const title = validateDeckTitle(body.title);
    const id = randomUUID();
    await db.query(
      'insert into decks (id, quizmaster_id, title, version, updated_at) values ($1, $2, $3, 1, $4)',
      [id, quizmasterId, title, Date.now()],
    );
    const deck = await loadDeck(db, quizmasterId, id);
    res.status(201).json({ deck: await deckResponse(db, deck) });
  }));

  app.get('/api/decks/:deckId', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    res.json({ deck: await deckResponse(db, deck) });
  }));

  app.patch('/api/decks/:deckId', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const body = jsonBody(req);
    const title = validateDeckTitle(body.title);
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw errors.validationFailed({ version: 'Which version are you editing?' });
    }
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    if (deck.version !== version) throw errors.versionConflict(deck.version);
    await db.query('update decks set title = $3, version = version + 1, updated_at = $4 where id = $1 and quizmaster_id = $2', [
      deck.id, quizmasterId, title, Date.now(),
    ]);
    const fresh = await loadDeck(db, quizmasterId, deck.id);
    res.json({ deck: await deckResponse(db, fresh) });
  }));

  app.post('/api/decks/:deckId/questions', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    if (deck.questions.length >= DECK_MAX_QUESTIONS) throw errors.deckFull();
    const body = jsonBody(req);
    const question = validateQuestion(body);
    const id = randomUUID();
    await db.query(
      `insert into questions (id, deck_id, position, version, type, prompt, time_limit_seconds, content, created_at)
       values ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
      [id, deck.id, deck.questions.length + 1, question.content.type, question.prompt,
        question.timeLimitSeconds, JSON.stringify(question.content), Date.now()],
    );
    await db.query('update decks set updated_at = $2 where id = $1', [deck.id, Date.now()]);
    const fresh = await loadDeck(db, quizmasterId, deck.id);
    const created = fresh.questions.find((q) => q.id === id)!;
    res.status(201).json({ question: questionResponse(created, await freshPreview(db, created)) });
  }));

  app.put('/api/decks/:deckId/questions/:questionId', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    const existing = deck.questions.find((q) => q.id === (req.params as Record<string,string>).questionId);
    if (!existing) throw errors.notFound();
    const body = jsonBody(req);
    const version = body.version;
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw errors.validationFailed({ version: 'Which version are you editing?' });
    }
    if (existing.version !== version) throw errors.versionConflict(existing.version);
    const question = validateQuestion(body);
    await db.query(
      `update questions set version = version + 1, type = $3, prompt = $4, time_limit_seconds = $5, content = $6
       where id = $1 and deck_id = $2`,
      [existing.id, deck.id, question.content.type, question.prompt, question.timeLimitSeconds, JSON.stringify(question.content)],
    );
    await db.query('update decks set updated_at = $2 where id = $1', [deck.id, Date.now()]);
    const fresh = await loadDeck(db, quizmasterId, deck.id);
    const updated = fresh.questions.find((q) => q.id === existing.id)!;
    res.json({ question: questionResponse(updated, await freshPreview(db, updated)) });
  }));

  app.delete('/api/decks/:deckId/questions/:questionId', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    const existing = deck.questions.find((q) => q.id === (req.params as Record<string,string>).questionId);
    if (!existing) throw errors.notFound();
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query('delete from questions where id = $1', [existing.id]);
      const later = await client.query(
        'select id from questions where deck_id = $1 and position > $2 order by position asc',
        [deck.id, existing.position],
      );
      let position = existing.position;
      for (const row of later.rows as Record<string, unknown>[]) {
        await client.query('update questions set position = $2 where id = $1', [String(row.id), position]);
        position += 1;
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
    await db.query('update decks set updated_at = $2 where id = $1', [deck.id, Date.now()]);
    res.status(204).end();
  }));

  app.post(
    '/api/decks/:deckId/questions/:questionId/image',
    bodyLimitGuard(UPLOAD_BODY_LIMIT),
    asyncHandler(async (req, res) => {
      const quizmasterId = await requireQuizmaster(db, req);
      const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
      const question = deck.questions.find((q) => q.id === (req.params as Record<string,string>).questionId);
      if (!question) throw errors.notFound();
      const raw = (req as Request & { rawBody?: Buffer }).rawBody;
      const contentType = req.headers['content-type'] ?? '';
      const isMultipart = contentType.includes('multipart/form-data');
      let fileBytes: Buffer | null = null;
      if (isMultipart) {
        const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
        const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]) : null;
        fileBytes = boundary ? extractMultipartFile(raw ?? Buffer.alloc(0), boundary) : null;
      } else {
        fileBytes = raw && raw.length > 0 ? raw : null;
      }
      if (!fileBytes || fileBytes.length === 0) throw errors.emptyFile();
      if (fileBytes.length > IMAGE_MAX_BYTES) throw errors.imageTooLarge();
      const sniffed = sniffImage(fileBytes);
      if (!sniffed) throw errors.unsupportedType();
      const key = objectKeyFor(question.id, fileBytes, sniffed);
      let stored;
      try {
        stored = await storeObject(key, fileBytes, sniffed);
      } catch {
        throw errors.imageStoreUnavailable();
      }
      const info = imageInfo(stored);
      await db.query(
        `update questions set image_content_type = $3, image_bytes = $4, image_object_key = $5, version = version + 1
         where id = $1 and deck_id = $2`,
        [question.id, deck.id, info.contentType, info.bytes, info.objectKey],
      );
      const fresh = await loadDeck(db, quizmasterId, deck.id);
      const updated = fresh.questions.find((q) => q.id === question.id)!;
      let previewUrl = '';
      try {
        previewUrl = await presignedGet(info.objectKey);
      } catch {
        throw errors.imageStoreUnavailable();
      }
      res.status(201).json({ question: questionResponse(updated, previewUrl) });
    }),
  );

  app.delete('/api/decks/:deckId/questions/:questionId/image', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const deck = await loadDeck(db, quizmasterId, (req.params as Record<string,string>).deckId);
    const question = deck.questions.find((q) => q.id === (req.params as Record<string,string>).questionId);
    if (!question) throw errors.notFound();
    await db.query(
      `update questions set image_content_type = null, image_bytes = null, image_object_key = null, version = version + 1
       where id = $1 and deck_id = $2`,
      [question.id, deck.id],
    );
    res.status(204).end();
  }));

  // ---------------- rooms (host) ----------------
  app.post('/api/rooms', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const body = jsonBody(req);
    const room = await createRoom(db, quizmasterId, typeof body.deckId === 'string' ? body.deckId : '');
    res.status(201).json({ room: await hostRoomResponse(db, room) });
  }));

  app.get('/api/rooms/:roomId/host', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const room = await loadRoomForQuizmaster(db, quizmasterId, (req.params as Record<string,string>).roomId);
    res.json({ room: await hostRoomResponse(db, room) });
  }));

  app.post('/api/rooms/:roomId/commands', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const room = await loadRoomForQuizmaster(db, quizmasterId, (req.params as Record<string,string>).roomId);
    const body = jsonBody(req);
    const command = body.command;
    const legal: HostCommand[] = ['open_question', 'lock', 'reveal', 'show_leaderboard', 'show_podium', 'end'];
    if (typeof command !== 'string' || !legal.includes(command as HostCommand)) {
      throw errors.validationFailed({ command: 'Unknown command' });
    }
    const result = await applyHostCommand(db, room.id, command as HostCommand);
    res.json({ room: await hostRoomResponse(db, result.room) });
  }));

  // ---------------- players ----------------
  app.post('/api/rooms/join', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const body = jsonBody(req);
    const result = await joinRoom(db, body.pin, body.nickname);
    res.status(201).json(result);
  }));

  app.post('/api/rooms/rejoin', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const body = jsonBody(req);
    const result = await rejoinRoom(db, body.rejoinToken);
    res.json(result);
  }));

  app.get('/api/rooms/:roomId/state', asyncHandler(async (req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
    const clientRow = await db.query('select * from clients where id = $1', [clientId]);
    if (clientRow.rowCount === 0) throw errors.invalidClient();
    const info = clientRow.rows[0];
    if (info.superseded_at !== null) throw errors.clientSuperseded();
    const room = await loadRoomById(db, (req.params as Record<string,string>).roomId);
    if (room.endedReason !== null) throw errors.roomEnded();
    await db.query('update clients set last_seen_at = $2 where id = $1', [clientId, Date.now()]);
    res.json(await playerView(db, room, String(info.seat_id), clientId));
  }));

  app.post('/api/rooms/:roomId/answers', bodyLimitGuard(JSON_BODY_LIMIT), asyncHandler(async (req, res) => {
    const body = jsonBody(req);
    const result = await submitAnswer(db, {
      clientId: typeof body.clientId === 'string' ? body.clientId : '',
      questionIndex: body.questionIndex,
      choice: body.choice,
      estimate: body.estimate,
      order: body.order,
    });
    res.status(201).json(result);
  }));

  // ---------------- nights ----------------
  app.get('/api/nights', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const rows = await db.query(
      `select n.room_id, n.deck_title, n.ended_at,
              (select count(*) from seats s where s.room_id = n.room_id)::int as seated
       from nights n join rooms r on r.id = n.room_id
       where r.quizmaster_id = $1
       order by n.ended_at desc`,
      [quizmasterId],
    );
    const nights = [];
    for (const row of rows.rows as Record<string, unknown>[]) {
      const roomId = String(row.room_id);
      const podium = await db.query(
        'select rank, nickname, score from standings where room_id = $1 and rank <= 3 order by rank asc',
        [roomId],
      );
      nights.push({
        roomId,
        deckTitle: String(row.deck_title),
        endedAt: Number(row.ended_at),
        seated: Number(row.seated),
        podium: (podium.rows as Record<string, unknown>[]).map((p) => ({
          rank: Number(p.rank),
          nickname: String(p.nickname),
          score: Number(p.score),
        })),
      });
    }
    res.json({ nights });
  }));

  app.get('/api/nights/:roomId', asyncHandler(async (req, res) => {
    const quizmasterId = await requireQuizmaster(db, req);
    const room = await loadRoomForQuizmaster(db, quizmasterId, (req.params as Record<string,string>).roomId);
    if (room.endedReason === null) throw errors.notFound();
    const rows = await db.query(
      'select rank, nickname, score from standings where room_id = $1 order by rank asc',
      [room.id],
    );
    res.json({
      night: {
        roomId: room.id,
        deckTitle: room.deckTitle,
        endedAt: room.endedAt,
        standings: (rows.rows as Record<string, unknown>[]).map((row) => ({
          rank: Number(row.rank),
          nickname: String(row.nickname),
          score: Number(row.score),
        })),
      },
    });
  }));

  // ---------------- streams and polling ----------------
  app.get('/api/rooms/:roomId/stream', asyncHandler(async (req, res) => {
    const roomId = (req.params as Record<string,string>).roomId;
    const role = typeof req.query.role === 'string' ? req.query.role : '';
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
    if (role !== 'stage') {
      const clientRow = await db.query('select * from clients where id = $1', [clientId]);
      if (clientRow.rowCount === 0) throw errors.invalidClient();
      const info = clientRow.rows[0];
      if (info.superseded_at !== null) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('event: superseded\ndata: {}\n\n');
        res.end();
        return;
      }
    }
    const room = await loadRoomById(db, roomId);
    if (role !== 'stage' && room.endedReason !== null) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write('event: ended\ndata: {"reason":"host"}\n\n');
      res.end();
      return;
    }
    if (role === 'stage') {
      try {
        await requireQuizmaster(db, req);
      } catch {
        throw errors.notSignedIn();
      }
    }
    if (!isLiveUp()) throw errors.liveUnavailable();

    let lastEventId = 0;
    const lastHeader = req.headers['last-event-id'];
    if (typeof lastHeader === 'string' && /^\d+$/.test(lastHeader)) lastEventId = Number(lastHeader);

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(':ok\n\n');

    const missed = await readEvents(db, roomId, lastEventId);
    for (const event of missed) {
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      if (role !== 'stage') {
        noteStreamClosed(db, clientId).catch(() => undefined);
      }
      try {
        res.end();
      } catch {
        /* already closed */
      }
    };
    const unsubscribe = subscribeRoom(roomId, (event) => {
      if (closed) return;
      if (event.id <= lastEventId) return;
      lastEventId = event.id;
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!closed) res.write(':keepalive\n\n');
    }, 15000);
    req.on('close', finish);
    res.on('close', finish);
  }));

  app.get('/api/rooms/:roomId/poll', asyncHandler(async (req, res) => {
    const roomId = (req.params as Record<string,string>).roomId;
    const role = typeof req.query.role === 'string' ? req.query.role : '';
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : '';
    const afterRaw = typeof req.query.after === 'string' ? req.query.after : '0';
    const after = /^\d+$/.test(afterRaw) ? Number(afterRaw) : 0;
    if (role === 'stage') {
      await requireQuizmaster(db, req);
    } else {
      const clientRow = await db.query('select * from clients where id = $1', [clientId]);
      if (clientRow.rowCount === 0) throw errors.invalidClient();
      if (clientRow.rows[0].superseded_at !== null) throw errors.clientSuperseded();
      await db.query('update clients set last_seen_at = $2 where id = $1', [clientId, Date.now()]);
    }
    const room = await loadRoomById(db, roomId);
    if (role !== 'stage' && room.endedReason !== null) throw errors.roomEnded();

    let events = await readEvents(db, roomId, after);
    if (events.length > 0) {
      res.json({ events: events.map((e) => ({ id: e.id, type: e.type, data: e.data })) });
      return;
    }
    let settled = false;
    const unsubscribe = subscribeRoom(roomId, (event) => {
      if (event.id > after) {
        finish([{ id: event.id, type: event.type, data: event.data }]);
      }
    });
    const finish = (events: { id: number; type: string; data: unknown }[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(recheck);
      unsubscribe();
      res.json({ events });
    };
    // without the live link the pub/sub never fires, so watch the durable event log too
    const recheck = setInterval(() => {
      void readEvents(db, roomId, after).then((found) => {
        if (found.length > 0) finish(found);
      }).catch(() => undefined);
    }, 400);
    const timer = setTimeout(() => {
      finish([]);
    }, 25_000);
    res.on('close', () => {
      settled = true;
      clearTimeout(timer);
      clearInterval(recheck);
      unsubscribe();
    });
  }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const FORBIDDEN = /(^|\/)\.env(\.|$)|(^|\/)package(-lock)?\.json$|(^|\/)run\.json$|(^|\/)tsconfig\.json$|\.map$|^\/(server|client)\/|^\/node_modules\//;

  const staticPaths = new Set([
    '/',
    '/app.css',
    '/app.js',
    '/assets/fraunces-400.woff2',
    '/assets/fraunces-600.woff2',
    '/assets/fraunces-700.woff2',
    '/assets/atkinson-400.woff2',
    '/assets/atkinson-700.woff2',
  ]);

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const base = path === '/index.html' || path.endsWith('/') && path !== '/' ? path.replace(/index\.html$/, '').replace(/\/$$/, '/') : path;
    const route =
      base === '/' || base === ''
        ? '/'
        : /^\/host/.test(base) || /^\/stage\//.test(base) || /^\/play\//.test(base)
          ? '/'
          : base;
    if (FORBIDDEN.test(path)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!staticPaths.has(route)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const filePath = route === '/' ? 'public/index.html' : `public${route}`;
    res.sendFile(filePath, { root: process.cwd() }, (err) => {
      if (err && !res.headersSent) {
        sendError(res, new HttpError(404, 'not_found'));
      }
    });
  });

  // every error response is built in one place with the single error shape
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    sendError(res, err);
  });

  return app;
}

function extractMultipartFile(body: Buffer, boundary: string): Buffer | null {
  const marker = Buffer.from(`--${boundary}`);
  const positions: number[] = [];
  let idx = body.indexOf(marker);
  while (idx !== -1) {
    positions.push(idx);
    idx = body.indexOf(marker, idx + 1);
  }
  for (let i = 0; i < positions.length - 1; i += 1) {
    const start = positions[i] + marker.length;
    const end = positions[i + 1];
    const part = body.subarray(start, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    if (!/name="image"/.test(headers)) continue;
    let data = part.subarray(headerEnd + 4);
    if (data.length >= 2 && data[data.length - 2] === 0x0d && data[data.length - 1] === 0x0a) {
      data = data.subarray(0, data.length - 2);
    }
    return data;
  }
  return null;
}

async function noteStreamClosed(db: Pool, clientId: string): Promise<void> {
  await db.query(
    `update rooms set empty_since = $2
     where id = (select room_id from clients where id = $1)
       and not exists (
         select 1 from clients c
         where c.room_id = (select room_id from clients where id = $1)
           and c.superseded_at is null
           and c.last_seen_at > $3
       )`,
    [clientId, Date.now(), Date.now() - 30_000],
  );
}

async function deckResponse(db: Pool, deck: DeckRecord): Promise<Record<string, unknown>> {
  return {
    id: deck.id,
    title: deck.title,
    version: deck.version,
    questions: await Promise.all(
      deck.questions.map(async (q) => questionResponse(q, await freshPreview(db, q))),
    ),
  };
}

async function freshPreview(_db: Pool, question: DeckRecord['questions'][number]): Promise<string | undefined> {
  if (!question.image) return undefined;
  try {
    return await presignedGet(question.image.objectKey);
  } catch {
    return undefined;
  }
}

function questionResponse(question: DeckRecord['questions'][number], previewUrl?: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: question.id,
    position: question.position,
    version: question.version,
    type: question.content.type,
    prompt: question.prompt,
    timeLimitSeconds: question.timeLimitSeconds,
    image:
      question.image && previewUrl
        ? {
            status: 'attached',
            contentType: question.image.contentType,
            bytes: Number(question.image.bytes),
            previewUrl,
          }
        : null,
  };
  const content = question.content;
  if (content.type === 'multiple_choice') {
    base.options = content.options;
    base.correctIndex = content.correctIndex;
  } else if (content.type === 'estimate') {
    Object.assign(base, {
      min: content.min, max: content.max, step: content.step,
      answer: content.answer, tolerance: content.tolerance, unit: content.unit,
    });
  } else {
    base.items = content.items;
  }
  return base;
}

interface PlayerQuestionPayload {
  index: number;
  type: string;
  prompt: string;
  timeLimitMs: number;
  opensAt: number;
  deadlineAt: number;
  imageUrl: string | null;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  items?: { id: string; label: string }[];
}

async function playerQuestionPayload(room: RoomSnapshot, question: RoomSnapshot['questions'][number], index: number): Promise<PlayerQuestionPayload> {
  const opensAt = room.opensAt ?? 0;
  const deadlineAt = room.deadlineAt ?? 0;
  let imageUrl: string | null = null;
  if (question.image) {
    try {
      imageUrl = await presignedGet(question.image.objectKey);
    } catch {
      imageUrl = null;
    }
  }
  const payload: PlayerQuestionPayload = {
    index,
    type: question.content.type,
    prompt: question.prompt,
    timeLimitMs: question.timeLimitSeconds * 1000,
    opensAt,
    deadlineAt,
    imageUrl,
  };
  const content = question.content;
  if (content.type === 'multiple_choice') {
    payload.options = content.options;
  } else if (content.type === 'estimate') {
    payload.min = content.min;
    payload.max = content.max;
    payload.step = content.step;
    payload.unit = content.unit;
  } else {
    payload.items = content.items.map((label) => ({ id: itemIdFor(question.id, label), label }));
    // deterministic shuffle
    let state = 0;
    const seed = question.id;
    for (let i = 0; i < seed.length; i += 1) state = (state * 31 + seed.charCodeAt(i)) >>> 0;
    const items = [...(payload.items as { id: string; label: string }[])];
    for (let i = items.length - 1; i > 0; i -= 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const j = state % (i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    payload.items = items;
  }
  return payload;
}

async function currentReveal(db: Pool, room: RoomSnapshot): Promise<RevealPayload | null> {
  if ((room.state !== 'reveal' && room.state !== 'leaderboard') || !room.questionIndex) return null;
  const byIndex = await db.query(
    `select data from events where room_id = $1 and type = 'reveal' order by id desc`,
    [room.id],
  );
  for (const row of byIndex.rows as Record<string, unknown>[]) {
    const data = typeof row.data === 'string' ? (JSON.parse(row.data) as Record<string, unknown>) : (row.data as Record<string, unknown>);
    if (Number(data.questionIndex) === room.questionIndex) {
      return data as unknown as RevealPayload;
    }
  }
  return null;
}

async function playerView(
  db: Pool,
  room: RoomSnapshot,
  seatId: string,
  _clientId: string,
): Promise<Record<string, unknown>> {
  const seats = await loadSeats(db, room.id);
  const me = seats.find((seat) => seat.seatId === seatId);
  const standings = rankSeats(seats);
  const answeredRows = await db.query(
    'select 1 from answers where room_id = $1 and seat_id = $2 and question_index = $3',
    [room.id, seatId, room.questionIndex ?? -1],
  );
  let question: PlayerQuestionPayload | null = null;
  if ((room.state === 'question_open' || room.state === 'locked') && room.questionIndex) {
    const q = room.questions[room.questionIndex - 1];
    if (q) question = await playerQuestionPayload(room, q, room.questionIndex);
  }
  const reveal = await currentReveal(db, room);
  const myRank = me ? standings.find((s) => s.seatId === seatId)?.rank ?? seats.length : null;
  return {
    state: room.state,
    questionCount: room.questions.length,
    questionIndex: room.questionIndex,
    question,
    reveal,
    standings,
    you: me
      ? {
          seatId: me.seatId,
          nickname: me.nickname,
          score: me.score,
          streak: me.streak,
          rank: myRank,
          answeredCurrent: (answeredRows.rowCount ?? 0) > 0,
        }
      : null,
    lastEventId: room.lastEventId,
  };
}

async function hostRoomResponse(db: Pool, room: RoomSnapshot): Promise<Record<string, unknown>> {
  const seats = await loadSeats(db, room.id);
  const standings = rankSeats(seats);
  const connected = await db.query(
    'select seat_id from clients where room_id = $1 and superseded_at is null',
    [room.id],
  );
  const connectedSeatIds = new Set((connected.rows as Record<string, unknown>[]).map((row) => String(row.seat_id)));
  const answered = room.questionIndex
    ? await db.query(
        'select count(*)::int as n from answers where room_id = $1 and question_index = $2',
        [room.id, room.questionIndex],
      )
    : null;
  let question: PlayerQuestionPayload | null = null;
  if ((room.state === 'question_open' || room.state === 'locked' || room.state === 'reveal') && room.questionIndex) {
    const q = room.questions[room.questionIndex - 1];
    if (q) question = await playerQuestionPayload(room, q, room.questionIndex);
  }
  const reveal = await currentReveal(db, room);
  return {
    id: room.id,
    pin: room.pin,
    state: room.state,
    deckTitle: room.deckTitle,
    questionCount: room.questions.length,
    questionIndex: room.questionIndex,
    question,
    answered: answered ? Number(answered.rows[0].n) : 0,
    seated: seats.length,
    connected: connectedSeatIds.size,
    players: seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      score: seat.score,
      rank: seat.rank,
      connected: connectedSeatIds.has(seat.seatId),
    })),
    reveal,
    standings,
    transport: isLiveUp() ? 'live' : 'backup',
    lastEventId: room.lastEventId,
  };
}

export { buildApp, hostRoomResponse, playerView, noteStreamClosed };
