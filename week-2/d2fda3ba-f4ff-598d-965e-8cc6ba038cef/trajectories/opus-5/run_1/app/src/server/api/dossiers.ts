import { publishAllowed } from '../../shared/addons';
import { computeBoundary, type CandidateNote } from '../../shared/boundary';
import { nextDossierState } from '../../shared/lifecycle';
import { validateCandidateNotes, validateRadius, validateSlug, type FieldErrors } from '../../shared/validation';
import { newId, requireCaller, type AccountRow } from '../auth';
import { ApiError, notFound, validationFailed } from '../errors';
import { jsonReply, MANIFEST_BODY_LIMIT, type RequestContext, type Router } from '../http';
import { Publisher } from '../publish';
import { dossierJson, dossierState, previewLinkJson, type DossierRow, type PreviewLinkRow } from '../serialize';
import type { Services } from '../services';
import { requireUuid } from '../vaultAccess';

const DOSSIER_COLUMNS = `id, account_id, slug, root_note_id, state, radius, public_count, severed_count,
  published_at, live_publish_id`;

const PREVIEW_COLUMNS = 'id, dossier_id, state, created_at, expires_at';

export async function newestPreviewLink(services: Services, dossierId: string): Promise<PreviewLinkRow | null> {
  return services.db.one<PreviewLinkRow>(
    `select ${PREVIEW_COLUMNS} from preview_links where dossier_id = $1 order by created_at desc limit 1`,
    [dossierId],
  );
}

async function loadDossier(services: Services, accountId: string, id: string | undefined): Promise<DossierRow> {
  const dossierId = requireUuid(id);
  const row = await services.db.one<DossierRow>(
    `select ${DOSSIER_COLUMNS} from dossiers where id = $1 and account_id = $2`,
    [dossierId, accountId],
  );
  if (!row) throw notFound();
  return row;
}

/** The dossier with its reported state, which drops to draft once a preview link ends. */
async function loadDossierForAction(
  services: Services,
  accountId: string,
  id: string | undefined,
): Promise<{ dossier: DossierRow; link: PreviewLinkRow | null }> {
  const dossier = await loadDossier(services, accountId, id);
  const link = await newestPreviewLink(services, dossier.id);
  return { dossier: { ...dossier, state: dossierState(dossier, link, new Date()) }, link };
}

async function requirePublishEntitlement(services: Services, account: AccountRow): Promise<void> {
  const plans = await services.entitlement.read(account);
  if (!publishAllowed(plans.publish.state)) {
    throw new ApiError(402, 'publish_not_entitled', 'Publishing needs the Publish add-on.');
  }
}

interface ManifestBody {
  radius?: unknown;
  notes?: unknown;
}

/** The radius and candidate notes of a manifest preview, publish or preview link request. */
function readManifestBody(ctx: RequestContext, rootNoteId: string): { radius: number; notes: CandidateNote[] } {
  const body = (ctx.body ?? {}) as ManifestBody;
  const fields: FieldErrors = {};
  const radius = validateRadius(body.radius);
  if (radius) fields.radius = radius;
  const notes = validateCandidateNotes(body.notes, rootNoteId);
  if (notes.message) fields.notes = notes.message;
  if (!notes.notes) fields.notes = fields.notes ?? 'must be a list of candidate notes';
  if (Object.keys(fields).length > 0 || !notes.notes) throw validationFailed(fields);
  return { radius: Number(body.radius), notes: notes.notes };
}

export function registerDossierRoutes(router: Router, services: Services): void {
  const { db } = services;
  const publisher = new Publisher(services);

  router.add('POST', '/api/dossiers', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    await requirePublishEntitlement(services, caller.account);

    const body = (ctx.body ?? {}) as { slug?: unknown; root_note_id?: unknown };
    if (typeof body.slug === 'string') {
      const taken = await db.one<{ id: string }>('select id from dossiers where slug = $1', [body.slug]);
      if (taken) throw new ApiError(409, 'slug_taken', 'That dossier address is already taken.');
    }

    const fields: FieldErrors = {};
    const slug = validateSlug(body.slug);
    if (slug) fields.slug = slug;
    if (typeof body.root_note_id !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(body.root_note_id)) {
      fields.root_note_id = 'must be a note id';
    }
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const row = await db.one<DossierRow>(
      `insert into dossiers (id, account_id, slug, root_note_id, state) values ($1, $2, $3, $4, 'draft')
         returning ${DOSSIER_COLUMNS}`,
      [newId(), caller.account.id, String(body.slug), String(body.root_note_id)],
    );
    if (!row) throw new ApiError(500, 'internal_error', 'Could not create the dossier.');
    return jsonReply(201, { dossier: dossierJson(row, null, new Date()) });
  });

  router.add('GET', '/api/dossiers', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const rows = await db.query<DossierRow>(
      `select ${DOSSIER_COLUMNS} from dossiers where account_id = $1 order by created_at`,
      [caller.account.id],
    );
    const now = new Date();
    const dossiers = [];
    for (const row of rows) {
      dossiers.push(dossierJson(row, await newestPreviewLink(services, row.id), now));
    }
    return jsonReply(200, { dossiers });
  });

  router.add('GET', '/api/dossiers/:id', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const dossier = await loadDossier(services, caller.account.id, ctx.params.id);
    return jsonReply(200, {
      dossier: dossierJson(dossier, await newestPreviewLink(services, dossier.id), new Date()),
    });
  });

  router.add(
    'POST',
    '/api/dossiers/:id/manifest-preview',
    async (ctx) => {
      const caller = await requireCaller(db, ctx);
      const dossier = await loadDossier(services, caller.account.id, ctx.params.id);
      const { radius, notes } = readManifestBody(ctx, dossier.root_note_id);
      const boundary = computeBoundary(notes, dossier.root_note_id, radius);
      return jsonReply(200, {
        radius,
        public_count: boundary.publicCount,
        severed_count: boundary.severedCount,
        inside: boundary.inside,
      });
    },
    MANIFEST_BODY_LIMIT,
  );

  router.add(
    'POST',
    '/api/dossiers/:id/publish',
    async (ctx) => {
      const caller = await requireCaller(db, ctx);
      const { dossier } = await loadDossierForAction(services, caller.account.id, ctx.params.id);
      await requirePublishEntitlement(services, caller.account);
      if (!nextDossierState(dossier.state, 'publish')) {
        throw new ApiError(409, 'invalid_transition', 'This dossier cannot be published from its current state.', {
          state: dossier.state,
        });
      }
      const { radius, notes } = readManifestBody(ctx, dossier.root_note_id);
      const updated = await publisher.publish({ dossier, owner: caller.account, notes, radius });
      return jsonReply(200, { dossier: dossierJson(updated, await newestPreviewLink(services, dossier.id), new Date()) });
    },
    MANIFEST_BODY_LIMIT,
  );

  router.add('POST', '/api/dossiers/:id/unpublish', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const { dossier } = await loadDossierForAction(services, caller.account.id, ctx.params.id);
    if (!nextDossierState(dossier.state, 'unpublish')) {
      throw new ApiError(409, 'invalid_transition', 'This dossier cannot be taken down from its current state.', {
        state: dossier.state,
      });
    }
    const updated = await publisher.withdraw(dossier, 'unpublish');
    return jsonReply(200, { dossier: dossierJson(updated, await newestPreviewLink(services, dossier.id), new Date()) });
  });

  router.add('POST', '/api/dossiers/:id/reopen', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const { dossier } = await loadDossierForAction(services, caller.account.id, ctx.params.id);
    const target = nextDossierState(dossier.state, 'reopen');
    if (!target) {
      throw new ApiError(409, 'invalid_transition', 'This dossier cannot be reopened from its current state.', {
        state: dossier.state,
      });
    }
    const row = await db.one<DossierRow>(
      `update dossiers set state = $2 where id = $1 returning ${DOSSIER_COLUMNS}`,
      [dossier.id, target],
    );
    if (!row) throw notFound();
    return jsonReply(200, { dossier: dossierJson(row, await newestPreviewLink(services, dossier.id), new Date()) });
  });

  router.add(
    'POST',
    '/api/dossiers/:id/preview-links',
    async (ctx) => {
      const caller = await requireCaller(db, ctx);
      const { dossier } = await loadDossierForAction(services, caller.account.id, ctx.params.id);
      await requirePublishEntitlement(services, caller.account);
      if (!nextDossierState(dossier.state, 'create_preview_link')) {
        throw new ApiError(409, 'invalid_transition', 'This dossier cannot take a preview link in its current state.', {
          state: dossier.state,
        });
      }
      const { radius, notes } = readManifestBody(ctx, dossier.root_note_id);
      const created = await publisher.createPreviewLink({ dossier, owner: caller.account, notes, radius });
      return jsonReply(201, {
        preview_link: previewLinkJson(created.link, new Date()),
        url: `/p/${created.token}/`,
      });
    },
    MANIFEST_BODY_LIMIT,
  );

  router.add('GET', '/api/dossiers/:id/preview-links', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const dossier = await loadDossier(services, caller.account.id, ctx.params.id);
    const links = await db.query<PreviewLinkRow>(
      `select ${PREVIEW_COLUMNS} from preview_links where dossier_id = $1 order by created_at desc`,
      [dossier.id],
    );
    const now = new Date();
    return jsonReply(200, { preview_links: links.map((link) => previewLinkJson(link, now)) });
  });

  router.add('DELETE', '/api/dossiers/:id/preview-links/:link_id', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const { dossier } = await loadDossierForAction(services, caller.account.id, ctx.params.id);
    const linkId = requireUuid(ctx.params.link_id);
    const link = await db.one<PreviewLinkRow>(
      `select ${PREVIEW_COLUMNS} from preview_links where id = $1 and dossier_id = $2`,
      [linkId, dossier.id],
    );
    if (!link) throw notFound();

    const revoked = await publisher.revokePreviewLink(dossier, link);
    return jsonReply(200, { preview_link: previewLinkJson(revoked, new Date()) });
  });
}
