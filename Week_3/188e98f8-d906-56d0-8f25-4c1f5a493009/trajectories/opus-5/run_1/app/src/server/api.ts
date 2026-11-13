/** The published API surface: one route table, one error precedence. */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Role } from '../shared/desk.js';
import type { AcceptedBody, AnswersBody, RoundsBody, SessionBody } from '../shared/model.js';
import {
  answerById,
  currentAnswers,
  storeSubmit,
  withoutMarks,
} from './answers.js';
import {
  archivePage,
  bodyDepth,
  readCursor,
  readLimit,
  readRoundFilter,
  searchAnswers,
  SEARCH_BODY_DEPTH,
} from './archive.js';
import type { App } from './app.js';
import { one } from './db.js';
import {
  disputeById,
  listDisputes,
  raiseDispute,
  ruleOnDispute,
} from './disputes.js';
import {
  forbidden,
  invalidFields,
  notFound,
  signedOut,
  storageUnavailable,
  unsupportedMediaType,
} from './errors.js';
import {
  checkJsonType,
  declaredType,
  json,
  JSON_BODY_CAP,
  parseJsonBody,
  readBody,
  refuseMethod,
  type BodyKind,
  type Reply,
} from './http.js';
import {
  canonicalJson,
  IDEMPOTENCY_HEADER,
  keyIsWellFormed,
  rememberSubmit,
  replayOrClash,
} from './idempotency.js';
import { answerInRound, recordMark, refuseUnlessCurrent } from './marks.js';
import { countSubmit } from './rate.js';
import {
  closeRound,
  markRound,
  openRound,
  publishRound,
  readRound,
  readRounds,
  refuseMarkUnlessClosed,
  refuseSheetRead,
  refuseSheetUpload,
  refuseSubmitUnlessOpen,
  roundRow,
  settleRounds,
  serverNow,
  toRound,
} from './rounds.js';
import {
  inspectSheet,
  sheetExtension,
  sheetType,
  SHEET_MAX_BYTES,
  type SheetType,
} from './sheets.js';
import {
  clearedCookie,
  closeSession,
  openSession,
  readSession,
  sessionCookie,
  type Session,
} from './sessions.js';
import { StorageUnreachable } from './storage.js';
import { leagueTable } from './table.js';
import { renameTeam, teamExists } from './teams.js';
import { asPoints, asPositiveInt, field, readSubmitItems, verdictFor } from './validate.js';

interface Ctx {
  app: App;
  url: URL;
  params: number[];
  body: unknown;
  headers: IncomingMessage['headers'];
}

interface DeskCtx extends Ctx {
  session: Session;
}

interface SheetCtx extends DeskCtx {
  imageType: SheetType;
  bytes: Buffer;
}

type RouteMethod =
  | { kind: 'public'; body: BodyKind; run: (ctx: Ctx) => Promise<Reply> }
  | { kind: 'desk'; body: BodyKind; run: (ctx: DeskCtx) => Promise<Reply> }
  | { kind: 'sheet'; run: (ctx: SheetCtx) => Promise<Reply> };

interface Route {
  segments: string[];
  methods: Record<string, RouteMethod>;
}

function onlyRole(session: Session, ...roles: Role[]): void {
  if (!roles.includes(session.role)) throw forbidden();
}

function captainTeam(session: Session): number {
  onlyRole(session, 'captain');
  if (session.teamId === null) throw forbidden();
  return session.teamId;
}

async function night(app: App): Promise<number> {
  const result = await app.db.query<{ night: number }>('select night from league where id = 1');
  return one(result).night;
}

/* Health and session */

const health: RouteMethod = {
  kind: 'public',
  body: 'none',
  run: async (ctx) =>
    ctx.app.ready() ? json(200, { status: 'ok' }) : json(503, { status: 'starting' }),
};

const signIn: RouteMethod = {
  kind: 'public',
  body: 'json',
  run: async (ctx) => {
    const opened = await openSession(ctx.app.db, field(ctx.body, 'code'));
    return json(201, opened.body satisfies SessionBody, { 'Set-Cookie': sessionCookie(opened.token) });
  },
};

const readDesk: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) =>
    json(200, {
      role: ctx.session.role,
      team_id: ctx.session.teamId,
      team_name: ctx.session.teamName,
    } satisfies SessionBody),
};

const signOut: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    await closeSession(ctx.app.db, ctx.session.token);
    return { kind: 'empty', status: 204, headers: { 'Set-Cookie': clearedCookie() } };
  },
};

/* Rounds and table */

const listRounds: RouteMethod = {
  kind: 'public',
  body: 'none',
  run: async (ctx) => {
    const { rounds, serverTime } = await readRounds(ctx.app.db);
    return json(200, {
      night: await night(ctx.app),
      server_time: serverTime.toISOString(),
      rounds,
    } satisfies RoundsBody);
  },
};

const showRound: RouteMethod = {
  kind: 'public',
  body: 'none',
  run: async (ctx) => json(200, { round: await readRound(ctx.app.db, roundOf(ctx)) }),
};

const showTable: RouteMethod = {
  kind: 'public',
  body: 'none',
  run: async (ctx) => json(200, await leagueTable(ctx.app.db)),
};

function roundOf(ctx: Ctx): number {
  const number = ctx.params[0];
  if (number === undefined) throw notFound();
  return number;
}

/* Picture sheets */

const putSheet: RouteMethod = {
  kind: 'sheet',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    const round = await roundRow(ctx.app.db, number);
    onlyRole(ctx.session, 'quizmaster');
    refuseSheetUpload(round.kind, round.status);

    const inspected = inspectSheet(ctx.bytes, ctx.imageType);
    if (inspected.verdict === 'empty') throw invalidFields({ body: 'required' });
    if (inspected.verdict === 'content') throw unsupportedMediaType();
    if (inspected.verdict === 'dimensions') throw invalidFields({ body: 'invalid' });

    const sha256 = createHash('sha256').update(ctx.bytes).digest('hex');
    const key = ctx.app.store.sheetKey(
      await night(ctx.app),
      number,
      sha256,
      sheetExtension(ctx.imageType),
    );
    try {
      await ctx.app.store.put(key, ctx.bytes, ctx.imageType);
      const confirmed = await ctx.app.store.confirm(key);
      if (confirmed === null || confirmed.size !== ctx.bytes.byteLength || confirmed.sha256 !== sha256) {
        throw storageUnavailable();
      }
    } catch (failure) {
      throw failure instanceof StorageUnreachable ? storageUnavailable() : failure;
    }
    await ctx.app.db.query(
      `update rounds set sheet_key = $2, sheet_size = $3, sheet_sha256 = $4, sheet_width = $5,
              sheet_height = $6
         where number = $1`,
      [number, key, ctx.bytes.byteLength, sha256, inspected.width, inspected.height],
    );
    const stored = await roundRow(ctx.app.db, number);
    return json(201, { round: toRound(stored, await serverNow(ctx.app.db)) });
  },
};

const getSheet: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    const round = await roundRow(ctx.app.db, number);
    refuseSheetRead(round.status, ctx.session.role);
    if (round.sheet_key === null) throw notFound();
    try {
      const object = await ctx.app.store.get(round.sheet_key);
      if (object === null) throw notFound();
      return { kind: 'bytes', status: 200, bytes: object.bytes, contentType: object.contentType };
    } catch (failure) {
      throw failure instanceof StorageUnreachable ? storageUnavailable() : failure;
    }
  },
};

/* Running the night */

const openOne: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    await roundRow(ctx.app.db, number);
    onlyRole(ctx.session, 'quizmaster');
    return json(200, {
      round: await openRound(
        { db: ctx.app.db, store: ctx.app.store, roundSeconds: ctx.app.config.roundSeconds },
        number,
      ),
    });
  },
};

const closeOne: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    await roundRow(ctx.app.db, number);
    onlyRole(ctx.session, 'quizmaster');
    return json(200, { round: await closeRound(ctx.app.db, number) });
  },
};

const publishOne: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    await roundRow(ctx.app.db, number);
    onlyRole(ctx.session, 'quizmaster');
    const published = await publishRound(ctx.app.db, number);
    return json(200, { round: published.round, table: published.table });
  },
};

const markRoundDone: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    await roundRow(ctx.app.db, number);
    onlyRole(ctx.session, 'marker');
    return json(200, { round: await markRound(ctx.app.db, number) });
  },
};

/* Answers */

const submitAnswers: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    const round = await roundRow(ctx.app.db, number);
    const teamId = captainTeam(ctx.session);

    await countSubmit(ctx.app.db, teamId);

    const header = ctx.headers[IDEMPOTENCY_HEADER];
    const key = typeof header === 'string' ? header : null;
    const canonical = canonicalJson(ctx.body);
    if (key !== null && keyIsWellFormed(key)) {
      const replay = await replayOrClash(ctx.app.db, teamId, key, number, canonical);
      if (replay !== null) {
        return {
          kind: 'json',
          status: replay.status,
          body: JSON.parse(replay.body) as unknown,
          headers: { 'Idempotent-Replayed': 'true' },
        };
      }
    }

    refuseSubmitUnlessOpen(round.status);
    if (key !== null && !keyIsWellFormed(key)) throw invalidFields({ idempotency_key: 'invalid' });
    const items = readSubmitItems(ctx.body);

    const accepted = await storeSubmit(ctx.app.db, number, teamId, items);
    const body: AcceptedBody = { round: number, accepted };
    if (key !== null) {
      await rememberSubmit(ctx.app.db, teamId, key, number, canonical, 201, JSON.stringify(body));
    }
    return json(201, body);
  },
};

const roundAnswers: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    const round = await roundRow(ctx.app.db, number);
    if (ctx.session.role === 'captain') {
      const teamId = captainTeam(ctx.session);
      const mine = await currentAnswers(ctx.app.db, number, teamId);
      const shown = round.status === 'marked' || round.status === 'published' ? mine : mine.map(withoutMarks);
      return json(200, { round: number, answers: shown } satisfies AnswersBody);
    }
    return json(200, {
      round: number,
      answers: await currentAnswers(ctx.app.db, number, null),
    } satisfies AnswersBody);
  },
};

/* Marks */

const putMark: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    const number = roundOf(ctx);
    await settleRounds(ctx.app.db);
    const round = await roundRow(ctx.app.db, number);
    const named = field(ctx.body, 'answer_id');
    const answerId = asPositiveInt(named);
    const answer = answerId === null ? null : await answerInRound(ctx.app.db, number, answerId);
    if (answerId !== null && answer === null) throw notFound();
    onlyRole(ctx.session, 'marker');
    refuseMarkUnlessClosed(round.status);
    if (answer !== null) refuseUnlessCurrent(answer);
    const scored = field(ctx.body, 'points');
    const points = asPoints(scored);
    if (answerId === null || points === null) {
      throw invalidFields({
        ...(answerId === null ? { answer_id: verdictFor(named) } : {}),
        ...(points === null ? { points: verdictFor(scored) } : {}),
      });
    }
    return json(200, { answer: await recordMark(ctx.app.db, number, answerId, points) });
  },
};

/* Archive */

const archive: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    onlyRole(ctx.session, 'quizmaster', 'marker');
    const limit = readLimit(ctx.url.searchParams.get('limit'));
    const cursor = readCursor(ctx.url.searchParams.get('cursor'));
    const round = readRoundFilter(ctx.url.searchParams.get('round'));
    return json(200, await archivePage(ctx.app.db, limit, cursor, round));
  },
};

const search: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    onlyRole(ctx.session, 'quizmaster', 'marker');
    if (bodyDepth(ctx.body) > SEARCH_BODY_DEPTH) throw invalidFields({ body: 'too_deep' });
    return json(200, await searchAnswers(ctx.app.db, field(ctx.body, 'query'), field(ctx.body, 'round')));
  },
};

/* Teams */

const rename: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    const id = ctx.params[0];
    if (id === undefined || !(await teamExists(ctx.app.db, id))) throw notFound();
    const teamId = captainTeam(ctx.session);
    if (teamId !== id) throw forbidden();
    return json(200, { team: await renameTeam(ctx.app.db, id, field(ctx.body, 'name')) });
  },
};

/* Disputes */

const postDispute: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    const named = field(ctx.body, 'answer_id');
    const answerId = asPositiveInt(named);
    const answer = answerId === null ? null : await answerById(ctx.app.db, answerId);
    if (answerId !== null && answer === null) throw notFound();
    const teamId = captainTeam(ctx.session);
    if (answer === null) throw invalidFields({ answer_id: verdictFor(named) });
    if (answer.team_id !== teamId) throw forbidden();
    await settleRounds(ctx.app.db);
    return json(201, { dispute: await raiseDispute(ctx.app.db, answer, field(ctx.body, 'reason')) });
  },
};

const getDisputes: RouteMethod = {
  kind: 'desk',
  body: 'none',
  run: async (ctx) => {
    onlyRole(ctx.session, 'quizmaster', 'captain');
    const teamId = ctx.session.role === 'captain' ? captainTeam(ctx.session) : null;
    return json(200, { disputes: await listDisputes(ctx.app.db, teamId) });
  },
};

const postRuling: RouteMethod = {
  kind: 'desk',
  body: 'json',
  run: async (ctx) => {
    const id = ctx.params[0];
    if (id === undefined || (await disputeById(ctx.app.db, id)) === null) throw notFound();
    onlyRole(ctx.session, 'quizmaster');
    const dispute = await ruleOnDispute(
      { db: ctx.app.db, mail: ctx.app.mail },
      id,
      field(ctx.body, 'ruling'),
    );
    return json(200, { dispute });
  },
};

const ROUTES: Route[] = [
  { segments: ['api', 'health'], methods: { GET: health } },
  { segments: ['api', 'session'], methods: { POST: signIn, GET: readDesk, DELETE: signOut } },
  { segments: ['api', 'rounds'], methods: { GET: listRounds } },
  { segments: ['api', 'rounds', ':n'], methods: { GET: showRound } },
  { segments: ['api', 'table'], methods: { GET: showTable } },
  { segments: ['api', 'rounds', ':n', 'sheet'], methods: { PUT: putSheet, GET: getSheet } },
  { segments: ['api', 'rounds', ':n', 'open'], methods: { POST: openOne } },
  { segments: ['api', 'rounds', ':n', 'close'], methods: { POST: closeOne } },
  { segments: ['api', 'rounds', ':n', 'publish'], methods: { POST: publishOne } },
  { segments: ['api', 'rounds', ':n', 'answers'], methods: { POST: submitAnswers, GET: roundAnswers } },
  { segments: ['api', 'rounds', ':n', 'marks'], methods: { PUT: putMark } },
  { segments: ['api', 'rounds', ':n', 'marked'], methods: { POST: markRoundDone } },
  { segments: ['api', 'answers'], methods: { GET: archive } },
  { segments: ['api', 'answers', 'search'], methods: { POST: search } },
  { segments: ['api', 'teams', ':id'], methods: { PATCH: rename } },
  { segments: ['api', 'disputes'], methods: { POST: postDispute, GET: getDisputes } },
  { segments: ['api', 'disputes', ':id', 'ruling'], methods: { POST: postRuling } },
];

function match(path: string): { route: Route; params: number[] } | null {
  const segments = path.split('/').filter((piece) => piece !== '');
  for (const route of ROUTES) {
    if (route.segments.length !== segments.length) continue;
    const params: number[] = [];
    let fits = true;
    for (const [index, expected] of route.segments.entries()) {
      const given = segments[index] ?? '';
      if (expected.startsWith(':')) {
        if (!/^[0-9]+$/.test(given)) {
          fits = false;
          break;
        }
        params.push(Number(given));
        continue;
      }
      if (expected !== given) {
        fits = false;
        break;
      }
    }
    if (fits) return { route, params };
  }
  return null;
}

export async function handleApi(app: App, request: IncomingMessage, url: URL): Promise<Reply> {
  const found = match(url.pathname);
  if (found === null) throw notFound();
  const asked = request.method ?? 'GET';
  const wanted = asked === 'HEAD' ? 'GET' : asked;
  const chosen = found.route.methods[wanted];
  if (chosen === undefined) refuseMethod(Object.keys(found.route.methods));

  const base = {
    app,
    url,
    params: found.params,
    headers: request.headers,
  };

  if (chosen.kind === 'sheet') {
    const bytes = await readBody(request, SHEET_MAX_BYTES);
    const imageType = sheetType(declaredType(request) ?? '');
    if (imageType === null) throw unsupportedMediaType();
    const session = await readSession(app.db, request.headers.cookie);
    if (session === null) throw signedOut();
    return chosen.run({ ...base, body: null, session, imageType, bytes });
  }

  const raw = await readBody(request, JSON_BODY_CAP);
  checkJsonType(request, asked);
  const body = chosen.body === 'json' ? parseJsonBody(raw) : null;

  if (chosen.kind === 'desk') {
    const session = await readSession(app.db, request.headers.cookie);
    if (session === null) throw signedOut();
    return chosen.run({ ...base, body, session });
  }
  return chosen.run({ ...base, body });
}
