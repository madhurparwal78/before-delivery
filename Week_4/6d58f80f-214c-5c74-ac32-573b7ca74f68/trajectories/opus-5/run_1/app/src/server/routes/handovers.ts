import { authed, requireFound, type Ctx, type Route } from '../http/api.js';
import {
  conflict,
  directoryUnavailable,
  forbidden,
  notFound,
  validation,
} from '../http/errors.js';
import { HANDOVER_DAYS, HANDOVER_PERSON } from '../../shared/copy.js';
import {
  decideHandover,
  handoverById,
  handoverHasLapsed,
  listHandovers,
  offerHandover,
  openHandoverFor,
} from '../domain/handovers.js';
import { serializeHandover } from '../domain/serialize.js';
import { directoryUp } from '../services/directory.js';
import { lookupPerson } from '../domain/people.js';
import { publishFolderUpdated, publishHandovers, pushNotice } from '../events.js';
import { folderOr404, requireStaff } from './helpers.js';

export const handoverRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/handovers',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      requireStaff(self);
      const context = await ctx.serial();
      const rows = await listHandovers();
      const visible = rows.filter(
        (row) =>
          row.from_id === self.person.id ||
          row.to_id === self.person.id ||
          self.person.staffRole === 'controller',
      );
      return { status: 200, body: { handovers: visible.map((row) => serializeHandover(context, row)) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/handovers',
    handler: async (ctx: Ctx) => {
      const self = authed(ctx);
      const folderId = ctx.body.folderId;
      if (typeof folderId !== 'string') throw notFound();
      const folder = await folderOr404(self, folderId);
      const view = await ctx.view();
      if (!view.canShareIn(folder.id)) throw forbidden();
      if (folder.parent_id !== null) {
        throw validation({ folderId: 'Only a project folder can be handed over.' });
      }
      if ((await openHandoverFor(folder.id)) !== null) throw conflict('handover_open');
      if (!directoryUp()) throw directoryUnavailable();
      const toPersonId = ctx.body.toPersonId;
      if (typeof toPersonId !== 'string') throw notFound();
      const recipient = requireFound(await lookupPerson(toPersonId));
      const days = ctx.body.days;
      const fields: Record<string, string> = {};
      if (recipient.kind !== 'staff' || recipient.id === folder.owner_id) {
        fields.toPersonId = HANDOVER_PERSON;
      }
      if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 14) {
        fields.days = HANDOVER_DAYS;
      }
      if (Object.keys(fields).length > 0) throw validation(fields);

      const handover = await offerHandover(self.person.id, {
        folderId: folder.id,
        folderName: folder.name,
        fromId: folder.owner_id ?? self.person.id,
        toId: recipient.id,
        toName: recipient.name,
        days: days as number,
      });
      await publishHandovers();
      const context = await ctx.serial();
      return { status: 201, body: { handover: serializeHandover(context, handover) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/handovers/:id/accept',
    handler: async (ctx: Ctx) => decide(ctx, 'accepted'),
  },
  {
    method: 'POST',
    pattern: '/api/handovers/:id/decline',
    handler: async (ctx: Ctx) => decide(ctx, 'declined'),
  },
];

const decide = async (ctx: Ctx, decision: 'accepted' | 'declined') => {
  const self = authed(ctx);
  const handover = requireFound(await handoverById(self.params.id ?? ''));
  requireStaff(self);
  const canSee =
    handover.from_id === self.person.id ||
    handover.to_id === self.person.id ||
    self.person.staffRole === 'controller';
  if (!canSee) throw notFound();
  if (handover.to_id !== self.person.id) throw forbidden();
  if (handoverHasLapsed(handover)) throw conflict('handover_lapsed');
  if (handover.status !== 'offered') throw conflict(`handover_${handover.status}`);

  const view = await ctx.view();
  const folderName = view.folder(handover.folder_id)?.name ?? '';
  const updated = await decideHandover(self.person.id, handover, decision, {
    folderName,
    actorName: self.person.name,
  });
  await publishHandovers();
  if (decision === 'accepted') await publishFolderUpdated(handover.folder_id);
  pushNotice(
    handover.from_id,
    decision === 'accepted' ? 'handover_accepted' : 'handover_declined',
    self.person.name,
    folderName,
  );
  ctx.invalidate();
  const context = await ctx.serial();
  return { status: 200, body: { handover: serializeHandover(context, updated) } };
};
