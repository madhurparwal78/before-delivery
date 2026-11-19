import { Router } from 'express';
import { cannotDropIdIndex, invalidIndex, nameTaken, notFound } from '../../shared/errors';
import { IndexDefinition, defaultIndexName } from '../../shared/indexPlan';
import { DocValue, fromJson, isPlainObject, toJson } from '../../shared/values';
import { parseValidator } from '../../shared/validator';
import { collectionAccess, requireOwner, requireUser } from '../access';
import { createUniqueIndexEntries, listIndexes, newId } from '../collectionStore';
import { query, queryOne, withTransaction } from '../db';
import { body, handler } from '../httpUtil';

export const indexRoutes = Router();

const PATH = '/projects/:pid/collections/:cid';

function readIndexKeys(value: DocValue): IndexDefinition['keys'] {
  if (!isPlainObject(value)) throw invalidIndex();
  const paths = Object.keys(value);
  if (paths.length === 0) throw invalidIndex();
  return paths.map((path) => {
    const direction = value[path];
    if (direction !== 1 && direction !== -1) throw invalidIndex();
    if (path.length === 0) throw invalidIndex();
    return { path, direction };
  });
}

indexRoutes.get(
  `${PATH}/indexes`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const indexes = await listIndexes(access.collection.id);
    res.json({
      indexes: indexes.map((index) => ({
        name: index.name,
        keys: Object.fromEntries(index.keys.map((key) => [key.path, key.direction])),
        unique: index.unique,
      })),
    });
  }),
);

indexRoutes.post(
  `${PATH}/indexes`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireOwner(access.role);
    const fields = body(req);
    const keys = readIndexKeys(fromJson(fields['keys']));
    const uniqueValue = fields['unique'] ?? false;
    if (typeof uniqueValue !== 'boolean') throw invalidIndex();
    const nameValue = fields['name'];
    if (nameValue !== undefined && nameValue !== null && (typeof nameValue !== 'string' || nameValue.length === 0)) {
      throw invalidIndex();
    }
    const name = typeof nameValue === 'string' ? nameValue : defaultIndexName(keys);
    if (name === '_id_') throw nameTaken();
    const taken = await queryOne('select 1 from collection_indexes where collection_id = $1 and name = $2', [
      access.collection.id,
      name,
    ]);
    if (taken) throw nameTaken();
    const id = newId();
    await withTransaction(async (client) => {
      await client.query(
        'insert into collection_indexes (id, collection_id, name, keys, unique_index) values ($1, $2, $3, $4, $5)',
        [id, access.collection.id, name, JSON.stringify(keys), uniqueValue],
      );
      if (uniqueValue) await createUniqueIndexEntries(client, access.collection.id, id, name, keys);
    });
    res.status(201).json({
      index: {
        name,
        keys: Object.fromEntries(keys.map((key) => [key.path, key.direction])),
        unique: uniqueValue,
      },
    });
  }),
);

indexRoutes.delete(
  `${PATH}/indexes/:name`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireOwner(access.role);
    if (req.params.name === '_id_') throw cannotDropIdIndex();
    const existing = await queryOne<{ id: string }>(
      'select id from collection_indexes where collection_id = $1 and name = $2',
      [access.collection.id, req.params.name],
    );
    if (!existing) throw notFound();
    await query('delete from collection_indexes where id = $1', [existing.id]);
    res.status(204).end();
  }),
);

indexRoutes.get(
  `${PATH}/validator`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    res.json({ validator: access.collection.validator ? (JSON.parse(access.collection.validator) as unknown) : null });
  }),
);

indexRoutes.put(
  `${PATH}/validator`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireOwner(access.role);
    const raw = body(req)['validator'] ?? null;
    const value = fromJson(raw);
    parseValidator(value);
    const stored = value === null ? null : JSON.stringify(toJson(value));
    await query('update collections set validator = $2 where id = $1', [access.collection.id, stored]);
    res.json({ validator: raw });
  }),
);
