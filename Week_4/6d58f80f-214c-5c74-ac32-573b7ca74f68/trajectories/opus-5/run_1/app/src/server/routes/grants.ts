import { authed, requireFound, type Ctx, type Route } from '../http/api.js';
import {
  conflict,
  directoryUnavailable,
  forbidden,
  notFound,
  validation,
} from '../http/errors.js';
import { daysBetween, isValidDate, today } from '../domain/clock.js';
import { GRANTS_STAFF_ONLY, dateRangeError } from '../../shared/copy.js';
import {
  activeGrantsOn,
  createGrant,
  defaultEndDate,
  grantById,
  grantDateRange,
  patchGrant,
  removeGrant,
} from '../domain/grants.js';
import { grantIsLive } from '../domain/access.js';
import { serializeFile, serializeFolder, serializeGrant } from '../domain/serialize.js';
import { directoryUp } from '../services/directory.js';
import { knownPerson, lookupPerson } from '../domain/people.js';
import {
  publishAccessChanged,
  publishGrantsChanged,
  pushNotice,
} from '../events.js';
import { fileOr404, folderOr404, requireStaff } from './helpers.js';
import type { AuthedCtx } from '../http/api.js';
import type { Role } from '../../shared/types.js';

const knownName = async (id: string): Promise<string> =>
  (await knownPerson(id))?.name ?? '';

interface Target {
  itemType: 'folder' | 'file';
  itemId: string;
  itemName: string;
  folderId: string | null;
  fileId: string | null;
  projectFolderId: string;
}

const readTarget = async (
  ctx: AuthedCtx,
  itemType: unknown,
  itemId: unknown,
): Promise<Target> => {
  if (typeof itemId !== 'string') throw notFound();
  if (itemType === 'folder') {
    const folder = await folderOr404(ctx, itemId);
    return {
      itemType: 'folder',
      itemId: folder.id,
      itemName: folder.name,
      folderId: folder.id,
      fileId: null,
      projectFolderId: folder.id,
    };
  }
  if (itemType === 'file') {
    const file = await fileOr404(ctx, itemId);
    return {
      itemType: 'file',
      itemId: file.id,
      itemName: file.name,
      folderId: file.folder_id,
      fileId: file.id,
      projectFolderId: file.folder_id,
    };
  }
  throw notFound();
};

const readEndDate = (value: unknown): string => {
  const range = grantDateRange();
  if (!isValidDate(value) || value < range.today || value > range.max) {
    throw validation({ endDate: dateRangeError(range.today, range.max) });
  }
  return value;
};

export const grantRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/grants/defaults',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireStaff(self);
      const range = grantDateRange();
      return {
        status: 200,
        body: {
          today: range.today,
          defaultEndDate: await defaultEndDate(),
          maxEndDate: range.max,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/grants',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const target = await readTarget(
        self,
        ctx.url.searchParams.get('itemType'),
        ctx.url.searchParams.get('itemId'),
      );
      requireStaff(self);
      const context = await ctx.serial();
      const rows = await activeGrantsOn(target.itemType, target.itemId);
      return {
        status: 200,
        body: { grants: rows.map((row) => serializeGrant(context, row, target.itemName)) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/grants',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const target = await readTarget(self, ctx.body.itemType, ctx.body.itemId);
      const view = await ctx.view();
      if (!view.canShareIn(target.projectFolderId)) throw forbidden();
      if (!directoryUp()) throw directoryUnavailable();
      const personId = ctx.body.personId;
      if (typeof personId !== 'string') throw notFound();
      const person = requireFound(await lookupPerson(personId));

      const existing = await activeGrantsOn(target.itemType, target.itemId);
      if (existing.some((grant) => grant.person_id === person.id)) {
        throw conflict('grant_exists');
      }
      if (person.kind !== 'partner') throw validation({ personId: GRANTS_STAFF_ONLY });
      const role = ctx.body.role;
      if (role !== 'viewer' && role !== 'editor') {
        throw validation({ role: 'Choose viewer or editor.' });
      }
      const endDate =
        ctx.body.endDate === undefined || ctx.body.endDate === null
          ? await defaultEndDate()
          : readEndDate(ctx.body.endDate);

      const grant = await createGrant(self.person.id, {
        itemType: target.itemType,
        itemId: target.itemId,
        itemName: target.itemName,
        personId: person.id,
        personName: person.name,
        role,
        endDate,
        folderId: target.folderId,
        fileId: target.fileId,
      });
      await publishGrantsChanged(target.itemType, target.itemId);
      publishAccessChanged(person.id);
      ctx.invalidate();
      const context = await ctx.serial();
      return {
        status: 201,
        body: { grant: serializeGrant(context, grant, target.itemName) },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/grants/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const grant = requireFound(await grantById(self.params.id ?? ''));
      const target = await readTarget(self, grant.item_type, grant.item_id);
      const view = await ctx.view();
      if (!view.canShareIn(target.projectFolderId)) throw forbidden();
      if (!grantIsLive(grant)) throw conflict('grant_ended');
      const role = ctx.body.role;
      if (role !== undefined && role !== 'viewer' && role !== 'editor') {
        throw validation({ role: 'Choose viewer or editor.' });
      }
      const endDate =
        ctx.body.endDate === undefined ? undefined : readEndDate(ctx.body.endDate);
      const person = await knownName(grant.person_id);
      const updated = await patchGrant(
        self.person.id,
        grant,
        { role: role as Role | undefined, endDate },
        {
          itemName: target.itemName,
          folderId: target.folderId,
          fileId: target.fileId,
          personName: person,
        },
      );
      await publishGrantsChanged(target.itemType, target.itemId);
      publishAccessChanged(grant.person_id);
      if (grant.role === 'editor' && updated.role === 'viewer') {
        pushNotice(grant.person_id, 'lowered', target.itemName);
      }
      const context = await ctx.serial();
      return { status: 200, body: { grant: serializeGrant(context, updated, target.itemName) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/grants/:id',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const grant = requireFound(await grantById(self.params.id ?? ''));
      const target = await readTarget(self, grant.item_type, grant.item_id);
      const view = await ctx.view();
      if (!view.canShareIn(target.projectFolderId)) throw forbidden();
      if (!grantIsLive(grant)) throw conflict('grant_ended');
      await removeGrant(self.person.id, grant, {
        itemName: target.itemName,
        folderId: target.folderId,
        fileId: target.fileId,
        personName: await knownName(grant.person_id),
      });
      await publishGrantsChanged(target.itemType, target.itemId);
      publishAccessChanged(grant.person_id);
      pushNotice(grant.person_id, 'removed', target.itemName);
      return { status: 204 };
    },
  },
  {
    method: 'GET',
    pattern: '/api/shared',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      if (self.person.kind !== 'partner') throw forbidden();
      const view = await ctx.view();
      const context = await ctx.serial();
      const now = today();
      const items = [];
      for (const grant of view.directGrants()) {
        if (grant.item_type === 'folder') {
          const folder = view.folder(grant.item_id);
          if (folder === null) continue;
          items.push({
            itemType: 'folder' as const,
            folder: serializeFolder(context, folder),
            file: null,
            role: grant.role,
            endDate: grant.end_date,
            daysLeft: daysBetween(now, grant.end_date),
          });
        } else {
          const file = await fileOr404(self, grant.item_id).catch(() => null);
          if (file === null) continue;
          items.push({
            itemType: 'file' as const,
            folder: null,
            file: serializeFile(context, file),
            role: grant.role,
            endDate: grant.end_date,
            daysLeft: daysBetween(now, grant.end_date),
          });
        }
      }
      return { status: 200, body: { items } };
    },
  },
];
