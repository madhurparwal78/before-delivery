import { randomBytes } from 'node:crypto';
import { fail } from '../http/errors.js';
import {
  SESSION_COOKIE,
  readCookie,
  requireSession,
  route,
  sendJson,
  type RequestContext,
} from '../http/router.js';
import { requireEmail, requirePasscode, requireText } from '../http/validate.js';
import * as store from '../db/store.js';
import { hashPasscode, passcodeMatches } from '../services/passcodes.js';
import { formatInstant } from '../domain/time.js';
import { shipDateOf } from '../domain/ship-time.js';

function setSessionCookie(context: RequestContext, token: string): void {
  context.res.setHeader(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
  );
}

async function startSession(
  context: RequestContext,
  personId: string,
  role: store.Role,
): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await store.insertSession(token, personId, role);
  setSessionCookie(context, token);
}

export function registerIdentityRoutes(): void {
  route('POST', '/api/owners', 'none', async (context) => {
    const body = context.json();
    const name = requireText(body, 'name', 'Your name', 1, 120);
    const email = requireEmail(body, 'email');
    const passcode = requirePasscode(body, 'passcode');
    if (await store.emailTaken(email)) fail(409, 'email_taken');
    const id = store.newId('owner');
    if (!(await store.insertOwner(id, name, email, hashPasscode(passcode)))) fail(409, 'email_taken');
    await startSession(context, id, 'owner_master');
    sendJson(context.res, 201, { id, name, email, role: 'owner_master' });
  });

  route('POST', '/api/session', 'none', async (context) => {
    const body = context.json();
    const email = typeof body['email'] === 'string' ? body['email'] : '';
    const passcode = typeof body['passcode'] === 'string' ? body['passcode'] : '';
    const owner = await store.findOwnerByEmail(email);
    if (owner !== null && passcodeMatches(passcode, owner.passcodeHash)) {
      await startSession(context, owner.id, 'owner_master');
      sendJson(context.res, 200, {
        id: owner.id,
        name: owner.name,
        role: 'owner_master',
        vessel_id: null,
      });
      return;
    }
    const crew = await store.findCrewByEmail(email);
    if (crew !== null && passcodeMatches(passcode, crew.passcodeHash)) {
      await startSession(context, crew.id, 'crew');
      sendJson(context.res, 200, {
        id: crew.id,
        name: crew.name,
        role: 'crew',
        vessel_id: crew.vesselId,
      });
      return;
    }
    fail(401, 'bad_credentials');
  });

  route('DELETE', '/api/session', 'none', async (context) => {
    const token = readCookie(context.req, SESSION_COOKIE);
    if (token !== null) await store.deleteSession(token);
    context.res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    context.res.writeHead(204, { 'cache-control': 'no-store' });
    context.res.end();
  });

  route('GET', '/api/me', 'session', async (context) => {
    const session = requireSession(context);
    if (session.role === 'owner_master') {
      const owner = await store.findOwnerById(session.personId);
      if (owner === null) fail(401, 'not_signed_in');
      sendJson(context.res, 200, {
        id: owner.id,
        name: owner.name,
        role: 'owner_master',
        vessel_id: null,
        server_now_utc: formatInstant(context.nowMs),
        today_ship_date: null,
      });
      return;
    }
    const crew = await store.findCrewById(session.personId);
    if (crew === null) fail(401, 'not_signed_in');
    const vessel = await store.findVesselById(crew.vesselId);
    const clock = await store.loadVesselClock(vessel as store.Vessel);
    sendJson(context.res, 200, {
      id: crew.id,
      name: crew.name,
      role: 'crew',
      vessel_id: crew.vesselId,
      server_now_utc: formatInstant(context.nowMs),
      today_ship_date: shipDateOf(clock, context.nowMs),
    });
  });
}
