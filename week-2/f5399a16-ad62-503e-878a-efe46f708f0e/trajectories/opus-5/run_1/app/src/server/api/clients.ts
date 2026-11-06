import { randomUUID } from 'node:crypto';
import { COPY } from '../../domain/copy.js';
import { LANGUAGES } from '../../domain/privateCopy.js';
import { PLACES, toInstantText, TOWNS } from '../../domain/time.js';
import { config } from '../config.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { clientJson, producerJson, requireClient, requireProducer } from './support.js';
import type { ClientRow, ProducerRow } from './support.js';

async function readProducers(clientId: string): Promise<ProducerRow[]> {
  return query<ProducerRow>(
    'select * from producers where client_id = $1 order by created_at asc, id asc',
    [clientId],
  );
}

function requireActive(client: ClientRow): ClientRow {
  if (client.state !== 'active') throw refuse.state(COPY.clientClosing);
  return client;
}

export const clientRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/clients',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const clients = await query<ClientRow>(
        `select * from clients where desk_id = $1 and state <> 'erased'
          order by created_at asc, id asc`,
        [desk.id],
      );
      const erased = await query<{ id: string; name: string; erased_at: Date }>(
        `select id, name, erased_at from clients where desk_id = $1 and state = 'erased'
          order by erased_at asc, id asc`,
        [desk.id],
      );
      return {
        status: 200,
        body: {
          clients: clients.map(clientJson),
          total: clients.length,
          erasedClients: erased.map((row) => ({
            id: row.id,
            name: row.name,
            erasedAt: toInstantText(row.erased_at),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clients',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeName);
      const place = fields.choice(body, 'place', PLACES);
      fields.done();
      const id = randomUUID();
      await query(
        `insert into clients (id, desk_id, name, place, state, created_at)
         values ($1,$2,$3,$4,'active',now())`,
        [id, desk.id, name, place],
      );
      const client = await requireClient(desk.id, id);
      return { status: 201, body: clientJson(client) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clients/:id',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      return { status: 200, body: clientJson(client) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/clients/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = 'name' in body ? fields.text(body, 'name', COPY.typeName) : client.name;
      const place = 'place' in body ? fields.choice(body, 'place', PLACES) : client.place;
      fields.done();
      requireActive(client);
      await query('update clients set name = $1, place = $2 where id = $3', [
        name,
        place,
        client.id,
      ]);
      return { status: 200, body: clientJson(await requireClient(desk.id, client.id)) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/clients/:id',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      requireActive(client);
      const held = await one<{ count: string }>(
        'select count(*)::text as count from jobs where client_id = $1',
        [client.id],
      );
      if (Number(held?.count ?? '0') > 0) throw refuse.state(COPY.clientHasJobs);
      await query('delete from clients where id = $1', [client.id]);
      return { status: 204 };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clients/:id/close',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      requireActive(client);
      const closesAt = new Date(
        Math.floor(Date.now() / 1000) * 1000 + config.timers.closureWaitSeconds * 1000,
      );
      await query("update clients set state = 'closing', closes_at = $1 where id = $2", [
        closesAt,
        client.id,
      ]);
      return { status: 200, body: clientJson(await requireClient(desk.id, client.id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clients/:id/bring-back',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      if (client.state === 'active') throw refuse.state(COPY.clientNotClosing);
      if (client.state !== 'closing' || (client.closes_at?.getTime() ?? 0) <= Date.now()) {
        throw refuse.state(COPY.bringBackPassed);
      }
      await query("update clients set state = 'active', closes_at = null where id = $1", [
        client.id,
      ]);
      return { status: 200, body: clientJson(await requireClient(desk.id, client.id)) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clients/:id/producers',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const producers = await readProducers(client.id);
      return { status: 200, body: { producers: producers.map(producerJson) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clients/:id/producers',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const client = await requireClient(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeName);
      const email = fields.email(body);
      const town = fields.choice(body, 'town', TOWNS);
      const language = fields.choice(body, 'language', LANGUAGES);
      fields.done();
      requireActive(client);
      const id = randomUUID();
      await query(
        `insert into producers (id, client_id, name, email, town, language, created_at)
         values ($1,$2,$3,$4,$5,$6,now())`,
        [id, client.id, name, email, town, language],
      );
      return { status: 201, body: producerJson(await requireProducer(desk.id, id)) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/producers/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const producer = await requireProducer(
        desk.id,
        requireUuidParam(context.params['id'] ?? ''),
      );
      const client = await requireClient(desk.id, producer.client_id);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = 'name' in body ? fields.text(body, 'name', COPY.typeName) : producer.name;
      const email = 'email' in body ? fields.email(body) : producer.email;
      const town = 'town' in body ? fields.choice(body, 'town', TOWNS) : producer.town;
      const language =
        'language' in body ? fields.choice(body, 'language', LANGUAGES) : producer.language;
      fields.done();
      requireActive(client);
      await query(
        'update producers set name = $1, email = $2, town = $3, language = $4 where id = $5',
        [name, email, town, language, producer.id],
      );
      return { status: 200, body: producerJson(await requireProducer(desk.id, producer.id)) };
    },
  },
];
