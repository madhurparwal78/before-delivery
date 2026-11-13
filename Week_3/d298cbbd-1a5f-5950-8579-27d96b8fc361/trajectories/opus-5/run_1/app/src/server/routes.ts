import { config } from './config.js';
import { query, queryOne } from './db.js';
import {
  ApiError,
  clearedSessionCookie,
  sessionCookie,
  type Handler,
  type RequestContext,
  type Route,
} from './http.js';
import {
  attemptSignIn,
  createTypist,
  endAllSessions,
  endSession,
  FIELD_MESSAGES,
  issueEmailToken,
  markVerified,
  replaceTypist,
  setPassword,
  spendEmailToken,
  startSession,
  typistByEmail,
  validEmail,
  validName,
  validPassword,
  type Typist,
} from './accounts.js';
import { resetLetter, send, verificationLetter } from './mail.js';
import {
  issueTicket,
  parseTicketRequest,
  queueFixedText,
  ticketById,
  ticketResponse,
} from './tickets.js';
import {
  checkRun,
  historyPage,
  logExceedsLimits,
  metaOfTicket,
  personalBests,
  proofKeyFor,
  runById,
  runResponse,
  storeCountedRun,
  storedRunResponse,
  storeRefusedRun,
  submittedFigures,
  testsCounted,
} from './runs.js';
import { boardRows, publishBoardChange, subscribeToBoard, type BoardLength, type BoardName } from './boards.js';
import { LiveConnection, closeConnectionsForSessions, registerConnection } from './live.js';
import {
  attachConnection,
  broadcastState,
  claimSeat,
  createRoom,
  eventsSince,
  markDnf,
  raceWords,
  recordFinish,
  roomByCode,
  roomSnapshot,
  startCountdown,
  updateProgress,
} from './rooms.js';
import { kindOfMode, roundHalfUp, type LogEntry } from '../shared/engine.js';
import { QUOTES, type QuoteId } from '../shared/quotes.js';

const THEMES = ['sand', 'cobalt', 'carbon', 'ledger'];
const CARETS = ['line', 'block', 'underline', 'off'];
const FONT_SIZES = [1, 1.5, 2, 3];
const QUICK_RESTARTS = ['tab', 'enter'];

const DEFAULT_SETTINGS = {
  theme: 'sand',
  caret: 'line',
  smoothCaret: true,
  fontSize: 1.5,
  blindMode: false,
  quickRestart: 'tab',
} as const;

interface SettingsRow {
  theme: string;
  caret: string;
  smooth_caret: boolean;
  font_size: string;
  blind_mode: boolean;
  quick_restart: string;
}

function typistOf(context: RequestContext): Typist {
  if (!context.typist) throw new ApiError(401, 'unauthenticated');
  return context.typist;
}

function bodyOf(context: RequestContext): Record<string, unknown> {
  const body = context.body<unknown>();
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

const configEndpoint: Handler = async () => ({
  status: 200,
  body: {
    focusWarningMs: config.focusWarningMs,
    maxExtraLetters: config.maxExtraLetters,
    raceCountdownSeconds: config.raceCountdownSeconds,
    raceRejoinSeconds: config.raceRejoinSeconds,
  },
});

const signUp: Handler = async (context) => {
  const body = bodyOf(context);
  const name = validName(body['name']);
  const email = validEmail(body['email']);
  const password = validPassword(body['password']);
  const errors: Record<string, string> = {};
  if (name === null) errors['name'] = FIELD_MESSAGES.name;
  if (email === null) errors['email'] = FIELD_MESSAGES.email;
  if (password === null) errors['password'] = FIELD_MESSAGES.password;
  if (Object.keys(errors).length > 0) {
    return { status: 422, body: { error: 'invalid_fields', errors } };
  }
  if (await typistByEmail(email as string)) {
    return { status: 409, body: { error: 'email_taken' } };
  }
  const typist = await createTypist(name as string, email as string, password as string);
  const token = await issueEmailToken(typist.id, 'verify');
  const mail = await send(verificationLetter(typist.email, token));
  const sessionToken = await startSession(typist.id);
  return {
    status: 201,
    body: { id: typist.id, email: typist.email, verified: false, mail },
    headers: { 'set-cookie': sessionCookie(sessionToken) },
  };
};

const verify: Handler = async (context) => {
  const typistId = await spendEmailToken(bodyOf(context)['token'], 'verify');
  if (!typistId) return { status: 410, body: { error: 'link_expired' } };
  await markVerified(typistId);
  return { status: 200, body: { verified: true } };
};

const signIn: Handler = async (context) => {
  const body = bodyOf(context);
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : '';
  const password = typeof body['password'] === 'string' ? body['password'] : '';
  const outcome = await attemptSignIn(email, password);
  if (outcome.kind === 'limited') {
    return {
      status: 429,
      body: { error: 'too_many_attempts', retryAfter: outcome.retryAfter },
    };
  }
  if (outcome.kind === 'invalid' || !outcome.typist) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }
  const token = await startSession(outcome.typist.id);
  return {
    status: 200,
    body: {
      id: outcome.typist.id,
      name: outcome.typist.name,
      verified: outcome.typist.verified,
    },
    headers: { 'set-cookie': sessionCookie(token) },
  };
};

const signOut: Handler = async (context) => {
  if (context.sessionToken) await endSession(context.sessionToken);
  return { status: 204, body: null, headers: { 'set-cookie': clearedSessionCookie() } };
};

const me: Handler = async (context) => {
  const typist = typistOf(context);
  return { status: 200, body: { id: typist.id, name: typist.name, verified: typist.verified } };
};

const requestPasswordReset: Handler = async (context) => {
  const email = validEmail(bodyOf(context)['email']);
  if (email !== null) {
    const typist = await typistByEmail(email);
    if (typist) {
      const token = await issueEmailToken(typist.id, 'reset');
      await send(resetLetter(typist.email, token));
    }
  }
  return { status: 202, body: { status: 'accepted' } };
};

const confirmPasswordReset: Handler = async (context) => {
  const body = bodyOf(context);
  const password = validPassword(body['password']);
  if (password === null) {
    return {
      status: 422,
      body: { error: 'invalid_fields', errors: { password: FIELD_MESSAGES.password } },
    };
  }
  const typistId = await spendEmailToken(body['token'], 'reset');
  if (!typistId) return { status: 410, body: { error: 'link_expired' } };
  await setPassword(typistId, password);
  const tokens = await endAllSessions(typistId);
  closeConnectionsForSessions(tokens);
  return {
    status: 200,
    body: { status: 'changed' },
    headers: { 'set-cookie': clearedSessionCookie() },
  };
};

const readSettings: Handler = async (context) => {
  const typist = typistOf(context);
  const row = await queryOne<SettingsRow>(
    'select theme, caret, smooth_caret, font_size, blind_mode, quick_restart from settings where typist_id = $1',
    [typist.id],
  );
  if (!row) return { status: 200, body: DEFAULT_SETTINGS };
  return {
    status: 200,
    body: {
      theme: row.theme,
      caret: row.caret,
      smoothCaret: row.smooth_caret,
      fontSize: Number(row.font_size),
      blindMode: row.blind_mode,
      quickRestart: row.quick_restart,
    },
  };
};

const writeSettings: Handler = async (context) => {
  const typist = typistOf(context);
  const body = bodyOf(context);
  const theme = body['theme'];
  const caret = body['caret'];
  const smoothCaret = body['smoothCaret'];
  const fontSize = body['fontSize'];
  const blindMode = body['blindMode'];
  const quickRestart = body['quickRestart'];
  const valid =
    typeof theme === 'string' &&
    THEMES.includes(theme) &&
    typeof caret === 'string' &&
    CARETS.includes(caret) &&
    typeof smoothCaret === 'boolean' &&
    typeof fontSize === 'number' &&
    FONT_SIZES.includes(fontSize) &&
    typeof blindMode === 'boolean' &&
    typeof quickRestart === 'string' &&
    QUICK_RESTARTS.includes(quickRestart);
  if (!valid) return { status: 422, body: { error: 'invalid_fields' } };
  await query(
    `insert into settings (typist_id, theme, caret, smooth_caret, font_size, blind_mode, quick_restart)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (typist_id) do update set theme = $2, caret = $3, smooth_caret = $4,
       font_size = $5, blind_mode = $6, quick_restart = $7`,
    [typist.id, theme, caret, smoothCaret, fontSize, blindMode, quickRestart],
  );
  return {
    status: 200,
    body: { theme, caret, smoothCaret, fontSize, blindMode, quickRestart },
  };
};

const createTicket: Handler = async (context) => {
  const request = parseTicketRequest(context.body<unknown>());
  const ticket = await issueTicket(request, context.typist);
  return { status: 201, body: ticketResponse(ticket) };
};

const submitRun: Handler = async (context) => {
  const typist = typistOf(context);
  const body = bodyOf(context);
  const proofKey = proofKeyFor(context.rawBody);
  if (logExceedsLimits(body)) {
    throw new ApiError(413, 'log_too_long', { limit: config.maxLogEvents });
  }
  const ticketId = body['ticketId'];
  const ticket = typeof ticketId === 'string' ? await ticketById(ticketId) : null;
  if (!ticket || ticket.typistId === null || ticket.typistId !== typist.id) {
    throw new ApiError(404, 'ticket_not_found');
  }
  const existing = await storedRunResponse(ticket.id);
  if (existing) return { status: existing.status, body: null, raw: existing.body };
  if (ticket.expiresAt.getTime() <= Date.now()) throw new ApiError(410, 'ticket_expired');

  const meta = metaOfTicket(ticket);
  const outcome = checkRun({
    words: ticket.words,
    kind: kindOfMode(ticket.mode),
    timeLengthMs: ticket.mode === 'time' ? Number(ticket.length) * 1000 : null,
    body,
    origin: 'ticket',
  });
  if (!outcome.ok) {
    const stored = await storeRefusedRun({
      ticketId: ticket.id,
      meta,
      logValue: body['log'] ?? null,
      code: outcome.code,
      submitted: submittedFigures(body),
      proofKey,
      bytes: context.rawBody,
    });
    return { status: stored.status, body: null, raw: stored.body };
  }
  const stored = await storeCountedRun({
    ticketId: ticket.id,
    meta,
    logValue: body['log'] ?? null,
    figures: outcome.figures,
    proofKey,
    bytes: context.rawBody,
  });
  if (
    stored.status === 201 &&
    ticket.mode === 'time' &&
    (ticket.length === '15' || ticket.length === '60') &&
    !ticket.punctuation &&
    !ticket.numbers &&
    typist.verified
  ) {
    await publishBoardChange(ticket.length as BoardLength, {
      name: typist.name,
      speed: roundHalfUp(outcome.figures.speed),
    });
  }
  return { status: stored.status, body: null, raw: stored.body };
};

const readRun: Handler = async (context) => {
  const row = await runById(context.params['id'] as string, context.typist?.id ?? null);
  if (!row) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: runResponse(row) };
};

const readHistory: Handler = async (context) => {
  const typist = typistOf(context);
  const url = context.url;
  const pageParam = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
  const verdict = url.searchParams.get('verdict');
  const page = await historyPage(typist.id, {
    mode: url.searchParams.get('mode'),
    length: url.searchParams.get('length'),
    verdict: verdict === 'counted' || verdict === 'not_counted' ? verdict : null,
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  });
  return { status: 200, body: page };
};

const readAccount: Handler = async (context) => {
  const typist = typistOf(context);
  return {
    status: 200,
    body: {
      name: typist.name,
      email: typist.email,
      verified: typist.verified,
      testsCounted: await testsCounted(typist.id),
      personalBests: await personalBests(typist.id),
    },
  };
};

function boardParams(context: RequestContext): { board: BoardName; length: BoardLength } {
  const board = context.url.searchParams.get('board');
  const length = context.url.searchParams.get('length');
  if ((board !== 'daily' && board !== 'alltime') || (length !== '15' && length !== '60')) {
    throw new ApiError(422, 'invalid_board');
  }
  return { board, length };
}

const readBoard: Handler = async (context) => {
  const { board, length } = boardParams(context);
  return { status: 200, body: { rows: await boardRows(board, length) } };
};

const makeRoom: Handler = async (context) => {
  const typist = typistOf(context);
  const room = createRoom(typist.id, typist.name);
  return { status: 201, body: { code: room.code } };
};

const readRoom: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  if (!room || !room.racers.has(typist.id)) {
    return { status: 404, body: { error: 'room_not_found' } };
  }
  return { status: 200, body: roomSnapshot(room) };
};

const joinRoom: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  if (!room) return { status: 404, body: { error: 'room_not_found' } };
  const outcome = claimSeat(room, typist.id, typist.name);
  if (outcome === 'room_full') return { status: 409, body: { error: 'room_full' } };
  if (outcome === 'race_started') return { status: 409, body: { error: 'race_started' } };
  broadcastState(room);
  return { status: 200, body: { code: room.code, rejoined: outcome === 'rejoined' } };
};

const startRace: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  if (!room || !room.racers.has(typist.id)) {
    return { status: 404, body: { error: 'room_not_found' } };
  }
  if (room.hostId !== typist.id) return { status: 403, body: { error: 'not_host' } };
  if (room.state !== 'open') return { status: 409, body: { error: 'race_started' } };
  if (room.racers.size < 2) return { status: 409, body: { error: 'not_enough_racers' } };
  startCountdown(room, await raceWords());
  return { status: 200, body: { state: 'countdown' } };
};

const sendRaceKeys: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  if (!room) return { status: 404, body: { error: 'room_not_found' } };
  const racer = room.racers.get(typist.id);
  if (!racer) return { status: 404, body: { error: 'room_not_found' } };
  const entries = bodyOf(context)['entries'];
  if (!Array.isArray(entries)) return { status: 422, body: { error: 'invalid_log' } };
  updateProgress(room, racer, entries as LogEntry[]);
  return { status: 200, body: { progress: racer.progress } };
};

const finishRace: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  if (!room) return { status: 404, body: { error: 'room_not_found' } };
  const racer = room.racers.get(typist.id);
  if (!racer || !room.words) return { status: 404, body: { error: 'room_not_found' } };
  const body = bodyOf(context);
  const proofKey = proofKeyFor(context.rawBody);
  if (logExceedsLimits(body)) {
    throw new ApiError(413, 'log_too_long', { limit: config.maxLogEvents });
  }
  const overdue =
    room.state === 'finished' ||
    room.goAt === null ||
    Date.now() - room.goAt > config.raceTimeLimitSeconds * 1000;
  if (overdue) {
    markDnf(room, racer);
    return { status: 409, body: { error: 'race_over' } };
  }
  const outcome = checkRun({
    words: room.words,
    kind: 'finite',
    timeLengthMs: null,
    body,
    origin: 'race',
  });
  if (!outcome.ok) {
    markDnf(room, racer);
    return {
      status: 422,
      body: { error: outcome.code, verdict: 'not_counted', proofKey },
    };
  }
  const speed = roundHalfUp(outcome.figures.speed);
  const accuracy = roundHalfUp(outcome.figures.accuracy);
  const place = recordFinish(room, racer, outcome.figures.duration, speed, accuracy);
  return {
    status: 200,
    body: { place, verdict: 'counted', speed, accuracy, proofKey },
  };
};

const liveBoard: Handler = async (context) => {
  const { board, length } = boardParams(context);
  const connection = new LiveConnection(
    context.res,
    context.sessionToken,
    context.typist?.id ?? null,
  );
  registerConnection(connection);
  subscribeToBoard(connection, board, length);
  connection.send('board', { board, length, rows: await boardRows(board, length), change: null });
  return 'handled';
};

const liveRoom: Handler = async (context) => {
  const typist = typistOf(context);
  const room = roomByCode(context.params['code'] as string);
  const racer = room?.racers.get(typist.id);
  if (!room || !racer) return { status: 404, body: { error: 'room_not_found' } };
  const since = Number.parseInt(context.url.searchParams.get('since') ?? '0', 10);
  const connection = new LiveConnection(context.res, context.sessionToken, typist.id);
  registerConnection(connection);
  attachConnection(room, racer, connection);
  connection.send('room', {
    ...roomSnapshot(room),
    seq: room.journal.at(-1)?.seq ?? 0,
    ownEntries: racer.entries,
  });
  if (Number.isFinite(since) && since > 0) {
    for (const event of eventsSince(room, since)) connection.send('event', { ...event });
  }
  return 'handled';
};

function gradingKeyOf(context: RequestContext): void {
  const key = context.req.headers['x-grading-key'];
  if (key !== config.gradingKey) throw new ApiError(404, 'not_found');
}

const gradingSetup: Handler = async (context) => {
  gradingKeyOf(context);
  const body = bodyOf(context);
  const typists = Array.isArray(body['typists']) ? body['typists'] : [];
  const runs = Array.isArray(body['runs']) ? body['runs'] : [];
  const created: { email: string; id: string }[] = [];
  for (const entry of typists as Record<string, unknown>[]) {
    const email = validEmail(entry['email']);
    const name = validName(entry['name']);
    const password = validPassword(entry['password']);
    if (email === null || name === null || password === null) continue;
    const verified = entry['verified'] === true;
    const existing = await typistByEmail(email);
    if (existing) {
      await replaceTypist(existing.id, name, password, verified);
      created.push({ email, id: existing.id });
    } else {
      const typist = await createTypist(name, email, password, verified);
      created.push({ email, id: typist.id });
    }
  }
  for (const entry of runs as Record<string, unknown>[]) {
    const email = validEmail(entry['email']);
    if (email === null) continue;
    const typist = await typistByEmail(email);
    if (!typist) continue;
    const length = entry['length'];
    await query(
      `insert into runs (ticket_id, typist_id, mode, length, punctuation, numbers, words, log,
                         duration, speed, raw, accuracy, consistency, characters, errors_by_key,
                         per_second, verdict, finished_at)
       values (null, $1, $2, $3, $4, $5, '[]'::jsonb, '[]', null, $6, $7, $8, $9, null, null, null,
               'counted', coalesce($10::timestamptz, now()))`,
      [
        typist.id,
        String(entry['mode']),
        length === null || length === undefined ? null : String(length),
        entry['punctuation'] === true,
        entry['numbers'] === true,
        Number(entry['speed']),
        Number(entry['raw']),
        Number(entry['accuracy']),
        Number(entry['consistency']),
        typeof entry['finishedAt'] === 'string' ? entry['finishedAt'] : null,
      ],
    );
  }
  return { status: 201, body: { typists: created } };
};

const gradingNextText: Handler = async (context) => {
  gradingKeyOf(context);
  const body = bodyOf(context);
  const target = body['target'];
  if (typeof target !== 'string') throw new ApiError(422, 'invalid_fields');
  const quoteId = body['quoteId'];
  const words = body['words'];
  if (typeof quoteId === 'string' && QUOTES.some((quote) => quote.id === quoteId)) {
    await queueFixedText(normaliseTarget(target), [], quoteId as QuoteId);
  } else if (Array.isArray(words) && words.every((word) => typeof word === 'string')) {
    await queueFixedText(normaliseTarget(target), words as string[], null);
  } else {
    throw new ApiError(422, 'invalid_fields');
  }
  return { status: 200, body: { queued: true } };
};

function normaliseTarget(target: string): string {
  if (target.startsWith('typist:')) {
    const email = validEmail(target.slice('typist:'.length));
    return `typist:${email ?? target.slice('typist:'.length)}`;
  }
  return target;
}

export const routes: Route[] = [
  { method: 'GET', pattern: '/api/config', handler: configEndpoint },
  { method: 'POST', pattern: '/api/signup', handler: signUp },
  { method: 'POST', pattern: '/api/verify', handler: verify },
  { method: 'POST', pattern: '/api/session', handler: signIn },
  { method: 'DELETE', pattern: '/api/session', handler: signOut },
  { method: 'GET', pattern: '/api/me', handler: me, auth: 'required' },
  { method: 'POST', pattern: '/api/password-reset', handler: requestPasswordReset },
  { method: 'POST', pattern: '/api/password-reset/confirm', handler: confirmPasswordReset },
  { method: 'GET', pattern: '/api/settings', handler: readSettings, auth: 'required' },
  { method: 'PUT', pattern: '/api/settings', handler: writeSettings, auth: 'required' },
  { method: 'POST', pattern: '/api/tickets', handler: createTicket },
  { method: 'POST', pattern: '/api/runs', handler: submitRun, auth: 'verified' },
  { method: 'GET', pattern: '/api/runs/:id', handler: readRun },
  { method: 'GET', pattern: '/api/history', handler: readHistory, auth: 'required' },
  { method: 'GET', pattern: '/api/account', handler: readAccount, auth: 'required' },
  { method: 'GET', pattern: '/api/boards', handler: readBoard },
  { method: 'POST', pattern: '/api/rooms', handler: makeRoom, auth: 'required' },
  { method: 'GET', pattern: '/api/rooms/:code', handler: readRoom, auth: 'required' },
  { method: 'POST', pattern: '/api/rooms/:code/join', handler: joinRoom, auth: 'required' },
  { method: 'POST', pattern: '/api/rooms/:code/start', handler: startRace, auth: 'required' },
  { method: 'POST', pattern: '/api/rooms/:code/keys', handler: sendRaceKeys, auth: 'required' },
  { method: 'POST', pattern: '/api/rooms/:code/finish', handler: finishRace, auth: 'required' },
  { method: 'GET', pattern: '/api/live/board', handler: liveBoard },
  { method: 'GET', pattern: '/api/live/room/:code', handler: liveRoom, auth: 'required' },
  { method: 'POST', pattern: '/api/grading/setup', handler: gradingSetup },
  { method: 'POST', pattern: '/api/grading/next-text', handler: gradingNextText },
];
