import { Router } from 'express';
import { idMismatch, invalidField, nameTaken, notFound, versionConflict } from '../../shared/errors';
import { orderDocument } from '../../shared/json';
import { DocObject, fromJson, isPlainObject, toJson } from '../../shared/values';
import { collectionAccess, projectAccess, requireOwner, requireUser, requireWriter } from '../access';
import {
  collectionValidator,
  deleteDocument,
  documentCount,
  getStoredDocument,
  insertDocument,
  newId,
  prepareDocument,
  updateDocument,
} from '../collectionStore';
import { query, queryOne } from '../db';
import { body, handler } from '../httpUtil';
import { readCollectionName } from './projects';

export const collectionRoutes = Router();

function readDocumentBody(value: unknown): DocObject {
  const parsed = fromJson(value);
  if (!isPlainObject(parsed)) throw invalidField('document');
  return parsed;
}

collectionRoutes.get(
  '/projects/:pid/collections',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    const rows = await query<{ id: string; name: string; count: string }>(
      `select collections.id, collections.name,
              (select count(*) from documents where documents.collection_id = collections.id)::text as count
       from collections where collections.project_id = $1
       order by collections.name collate "C" asc`,
      [access.project.id],
    );
    res.json({ collections: rows.map((row) => ({ id: row.id, name: row.name, count: Number(row.count) })) });
  }),
);

collectionRoutes.post(
  '/projects/:pid/collections',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    requireOwner(access.role);
    const name = readCollectionName(body(req)['name'], 'name');
    const taken = await queryOne('select 1 from collections where project_id = $1 and name = $2', [
      access.project.id,
      name,
    ]);
    if (taken) throw nameTaken();
    const id = newId();
    await query('insert into collections (id, project_id, name) values ($1, $2, $3)', [id, access.project.id, name]);
    res.status(201).json({ collection: { id, name, count: 0 } });
  }),
);

collectionRoutes.get(
  '/projects/:pid/collections/:cid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const count = await documentCount(access.collection.id);
    res.json({
      id: access.collection.id,
      name: access.collection.name,
      count,
      sequence: Number(access.collection.sequence),
      validator: access.collection.validator ? (JSON.parse(access.collection.validator) as unknown) : null,
    });
  }),
);

collectionRoutes.delete(
  '/projects/:pid/collections/:cid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireOwner(access.role);
    await query('delete from collections where id = $1', [access.collection.id]);
    res.status(204).end();
  }),
);

collectionRoutes.post(
  '/projects/:pid/collections/:cid/documents',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireWriter(access.role);
    const raw = readDocumentBody(body(req)['document']);
    const doc = prepareDocument(raw, collectionValidator(access.collection), true);
    const stored = await insertDocument(access.collection, doc);
    res.status(201).json({ document: toJson(stored.doc), version: stored.version });
  }),
);

collectionRoutes.get(
  '/projects/:pid/collections/:cid/documents/:did',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const stored = await getStoredDocument(access.collection.id, req.params.did);
    if (!stored) throw notFound();
    res.json({ document: toJson(stored.doc), version: stored.version });
  }),
);

collectionRoutes.put(
  '/projects/:pid/collections/:cid/documents/:did',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const stored = await getStoredDocument(access.collection.id, req.params.did);
    if (!stored) throw notFound();
    requireWriter(access.role);
    const fields = body(req);
    const version = fields['version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) throw invalidField('version');
    if (version !== stored.version) throw versionConflict(stored.version, toJson(stored.doc));
    const raw = readDocumentBody(fields['document']);
    if (Object.prototype.hasOwnProperty.call(raw, '_id') && raw['_id'] !== req.params.did) throw idMismatch();
    const withId = orderDocument({ ...raw, _id: req.params.did });
    const doc = prepareDocument(withId, collectionValidator(access.collection), false);
    const result = await updateDocument(access.collection, req.params.did, doc, version);
    res.json({ document: toJson(result.doc), version: result.version });
  }),
);

collectionRoutes.delete(
  '/projects/:pid/collections/:cid/documents/:did',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const stored = await getStoredDocument(access.collection.id, req.params.did);
    if (!stored) throw notFound();
    requireWriter(access.role);
    await deleteDocument(access.collection, req.params.did);
    res.status(204).end();
  }),
);
