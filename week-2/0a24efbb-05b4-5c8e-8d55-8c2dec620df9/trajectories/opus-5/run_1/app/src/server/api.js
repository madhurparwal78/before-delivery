import { refusals } from '../shared/copy.js';
import { parseQueueQuery } from '../shared/queueQuery.js';
import { checkNoNul, checkUnpublishedKeys, isMissing } from './bodyChecks.js';
import { readCalendar } from './calendar.js';
import { Refusal, refuseField } from './errors.js';
import { policyHistory, policyInForce, policyObject, savePolicy } from './policy.js';
import { readinessState } from './readiness.js';
import {
  cancelRequest,
  decideRequest,
  parseRecordId,
  raiseRequest,
  readQueue,
  readRequestDetail,
} from './requests.js';
import { endSessionByToken } from './sessions.js';
import { signIn } from './signIn.js';
import { mintShareLink, revokeShareLink } from './shareLinks.js';
import { exportTrailCsv, readTrail, verifyTrail } from './trail.js';

const SESSION_FIELDS = ['work_address', 'password'];

function json(status, body, extra) {
  return { status, body, ...extra };
}

async function signInHandler(ctx) {
  checkUnpublishedKeys(ctx.body, SESSION_FIELDS);
  for (const field of SESSION_FIELDS) {
    checkNoNul(ctx.body[field], field);
    if (isMissing(ctx.body, field) || typeof ctx.body[field] !== 'string' || ctx.body[field] === '') {
      refuseField(400, refusals.missingField(field), field);
    }
  }
  const { person, token } = await signIn(ctx.body.work_address, ctx.body.password, ctx.presentedToken);
  return json(
    200,
    { person: { name: person.name, work_address: person.work_address }, role: person.role, token },
    { setSessionCookie: token },
  );
}

async function queueHandler(ctx) {
  const parsed = parseQueueQuery(ctx.searchParams);
  if (parsed.failure) throw new Refusal(400, parsed.failure.error, { field: parsed.failure.field });
  return json(200, await readQueue(ctx.caller, parsed.query));
}

async function raiseHandler(ctx) {
  const key = ctx.headers['idempotency-key'];
  const outcome = await raiseRequest(ctx.caller, ctx.body, key);
  if (outcome.replayed) {
    return json(200, outcome.request, { headers: { 'idempotent-replayed': 'true' } });
  }
  return json(201, outcome.request);
}

async function detailHandler(ctx) {
  const read = await readRequestDetail(ctx.caller, parseRecordId(ctx.params.id));
  return json(200, read.detail);
}

async function decisionHandler(ctx) {
  return json(200, await decideRequest(ctx.caller, parseRecordId(ctx.params.id), ctx.body));
}

async function cancelHandler(ctx) {
  return json(200, await cancelRequest(ctx.caller, parseRecordId(ctx.params.id), ctx.body));
}

async function policyReadHandler() {
  const current = await policyInForce();
  return json(200, policyObject(current), { headers: { etag: `"${current.version}"` } });
}

async function policySaveHandler(ctx) {
  const saved = await savePolicy(ctx.caller, ctx.body, ctx.headers['if-match']);
  return json(201, saved, { headers: { etag: `"${saved.version}"` } });
}

async function policyHistoryHandler(ctx) {
  if (ctx.caller.role !== 'admin') throw new Refusal(403, refusals.onlyAdminReadsHistory);
  const versions = await policyHistory();
  return json(200, { versions: versions.map(policyObject) }, { headers: { etag: `"${versions[0].version}"` } });
}

async function shareMintHandler(ctx) {
  return json(201, await mintShareLink(ctx.caller, ctx.body));
}

async function shareRevokeHandler(ctx) {
  await revokeShareLink(ctx.caller, parseRecordId(ctx.params.id), ctx.body);
  return json(204, null);
}

export const ENDPOINTS = [
  {
    segments: ['health'],
    methods: {
      GET: () => {
        const state = readinessState();
        if (state.ready) return json(200, { status: 'ok', schema: true, seeded: true, realm: true });
        return json(503, { status: 'starting', ...state.flags });
      },
    },
    openToEveryone: true,
  },
  {
    segments: ['session'],
    methods: {
      POST: signInHandler,
      GET: (ctx) =>
        json(200, {
          person: { name: ctx.caller.name, work_address: ctx.caller.work_address },
          role: ctx.caller.role,
        }),
      DELETE: async (ctx) => {
        await endSessionByToken(ctx.presentedToken);
        return json(204, null, { clearSessionCookie: true });
      },
    },
    openMethods: ['POST'],
  },
  { segments: ['requests'], methods: { GET: queueHandler, POST: raiseHandler } },
  { segments: ['requests', ':id'], methods: { GET: detailHandler } },
  { segments: ['requests', ':id', 'decision'], methods: { POST: decisionHandler } },
  { segments: ['requests', ':id', 'cancel'], methods: { POST: cancelHandler } },
  { segments: ['policy', 'history'], methods: { GET: policyHistoryHandler } },
  { segments: ['policy'], methods: { GET: policyReadHandler, PUT: policySaveHandler } },
  { segments: ['audit'], methods: { GET: async (ctx) => json(200, await readTrail(ctx.caller)) } },
  {
    segments: ['trail.csv'],
    methods: {
      GET: async (ctx) =>
        json(200, await exportTrailCsv(ctx.caller), {
          contentType: 'text/csv; charset=utf-8',
          headers: { 'content-disposition': 'attachment; filename="trail.csv"' },
        }),
    },
  },
  { segments: ['trail', 'verify'], methods: { GET: async (ctx) => json(200, await verifyTrail(ctx.caller)) } },
  {
    segments: ['calendar'],
    methods: {
      GET: async (ctx) =>
        json(
          200,
          await readCalendar(ctx.caller, {
            month: ctx.searchParams.get('month') ?? '',
            person: ctx.searchParams.get('person') ?? '',
          }),
        ),
    },
  },
  { segments: ['share-links'], methods: { POST: shareMintHandler } },
  { segments: ['share-links', ':id'], methods: { DELETE: shareRevokeHandler } },
];

function matches(endpoint, segments) {
  if (endpoint.segments.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < segments.length; index += 1) {
    const expected = endpoint.segments[index];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = segments[index];
      continue;
    }
    if (expected !== segments[index]) return null;
  }
  return params;
}

/** Resolves a path under /api/ to a published endpoint, literal segments winning. */
export function resolveEndpoint(segments) {
  for (const endpoint of ENDPOINTS) {
    const params = matches(endpoint, segments);
    if (params) return { endpoint, params };
  }
  return null;
}

export function allowHeader(endpoint) {
  const methods = Object.keys(endpoint.methods);
  if (methods.includes('GET')) methods.push('HEAD');
  return methods.join(', ');
}
