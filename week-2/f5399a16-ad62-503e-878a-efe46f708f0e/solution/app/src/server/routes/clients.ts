import { randomUUID } from 'node:crypto';
import { COPY } from '../../shared/copy';
import { foldedKey } from '../../shared/fold';
import { roundedNow, instant, clientJson, clientState, loadClient, producerJson, producerOfDesk } from '../records';
import { config } from '../config';
import { one, pool, rows, transaction } from '../db';
import { conflict, noContent, notFound, ok, route, type Context } from '../http';
import { checkMail, checkName, checkOneOf, throwIfAny, type Fields } from '../validate';

const PLACES = ['netherlands', 'ontario', 'newYork', 'dubai'] as const;
const TOWNS = ['amsterdam', 'newYork', 'toronto', 'dubai'] as const;
const LANGUAGES = ['en', 'nl', 'fr', 'ar'] as const;

function assertClientActive(state: string): void {
  if (state !== 'active') throw conflict(COPY.clientClosing);
}

route('GET', '/api/clients', {}, async ({ desk, now }) => {
  const all = await rows(pool, 'SELECT * FROM clients WHERE desk_id = $1 ORDER BY created_at, id', [desk.id]);
  const clients = all.filter((client) => client.state !== 'erased');
  return ok({
    clients: clients.map((client) => clientJson(client, now)),
    total: clients.length,
    erasedClients: all
      .filter((client) => client.state === 'erased')
      .map((client) => ({ id: client.id, name: client.name, erasedAt: instant(client.erased_at) })),
  });
});

route('POST', '/api/clients', {}, async ({ body, desk, now }) => {
  const fields: Fields = {};
  const name = checkName(fields, 'name', body.name);
  const place = checkOneOf(fields, 'place', body.place, PLACES, 'Pick a place.');
  throwIfAny(fields);
  const client = await one(
    pool,
    `INSERT INTO clients (id, desk_id, name, name_key, place, state, created_at) VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING *`,
    [randomUUID(), desk.id, name, foldedKey(name), place, new Date(now)],
  );
  return ok(clientJson(client as never, now), 201);
});

route('GET', '/api/clients/:id', { load: loadClient }, async ({ found, now }) => ok(clientJson(found, now)));

route('PATCH', '/api/clients/:id', { load: loadClient }, async ({ found, body, now }) => {
  const fields: Fields = {};
  const name = 'name' in body ? checkName(fields, 'name', body.name) : (found.name as string);
  const place = 'place' in body ? checkOneOf(fields, 'place', body.place, PLACES, 'Pick a place.') : found.place;
  throwIfAny(fields);
  assertClientActive(clientState(found, now));
  const client = await one(pool, 'UPDATE clients SET name = $1, name_key = $2, place = $3 WHERE id = $4 RETURNING *', [name, foldedKey(name), place, found.id]);
  return ok(clientJson(client as never, now));
});

route('DELETE', '/api/clients/:id', { load: loadClient }, async ({ found, now }) => {
  assertClientActive(clientState(found, now));
  const jobs = await one(pool, 'SELECT 1 FROM jobs WHERE client_id = $1 LIMIT 1', [found.id]);
  if (jobs) throw conflict(COPY.clientHasJobs);
  await transaction(async (tx) => {
    await tx.query('DELETE FROM calls WHERE producer_id IN (SELECT id FROM producers WHERE client_id = $1)', [found.id]);
    await tx.query('DELETE FROM clients WHERE id = $1', [found.id]);
  });
  return noContent();
});

route('POST', '/api/clients/:id/close', { load: loadClient, body: 'none' }, async ({ found, now }) => {
  assertClientActive(clientState(found, now));
  const closesAt = new Date(roundedNow(now) + config.closureWaitSeconds * 1000);
  const client = await one(pool, `UPDATE clients SET state = 'closing', closes_at = $1 WHERE id = $2 RETURNING *`, [closesAt, found.id]);
  return ok(clientJson(client as never, now));
});

route('POST', '/api/clients/:id/bring-back', { load: loadClient, body: 'none' }, async ({ found, now }) => {
  const state = clientState(found, now);
  if (state === 'active') throw conflict(COPY.notClosing);
  if (state !== 'closing') throw conflict(COPY.bringBackPassed);
  const client = await one(pool, `UPDATE clients SET state = 'active', closes_at = NULL WHERE id = $1 RETURNING *`, [found.id]);
  return ok(clientJson(client as never, now));
});

route('GET', '/api/clients/:id/producers', { load: loadClient }, async ({ found }) => {
  const producers = await rows(pool, 'SELECT * FROM producers WHERE client_id = $1 ORDER BY seq', [found.id]);
  return ok({ producers: producers.map(producerJson) });
});

function readProducer(body: Context['body'], held?: Record<string, unknown>) {
  const fields: Fields = {};
  const value = (key: string) => (key in body || !held ? body[key] : held[key]);
  const person = {
    name: checkName(fields, 'name', value('name')),
    email: checkMail(fields, 'email', value('email')),
    town: checkOneOf(fields, 'town', value('town'), TOWNS, 'Pick a town.'),
    language: checkOneOf(fields, 'language', value('language'), LANGUAGES, 'Pick a language.'),
  };
  throwIfAny(fields);
  return person;
}

route('POST', '/api/clients/:id/producers', { load: loadClient }, async ({ found, body, now }) => {
  const person = readProducer(body);
  assertClientActive(clientState(found, now));
  const producer = await one(
    pool,
    `INSERT INTO producers (id, client_id, name, name_key, email, town, language, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [randomUUID(), found.id, person.name, foldedKey(person.name), person.email, person.town, person.language, new Date(now)],
  );
  return ok(producerJson(producer as never), 201);
});

route(
  'PATCH',
  '/api/producers/:id',
  {
    load: async ({ params, desk }) => {
      if (!params.id) throw notFound();
      return producerOfDesk(pool, params.id, desk.id);
    },
  },
  async ({ found, body }) => {
    const person = readProducer(body, found);
    if (found.client_state !== 'active') throw conflict(COPY.clientClosing);
    const producer = await one(pool, 'UPDATE producers SET name = $1, name_key = $2, email = $3, town = $4, language = $5 WHERE id = $6 RETURNING *', [
      person.name, foldedKey(person.name), person.email, person.town, person.language, found.id,
    ]);
    return ok(producerJson(producer as never));
  },
);
