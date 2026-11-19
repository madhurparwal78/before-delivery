import { ApiError } from '../../shared/errors.ts';
import type { VersionInfo } from '../../shared/model.ts';
import { COPY, LIMITS, can } from '../../shared/rules.ts';
import { diffSnapshots, visibleSnapshot } from '../../shared/snapshot.ts';
import { requirePrincipal } from '../auth.ts';
import { database, withMapLock } from '../db.ts';
import { Effects, commitGroup } from '../groups.ts';
import { bodyObject, json, route, type Ctx } from '../http.ts';
import { randomId } from '../ids.ts';
import { loadMap, type MapRow } from '../mapStore.ts';
import { roleHolders } from '../members.ts';
import { restoreOps } from '../restore.ts';
import { orUnavailable, STORAGE_DOWN } from '../storage.ts';
import { findVersion, listVersions, readSnapshot, saveVersion } from '../versions.ts';
import { resolveMap, scopeOf } from './maps.ts';

const resolveVersion = async (ctx: Ctx): Promise<void> => {
  await resolveMap(ctx);
  ctx.scope.version = await findVersion(database(), scopeOf(ctx).map.id, ctx.params.vid ?? '');
};

/** The version name a request body asks for, or a 422. */
function requestedName(ctx: Ctx): string {
  const value = bodyObject(ctx).name;
  const name = typeof value === 'string' ? value.trim() : '';
  if (Array.from(name).length < 1 || Array.from(name).length > LIMITS.version_name_chars) {
    throw new ApiError('invalid', 'A version name is 1 to 60 characters.', { fields: { name: 'A version name is 1 to 60 characters.' } });
  }
  return name;
}

route('GET', '/api/maps/:id/versions', {
  stages: { authenticate: requirePrincipal, resolve: resolveMap },
  handle: async (ctx) => json(200, { versions: await listVersions(database(), scopeOf(ctx).map.id) }),
});

route('POST', '/api/maps/:id/versions', {
  body: 'json',
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveMap,
    authorize: (ctx) => {
      if (!can(scopeOf(ctx).role, 'edit')) throw new ApiError('forbidden', 'Only editors and the owner can save versions.');
    },
    validate: (ctx) => void requestedName(ctx),
  },
  handle: async (ctx) => {
    const { map } = scopeOf(ctx);
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const fx = new Effects();
    const version = await orUnavailable(
      () =>
        withMapLock(map.id, async (client) => {
          const fresh = (await loadMap(client, map.id, true)) as MapRow;
          return saveVersion({ mapId: map.id, name: requestedName(ctx), kind: 'named', by: principal.name, doc: fresh.doc, revision: fresh.revision, tx: { client, fx } });
        }),
      COPY.storage_version,
    );
    fx.run();
    return json(201, { version });
  },
});

/** The two versions a diff request names, the earlier one first, or a 422. */
function comparedVersions(ctx: Ctx): [VersionInfo, VersionInfo] {
  const [first, second] = ctx.scope.compared as VersionInfo[];
  if (!first || !second) {
    throw new ApiError('invalid', 'Give the two versions to compare as from and to.', { fields: { from: 'Give the two versions to compare as from and to.' } });
  }
  return first.number <= second.number ? [first, second] : [second, first];
}

// The diff route is registered before the version route so that "diff" is not read as a version id.
route('GET', '/api/maps/:id/versions/diff', {
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      const asked = ['from', 'to'].flatMap((name) => ctx.query.get(name) ?? []);
      ctx.scope.compared = await Promise.all(asked.map((id) => findVersion(database(), scopeOf(ctx).map.id, id)));
    },
    validate: (ctx) => void comparedVersions(ctx),
  },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const [earlier, later] = comparedVersions(ctx);
    const [before, after] = await orUnavailable(() => Promise.all([readSnapshot(map.id, earlier.id), readSnapshot(map.id, later.id)]), STORAGE_DOWN);
    return json(200, diffSnapshots(visibleSnapshot(before, role), visibleSnapshot(after, role)));
  },
});

route('GET', '/api/maps/:id/versions/:vid', {
  stages: { authenticate: requirePrincipal, resolve: resolveVersion },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const version = ctx.scope.version as VersionInfo;
    const snapshot = await orUnavailable(() => readSnapshot(map.id, version.id), STORAGE_DOWN);
    return json(200, { ...visibleSnapshot(snapshot, role), version });
  },
});

route('POST', '/api/maps/:id/versions/:vid/restore', {
  stages: {
    authenticate: requirePrincipal,
    resolve: resolveVersion,
    authorize: (ctx) => {
      if (!can(scopeOf(ctx).role, 'restore')) throw new ApiError('forbidden', 'Only the owner can restore a version.');
    },
  },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const version = ctx.scope.version as VersionInfo;
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const fx = new Effects();
    const restored = await orUnavailable(async () => {
      const snapshot = await readSnapshot(map.id, version.id);
      return withMapLock(map.id, async (client) => {
        const fresh = (await loadMap(client, map.id, true)) as MapRow;
        const committed = await commitGroup({
          client,
          map: fresh,
          principal,
          role,
          groupId: `restore-${randomId(14)}`,
          base: fresh.revision,
          ops: restoreOps(fresh.doc, snapshot),
          origin: 'restore',
          sentence: `${principal.name} restored version ${version.number}`,
          fx,
          roleHolders: await roleHolders(client, fresh),
        });
        const saved = await saveVersion({
          mapId: map.id,
          name: `Restored from version ${version.number}`,
          kind: 'restore',
          by: principal.name,
          doc: committed.doc,
          revision: committed.response.revision,
          tx: { client, fx },
        });
        return { ...committed.response, version: saved };
      });
    }, COPY.storage_restore);
    fx.run();
    return json(200, restored);
  },
});
