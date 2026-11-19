import { bodyLimits, config } from '../config.js';
import { newId, pool } from '../db.js';
import { apiErrors } from '../errors.js';
import type { Router } from '../http.js';
import { setLiveOutage } from '../live.js';
import { setSearchOutage } from '../search.js';
import { StorageDown, fileKey, putObject, sha256Hex, setStorageOutage } from '../storage.js';
import { createSnapshot, snapshotStatus } from '../snapshots.js';
import {
  appendVersion,
  createRecipe,
  createSession,
  createUser,
  type VersionDraft,
} from '../store.js';
import { validateSteps, type FieldErrors } from '../../shared/recipe.js';
import { parseTtl } from '../../shared/format.js';

interface SeedUser {
  key: string;
  email: string;
  password: string;
  displayName: string;
}

function list(body: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = body[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function stringOf(entry: Record<string, unknown>, key: string): string {
  const value = entry[key];
  if (typeof value !== 'string') throw apiErrors.validation({ [key]: `${key} is required.` });
  return value;
}

export function registerGradingRoutes(router: Router): void {
  router.add(
    'POST',
    '/api/grading/seed',
    async (ctx) => {
      const body = await ctx.readJson(bodyLimits.gradingSeed);
      const users: Record<string, { id: string; session: string }> = {};
      const teams: Record<string, { id: string }> = {};
      const recipes: Record<string, { id: string; latestVersion: number }> = {};
      const files: Record<string, { id: string }> = {};
      const snapshots: Record<string, { token: string; status: string; expiresAt: string }> = {};
      const userIdByKey = new Map<string, string>();

      for (const entry of list(body, 'users')) {
        const seed: SeedUser = {
          key: stringOf(entry, 'key'),
          email: stringOf(entry, 'email'),
          password: stringOf(entry, 'password'),
          displayName: stringOf(entry, 'displayName'),
        };
        const user = await createUser(seed.email, seed.displayName, seed.password, true);
        const session = await createSession(user.id);
        users[seed.key] = { id: user.id, session };
        userIdByKey.set(seed.key, user.id);
      }

      for (const entry of list(body, 'teams')) {
        const key = stringOf(entry, 'key');
        const ownerId = userIdByKey.get(stringOf(entry, 'owner'));
        if (ownerId === undefined) throw apiErrors.validation({ owner: 'Unknown user key.' });
        const id = newId('t');
        await pool.query('insert into teams (id, name, owner_id) values ($1, $2, $3)', [
          id,
          stringOf(entry, 'name'),
          ownerId,
        ]);
        await pool.query("insert into team_members (team_id, user_id, role) values ($1, $2, 'owner')", [id, ownerId]);
        const members = Array.isArray(entry['members']) ? (entry['members'] as string[]) : [];
        for (const memberKey of members) {
          const memberId = userIdByKey.get(memberKey);
          if (memberId === undefined) throw apiErrors.validation({ members: 'Unknown user key.' });
          await pool.query(
            "insert into team_members (team_id, user_id, role) values ($1, $2, 'member') on conflict do nothing",
            [id, memberId],
          );
        }
        teams[key] = { id };
      }

      for (const entry of list(body, 'recipes')) {
        const key = stringOf(entry, 'key');
        const ownerSpec = entry['owner'] as Record<string, unknown> | undefined;
        const userKey = ownerSpec?.['user'];
        const teamKey = ownerSpec?.['team'];
        const owner =
          typeof userKey === 'string'
            ? { type: 'user' as const, id: userIdByKey.get(userKey) }
            : { type: 'team' as const, id: typeof teamKey === 'string' ? teams[teamKey]?.id : undefined };
        if (owner.id === undefined) throw apiErrors.validation({ owner: 'Unknown owner key.' });
        const tags = Array.isArray(entry['tags']) ? (entry['tags'] as string[]) : [];
        const versions = Array.isArray(entry['versions']) ? (entry['versions'] as Record<string, unknown>[]) : [];
        let recipeId = '';
        let latest = 0;
        for (const version of versions) {
          const authorId = userIdByKey.get(stringOf(version, 'author'));
          if (authorId === undefined) throw apiErrors.validation({ author: 'Unknown user key.' });
          const fields: FieldErrors = {};
          const draft: VersionDraft = {
            name: stringOf(version, 'name'),
            note: typeof version['note'] === 'string' ? version['note'] : '',
            tags,
            steps: validateSteps(version['steps'], fields),
          };
          if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);
          if (latest === 0) {
            const outcome = await createRecipe({ type: owner.type, id: owner.id }, draft, authorId);
            recipeId = outcome.summary.id;
            latest = 1;
          } else {
            const outcome = await appendVersion(recipeId, latest, draft, authorId);
            latest = outcome.version.n;
          }
        }
        recipes[key] = { id: recipeId, latestVersion: latest };
      }

      for (const entry of list(body, 'files')) {
        const key = stringOf(entry, 'key');
        const ownerId = userIdByKey.get(stringOf(entry, 'owner'));
        if (ownerId === undefined) throw apiErrors.validation({ owner: 'Unknown user key.' });
        const bytes = new Uint8Array(Buffer.from(stringOf(entry, 'base64'), 'base64'));
        const id = newId('f');
        await pool.query('insert into files (id, owner_id, name, bytes, sha256) values ($1,$2,$3,$4,$5)', [
          id,
          ownerId,
          stringOf(entry, 'name'),
          bytes.length,
          sha256Hex(bytes),
        ]);
        try {
          await putObject(fileKey(id), bytes);
        } catch (cause) {
          if (!(cause instanceof StorageDown)) throw cause;
        }
        files[key] = { id };
      }

      for (const entry of list(body, 'snapshots')) {
        const key = stringOf(entry, 'key');
        const ownerId = userIdByKey.get(stringOf(entry, 'owner'));
        if (ownerId === undefined) throw apiErrors.validation({ owner: 'Unknown user key.' });
        const ttl = parseTtl(stringOf(entry, 'ttl'));
        if (ttl === null || !config.limits.shareTtlChoices.some((choice) => choice.code === ttl.code)) {
          throw apiErrors.validation({ ttl: 'Choose one of the offered expiry times.' });
        }
        const recipeKey = entry['recipe'];
        const recipeId = typeof recipeKey === 'string' ? recipes[recipeKey]?.id ?? null : null;
        const version = typeof entry['version'] === 'number' ? entry['version'] : null;
        let steps: unknown = [];
        let recipeName = 'Unsaved recipe';
        if (recipeId !== null) {
          const loaded = await pool.query<{ name: string; steps: unknown }>(
            'select name, steps from recipe_versions where recipe_id = $1 and n = coalesce($2, (select latest_version from recipes where id = $1))',
            [recipeId, version],
          );
          const row = loaded.rows[0];
          if (row !== undefined) {
            steps = row.steps;
            recipeName = row.name;
          }
        }
        const fileKeyName = entry['fileKey'];
        let input: Uint8Array;
        if (typeof fileKeyName === 'string') {
          const source = list(body, 'files').find((file) => file['key'] === fileKeyName);
          if (source === undefined) throw apiErrors.validation({ fileKey: 'Unknown file key.' });
          input = new Uint8Array(Buffer.from(stringOf(source, 'base64'), 'base64'));
        } else {
          input = new Uint8Array(Buffer.from(stringOf(entry, 'inputBase64'), 'base64'));
        }
        const output = new Uint8Array(Buffer.from(stringOf(entry, 'outputBase64'), 'base64'));
        const createdAt =
          typeof entry['createdAt'] === 'string' ? new Date(entry['createdAt']) : new Date();
        const fields: FieldErrors = {};
        const row = await createSnapshot({
          ownerId,
          recipeName,
          recipeId,
          recipeVersion: version,
          steps: validateSteps(steps, fields),
          input,
          output,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + ttl.seconds * 1000),
        });
        snapshots[key] = {
          token: row.token,
          status: snapshotStatus(row),
          expiresAt: row.expires_at.toISOString(),
        };
      }

      ctx.json(201, { users, teams, recipes, files, snapshots });
    },
    true,
  );

  router.add(
    'POST',
    '/api/grading/outage',
    async (ctx) => {
      const body = await ctx.readJson(bodyLimits.json);
      const service = body['service'];
      const down = body['down'] === true;
      if (service === 'minio') setStorageOutage(down);
      else if (service === 'meilisearch') setSearchOutage(down);
      else if (service === 'live') setLiveOutage(down);
      else throw apiErrors.validation({ service: 'Choose minio, meilisearch or live.' });
      ctx.json(200, { service, down });
    },
    true,
  );
}
