import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config';
import { iso, isoOrNull, nowMs } from '../clock';
import { query, tx } from '../db';
import { ApiError, isUuid, validationError } from '../http/errors';
import { closedBody, isEmail } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import { memberByUser, truckById, type TruckRecord } from '../domain/members';
import { visitLog, visitLogPdfLines } from '../domain/visits';
import { linkState } from '../domain/rules';
import { queueInspectorLink } from '../domain/mail';
import { StorageUnavailable, deleteObject, putObject } from '../services/s3';
import { renderTextPdf } from '../services/pdf';
import type { InspectorLinkJson, ServiceCode } from '../../shared/types';

const SERVICE_CODES: ServiceCode[] = [
  'potable_water',
  'grey_water',
  'grease',
  'food_storage',
  'cleaning',
  'restock',
];

async function truckInScope(ctx: RequestContext, truckId: string): Promise<TruckRecord> {
  const user = ctx.requireUser();
  if (!isUuid(truckId)) throw new ApiError('not_found');
  const truck = await truckById(truckId);
  if (truck === null || truck.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  if (user.role === 'member') {
    const member = await memberByUser(user.user_id);
    if (member === null || truck.member_id !== member.id) throw new ApiError('not_found');
  }
  if (user.role === 'kitchen_manager' && truck.site_id !== user.site_id) {
    throw new ApiError('not_found');
  }
  return truck;
}

export async function getVisits(ctx: RequestContext): Promise<HandlerResult> {
  const truck = await truckInScope(ctx, ctx.params.truck_id as string);
  const log = await visitLog(truck.id, nowMs());
  return {
    status: 200,
    body: {
      truck: {
        id: truck.id,
        name: truck.name,
        permit_number: truck.permit_number,
        member_id: truck.member_id,
        business_name: truck.business_name,
      },
      visits: log.visits,
      last_departed_at: isoOrNull(log.lastDepartedAtMs),
      overdue: log.overdue,
    },
  };
}

export async function postVisit(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const truck = await truckInScope(ctx, ctx.params.truck_id as string);
  ctx.audit.targetType = 'truck';
  ctx.audit.targetId = truck.id;
  closedBody(ctx.json(), []);
  const open = await query<{ id: string }>(
    'select id from visits where truck_id = $1 and departed_at is null',
    [truck.id],
  );
  if (open.length > 0) throw new ApiError('visit_open');
  const visitId = randomUUID();
  const arrivedAt = nowMs();
  try {
    await query(
      `insert into visits (id, tenant_id, truck_id, site_id, arrived_at, services,
         operator_signature, manager_user_id, manager_name, created_at)
       values ($1,$2,$3,$4,$5,'{}','',$6,$7,$5)`,
      [visitId, truck.tenant_id, truck.id, truck.site_id, iso(arrivedAt), user.user_id, user.name],
    );
  } catch {
    throw new ApiError('visit_open');
  }
  ctx.audit.targetType = 'visit';
  ctx.audit.targetId = visitId;
  const log = await visitLog(truck.id, nowMs());
  const visit = log.visits.find((candidate) => candidate.id === visitId);
  if (visit === undefined) throw new ApiError('internal');
  return { status: 201, body: { visit } };
}

export async function postDepart(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const visitId = ctx.params.id as string;
  ctx.audit.targetType = 'visit';
  ctx.audit.targetId = isUuid(visitId) ? visitId : null;
  if (!isUuid(visitId)) throw new ApiError('not_found');
  const body = ctx.json();
  const rows = await query<{ id: string; truck_id: string; site_id: string; departed_at: Date | null; tenant_id: string }>(
    'select id, truck_id, site_id, departed_at, tenant_id from visits where id = $1',
    [visitId],
  );
  const visitRow = rows[0];
  if (visitRow === undefined || visitRow.site_id !== user.site_id) throw new ApiError('not_found');
  if (visitRow.departed_at !== null) throw new ApiError('invalid_transition');
  closedBody(body, ['services', 'operator_signature']);
  const rawServices = body.services;
  const services = Array.isArray(rawServices) ? rawServices : null;
  if (
    services === null ||
    services.length === 0 ||
    !services.every(
      (service): service is ServiceCode =>
        typeof service === 'string' && SERVICE_CODES.includes(service as ServiceCode),
    ) ||
    new Set(services).size !== services.length
  ) {
    throw validationError({ services: 'Choose at least one service.' });
  }
  const rawSignature = body.operator_signature;
  const signature = typeof rawSignature === 'string' ? rawSignature.trim() : '';
  if (signature.length < 2 || signature.length > 80) {
    throw validationError({ operator_signature: "Type the operator's name to sign." });
  }
  const departedAt = nowMs();
  await tx(async (client) => {
    const current = await client.query<{ departed_at: Date | null }>(
      'select departed_at from visits where id = $1 for update',
      [visitId],
    );
    if ((current.rows[0] as { departed_at: Date | null }).departed_at !== null) {
      throw new ApiError('invalid_transition');
    }
    await client.query(
      `update visits set departed_at = $2, services = $3, operator_signature = $4,
         manager_user_id = $5, manager_name = $6 where id = $1`,
      [visitId, iso(departedAt), services, signature, user.user_id, user.name],
    );
  });
  const log = await visitLog(visitRow.truck_id, nowMs());
  const visit = log.visits.find((candidate) => candidate.id === visitId);
  if (visit === undefined) throw new ApiError('internal');
  return { status: 200, body: { visit } };
}

interface LinkRow {
  id: string;
  truck_id: string;
  inspector_email: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  storage_key: string;
  tenant_id: string;
  site_id: string;
}

function linkJson(row: LinkRow, origin: string, atMs: number): InspectorLinkJson {
  return {
    id: row.id,
    truck_id: row.truck_id,
    inspector_email: row.inspector_email,
    url: `${origin}/inspect/${row.token}`,
    expires_at: iso(row.expires_at),
    revoked_at: isoOrNull(row.revoked_at),
    created_at: iso(row.created_at),
    state: linkState(
      row.expires_at.getTime(),
      row.revoked_at === null ? null : row.revoked_at.getTime(),
      atMs,
    ),
  };
}

export async function getInspectorLinks(ctx: RequestContext): Promise<HandlerResult> {
  const truck = await truckInScope(ctx, ctx.params.truck_id as string);
  const rows = await query<LinkRow>(
    `select id, truck_id, inspector_email, token, expires_at, revoked_at, created_at,
            storage_key, tenant_id, site_id
       from inspector_links where truck_id = $1 order by created_at desc, id desc`,
    [truck.id],
  );
  const at = nowMs();
  return {
    status: 200,
    body: { links: rows.map((row) => linkJson(row, ctx.origin, at)) },
  };
}

async function issueLink(
  ctx: RequestContext,
  truck: TruckRecord,
  inspectorEmail: string,
  revokeLinkId: string | null,
): Promise<{ created: LinkRow; replaced: LinkRow | null }> {
  const linkId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const issuedAt = nowMs();
  const expiresAt = issuedAt + config.inspectorLinkTtlSeconds * 1000;
  const log = await visitLog(truck.id, issuedAt);
  const pdf = renderTextPdf(visitLogPdfLines(truck, log));
  const storageKey = `visit-logs/${truck.tenant_id}/${truck.id}/${linkId}.pdf`;
  try {
    await putObject(storageKey, pdf, 'application/pdf', {});
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
    throw error;
  }
  try {
    return await tx(async (client) => {
      let replaced: LinkRow | null = null;
      if (revokeLinkId !== null) {
        const current = await client.query<LinkRow>(
          `select id, truck_id, inspector_email, token, expires_at, revoked_at, created_at,
                  storage_key, tenant_id, site_id
             from inspector_links where id = $1 for update`,
          [revokeLinkId],
        );
        const row = current.rows[0] as LinkRow | undefined;
        if (row === undefined) throw new ApiError('not_found');
        if (
          linkState(
            row.expires_at.getTime(),
            row.revoked_at === null ? null : row.revoked_at.getTime(),
            issuedAt,
          ) !== 'live'
        ) {
          throw new ApiError('invalid_transition');
        }
        await client.query('update inspector_links set revoked_at = $2 where id = $1', [
          revokeLinkId,
          iso(issuedAt),
        ]);
        replaced = { ...row, revoked_at: new Date(issuedAt) };
      }
      await client.query(
        `insert into inspector_links (id, tenant_id, truck_id, site_id, inspector_email, token,
           storage_key, expires_at, revoked_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9)`,
        [
          linkId,
          truck.tenant_id,
          truck.id,
          truck.site_id,
          inspectorEmail,
          token,
          storageKey,
          iso(expiresAt),
          iso(issuedAt),
        ],
      );
      await queueInspectorLink(client, {
        linkId,
        inspectorEmail,
        truckName: truck.name,
        siteName: truck.site_name,
        timeZone: truck.time_zone,
        url: `${ctx.origin}/inspect/${token}`,
        expiresAtMs: expiresAt,
      });
      const created: LinkRow = {
        id: linkId,
        truck_id: truck.id,
        inspector_email: inspectorEmail,
        token,
        expires_at: new Date(expiresAt),
        revoked_at: null,
        created_at: new Date(issuedAt),
        storage_key: storageKey,
        tenant_id: truck.tenant_id,
        site_id: truck.site_id,
      };
      return { created, replaced };
    });
  } catch (error) {
    await deleteObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function postInspectorLink(ctx: RequestContext): Promise<HandlerResult> {
  const truck = await truckInScope(ctx, ctx.params.truck_id as string);
  ctx.audit.targetType = 'truck';
  ctx.audit.targetId = truck.id;
  const body = ctx.json();
  closedBody(body, ['inspector_email']);
  const rawEmail = body.inspector_email;
  if (typeof rawEmail !== 'string' || !isEmail(rawEmail)) {
    throw validationError({ inspector_email: 'Enter a valid email address.' });
  }
  const outcome = await issueLink(ctx, truck, rawEmail, null);
  ctx.audit.targetType = 'inspector_link';
  ctx.audit.targetId = outcome.created.id;
  return {
    status: 201,
    body: { link: linkJson(outcome.created, ctx.origin, nowMs()) },
  };
}

async function linkInScope(ctx: RequestContext, linkId: string): Promise<LinkRow> {
  const user = ctx.requireUser();
  if (!isUuid(linkId)) throw new ApiError('not_found');
  const rows = await query<LinkRow>(
    `select id, truck_id, inspector_email, token, expires_at, revoked_at, created_at,
            storage_key, tenant_id, site_id
       from inspector_links where id = $1`,
    [linkId],
  );
  const row = rows[0];
  if (row === undefined || row.tenant_id !== user.tenant_id) throw new ApiError('not_found');
  if (row.site_id !== user.site_id) throw new ApiError('not_found');
  return row;
}

export async function postRevokeLink(ctx: RequestContext): Promise<HandlerResult> {
  const row = await linkInScope(ctx, ctx.params.id as string);
  ctx.audit.targetType = 'inspector_link';
  ctx.audit.targetId = row.id;
  closedBody(ctx.json(), []);
  const at = nowMs();
  const revoked = await tx(async (client) => {
    const current = await client.query<LinkRow>(
      `select id, truck_id, inspector_email, token, expires_at, revoked_at, created_at,
              storage_key, tenant_id, site_id
         from inspector_links where id = $1 for update`,
      [row.id],
    );
    const link = current.rows[0] as LinkRow;
    if (
      linkState(
        link.expires_at.getTime(),
        link.revoked_at === null ? null : link.revoked_at.getTime(),
        at,
      ) !== 'live'
    ) {
      throw new ApiError('invalid_transition');
    }
    await client.query('update inspector_links set revoked_at = $2 where id = $1', [
      row.id,
      iso(at),
    ]);
    return { ...link, revoked_at: new Date(at) };
  });
  return { status: 200, body: { link: linkJson(revoked, ctx.origin, nowMs()) } };
}

export async function postReissueLink(ctx: RequestContext): Promise<HandlerResult> {
  const row = await linkInScope(ctx, ctx.params.id as string);
  ctx.audit.targetType = 'inspector_link';
  ctx.audit.targetId = row.id;
  closedBody(ctx.json(), []);
  const truck = await truckById(row.truck_id);
  if (truck === null) throw new ApiError('not_found');
  const at = nowMs();
  if (
    linkState(
      row.expires_at.getTime(),
      row.revoked_at === null ? null : row.revoked_at.getTime(),
      at,
    ) !== 'live'
  ) {
    throw new ApiError('invalid_transition');
  }
  const outcome = await issueLink(ctx, truck, row.inspector_email, row.id);
  ctx.audit.targetId = outcome.created.id;
  return {
    status: 201,
    body: {
      link: linkJson(outcome.created, ctx.origin, nowMs()),
      replaced: linkJson(outcome.replaced as LinkRow, ctx.origin, nowMs()),
    },
  };
}
