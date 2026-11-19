import { Router } from 'express';
import { PoolClient } from 'pg';
import { checkDocumentShape } from '../../shared/documentRules';
import { duplicateKey, invalidField, nameTaken } from '../../shared/errors';
import { IndexDefinition, defaultIndexName } from '../../shared/indexPlan';
import { compactJson, orderDocument } from '../../shared/json';
import { parseQuerySpec } from '../../shared/queryRun';
import { DocObject, fromJson, isPlainObject } from '../../shared/values';
import { parseValidator } from '../../shared/validator';
import { hashPassword } from '../auth';
import { createUniqueIndexEntries, newDocumentId, newId } from '../collectionStore';
import { config } from '../config';
import { withTransaction } from '../db';
import { body, handler } from '../httpUtil';
import { gradingKeyGuard } from './publicRoutes';

export const gradingRoutes = Router();

const COLLECTION_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function readText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw invalidField(field);
  return value;
}

function readIndexKeys(value: unknown): IndexDefinition['keys'] {
  const keys = fromJson(value);
  if (!isPlainObject(keys) || Object.keys(keys).length === 0) throw invalidField('keys');
  return Object.keys(keys).map((path) => {
    const direction = keys[path];
    if (direction !== 1 && direction !== -1) throw invalidField('keys');
    return { path, direction };
  });
}

async function seedUser(
  client: PoolClient,
  entry: Record<string, unknown>,
): Promise<{ email: string; id: string }> {
  const email = readText(entry['email'], 'email', 320).trim().toLowerCase();
  const password = readText(entry['password'], 'password', 200);
  const name = readText(entry['name'], 'name', 80);
  const existing = await client.query<{ id: string }>('select id from users where email = $1', [email]);
  if (existing.rows.length > 0) {
    await client.query('update users set name = $2, password_hash = $3, confirmed = true where id = $1', [
      existing.rows[0].id,
      name,
      hashPassword(password),
    ]);
    return { email, id: existing.rows[0].id };
  }
  const id = newId();
  await client.query(
    'insert into users (id, email, name, password_hash, confirmed) values ($1, $2, $3, $4, true)',
    [id, email, name, hashPassword(password)],
  );
  return { email, id };
}

async function userIdForEmail(client: PoolClient, email: string): Promise<string> {
  const row = await client.query<{ id: string }>('select id from users where email = $1', [email.toLowerCase()]);
  if (row.rows.length === 0) throw invalidField('email');
  return row.rows[0].id;
}

/** Creates confirmed users, projects, members, collections, documents, indexes, validators and saved queries. */
gradingRoutes.post(
  '/grading/seed',
  handler(async (req, res) => {
    gradingKeyGuard(req.headers['x-grading-key']);
    const fields = body(req);
    const answer = await withTransaction(async (client) => {
      const users: Record<string, string> = {};
      const rawUsers = fields['users'] ?? [];
      if (!Array.isArray(rawUsers)) throw invalidField('users');
      for (const entry of rawUsers) {
        if (!isPlainObject(fromJson(entry))) throw invalidField('users');
        const seeded = await seedUser(client, entry as Record<string, unknown>);
        users[seeded.email] = seeded.id;
      }

      const projects: Record<string, unknown> = {};
      const rawProjects = fields['projects'] ?? [];
      if (!Array.isArray(rawProjects)) throw invalidField('projects');
      for (const rawProject of rawProjects) {
        const project = rawProject as Record<string, unknown>;
        const projectName = readText(project['name'], 'name', 80);
        const ownerEmail = readText(project['owner'], 'owner', 320).toLowerCase();
        const ownerId = users[ownerEmail] ?? (await userIdForEmail(client, ownerEmail));
        const taken = await client.query('select 1 from projects where owner_id = $1 and name = $2', [
          ownerId,
          projectName,
        ]);
        if (taken.rows.length > 0) throw nameTaken();
        const projectId = newId();
        await client.query('insert into projects (id, name, owner_id) values ($1, $2, $3)', [
          projectId,
          projectName,
          ownerId,
        ]);
        await client.query("insert into memberships (project_id, user_id, role) values ($1, $2, 'owner')", [
          projectId,
          ownerId,
        ]);
        const rawMembers = project['members'] ?? [];
        if (!Array.isArray(rawMembers)) throw invalidField('members');
        for (const rawMember of rawMembers) {
          const member = rawMember as Record<string, unknown>;
          const email = readText(member['email'], 'email', 320).toLowerCase();
          const role = member['role'];
          if (role !== 'editor' && role !== 'reader') throw invalidField('role');
          const memberId = users[email] ?? (await userIdForEmail(client, email));
          await client.query(
            `insert into memberships (project_id, user_id, role) values ($1, $2, $3)
             on conflict (project_id, user_id) do update set role = $3`,
            [projectId, memberId, role],
          );
        }

        const collections: Record<string, unknown> = {};
        const rawCollections = project['collections'] ?? [];
        if (!Array.isArray(rawCollections)) throw invalidField('collections');
        for (const rawCollection of rawCollections) {
          const collection = rawCollection as Record<string, unknown>;
          const collectionName = readText(collection['name'], 'name', 64);
          if (!COLLECTION_NAME.test(collectionName)) throw invalidField('name');
          const existing = await client.query('select 1 from collections where project_id = $1 and name = $2', [
            projectId,
            collectionName,
          ]);
          if (existing.rows.length > 0) throw nameTaken();
          const collectionId = newId();
          const validatorValue = collection['validator'] ?? null;
          parseValidator(fromJson(validatorValue));
          await client.query('insert into collections (id, project_id, name, validator) values ($1, $2, $3, $4)', [
            collectionId,
            projectId,
            collectionName,
            validatorValue === null ? null : JSON.stringify(validatorValue),
          ]);

          const rawDocuments = collection['documents'] ?? [];
          if (!Array.isArray(rawDocuments)) throw invalidField('documents');
          const documentIds: string[] = [];
          let sequence = 0;
          for (const rawDocument of rawDocuments) {
            const value = fromJson(rawDocument);
            if (!isPlainObject(value)) throw invalidField('documents');
            const withId = Object.prototype.hasOwnProperty.call(value, '_id')
              ? orderDocument(value)
              : orderDocument({ ...value, _id: newDocumentId() });
            checkDocumentShape(withId, {
              maxBytes: config.limits.maxDocBytes,
              maxDepth: config.limits.maxDepth,
            });
            const docId = String(withId['_id']);
            const clash = await client.query('select 1 from documents where collection_id = $1 and doc_id = $2', [
              collectionId,
              docId,
            ]);
            if (clash.rows.length > 0) throw duplicateKey('_id_', docId);
            await client.query(
              'insert into documents (collection_id, doc_id, body, version) values ($1, $2, $3, 1)',
              [collectionId, docId, compactJson(withId as DocObject)],
            );
            sequence += 1;
            await client.query(
              "insert into changes (collection_id, seq, op, doc_id, body, version) values ($1, $2, 'insert', $3, $4, 1)",
              [collectionId, sequence, docId, compactJson(withId as DocObject)],
            );
            documentIds.push(docId);
          }
          await client.query('update collections set sequence = $2 where id = $1', [collectionId, sequence]);

          const rawIndexes = collection['indexes'] ?? [];
          if (!Array.isArray(rawIndexes)) throw invalidField('indexes');
          for (const rawIndex of rawIndexes) {
            const index = rawIndex as Record<string, unknown>;
            const keys = readIndexKeys(index['keys']);
            const unique = index['unique'] === true;
            const name = typeof index['name'] === 'string' && index['name'].length > 0
              ? index['name']
              : defaultIndexName(keys);
            const indexId = newId();
            const indexTaken = await client.query(
              'select 1 from collection_indexes where collection_id = $1 and name = $2',
              [collectionId, name],
            );
            if (indexTaken.rows.length > 0 || name === '_id_') throw nameTaken();
            await client.query(
              'insert into collection_indexes (id, collection_id, name, keys, unique_index) values ($1, $2, $3, $4, $5)',
              [indexId, collectionId, name, JSON.stringify(keys), unique],
            );
            if (unique) await createUniqueIndexEntries(client, collectionId, indexId, name, keys);
          }

          const rawQueries = collection['saved_queries'] ?? [];
          if (!Array.isArray(rawQueries)) throw invalidField('saved_queries');
          const savedQueries: Record<string, string> = {};
          for (const rawQuery of rawQueries) {
            const saved = rawQuery as Record<string, unknown>;
            const name = readText(saved['name'], 'name', 80);
            const spec = parseQuerySpec({ ...saved, page: 1 });
            const savedId = newId();
            await client.query(
              `insert into saved_queries (id, collection_id, name, filter, projection, sort, limit_value)
               values ($1, $2, $3, $4, $5, $6, $7)`,
              [
                savedId,
                collectionId,
                name,
                JSON.stringify(saved['filter'] ?? {}),
                saved['projection'] === undefined || saved['projection'] === null
                  ? null
                  : JSON.stringify(saved['projection']),
                saved['sort'] === undefined || saved['sort'] === null ? null : JSON.stringify(saved['sort']),
                spec.limit,
              ],
            );
            savedQueries[name] = savedId;
          }

          collections[collectionName] = {
            id: collectionId,
            documents: documentIds,
            saved_queries: savedQueries,
          };
        }
        projects[projectName] = { id: projectId, collections };
      }
      return { users, projects };
    });
    res.status(201).json(answer);
  }),
);
