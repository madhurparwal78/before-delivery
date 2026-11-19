import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendAudit } from './audit.js';
import { readClock } from './clock.js';
import { db, setCounter, withTransaction, type Queryable } from './db.js';
import { config } from './config.js';
import { buildCondition } from './domain/conditions.js';
import { errors } from './errors.js';
import { makePng, makeSvg } from './images.js';
import { hashPassword } from './passwords.js';
import { derivativeKey, masterKey, storage, StorageUnavailable } from './storage.js';
import { deadlineHoursFor } from './services/requests.js';
import type {
  ApplicationClass,
  AssetClass,
  AssetState,
  ConditionKind,
  Decision,
  Escalation,
  GrantStatus,
  RequestState,
  Role,
  StageKind,
  Statement,
  VersionState,
} from '../shared/types.js';
import type { WithdrawnEntry } from './domain/records.js';

export interface SeedOrganisation {
  key: string;
  name: string;
  kind: 'brand' | 'agency' | 'press';
  territory: string;
  engagement?: { startsOn: string; endsOn: string; territories: string[] };
}

export interface SeedPrincipal {
  key: string;
  email: string;
  displayName: string;
  role: Role;
  password: string;
  organisation: string;
}

export interface SeedGroup {
  key: string;
  name: string;
  members: string[];
}

export interface SeedLicence {
  key: string;
  name: string;
  permittedApplications: ApplicationClass[];
  prohibitedApplications: ApplicationClass[];
  audiences: ('employee' | 'agency' | 'press')[];
  territories: string[];
  excludedTerritories: string[];
  defaultDurationDays: number;
  modificationPermitted: boolean;
  attributionRequired: boolean;
}

export interface SeedDerivative {
  fileName: string;
  format: 'png' | 'svg';
  width: number;
  height: number;
}

export interface SeedVariant {
  key: string;
  derivatives: SeedDerivative[];
}

export interface SeedAsset {
  key: string;
  name: string;
  class: AssetClass;
  state: AssetState;
  licence: string;
  successor: string | null;
  derivatives: SeedDerivative[];
  variants: SeedVariant[];
}

export interface SeedStage {
  kind: StageKind;
  assignee: string | null;
  decision: Decision | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface SeedCondition {
  kind: ConditionKind;
  value: string | null;
  addedBy: string | null;
}

export interface SeedRequest {
  key: string;
  requester: string;
  asset: string;
  variant: string | null;
  applicationClass: ApplicationClass;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: string[];
  note: string | null;
  state: RequestState;
  submittedAt: string | null;
  escalation: Escalation;
  conditions: SeedCondition[];
  stages: SeedStage[];
}

export interface SeedGrant {
  key: string;
  holder: { principal?: string; group?: string };
  asset: string;
  variant: string | null;
  request: string | null;
  conditions?: SeedCondition[];
  notBefore: string | null;
  notAfter: string;
  status: GrantStatus;
}

export interface SeedVersion {
  number: number;
  state: VersionState;
  author: string | null;
  publishedAt: string | null;
  intro: string;
  statements: Statement[];
  assets: string[];
  withdrawn: WithdrawnEntry[];
}

export interface SeedChapter {
  slug: string;
  title: string;
  versions: SeedVersion[];
}

export interface SeedAuditEntry {
  occurredAt: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string;
  request: string | null;
  before: Record<string, string | number | boolean | null> | null;
  after: Record<string, string | number | boolean | null> | null;
  outcome: 'success' | 'denied';
}

export interface SeedBody {
  organisations: SeedOrganisation[];
  principals: SeedPrincipal[];
  groups: SeedGroup[];
  licences: SeedLicence[];
  assets: SeedAsset[];
  requests: SeedRequest[];
  grants: SeedGrant[];
  chapters: SeedChapter[];
  audit: SeedAuditEntry[];
}

export interface SeedResponse {
  now: string;
  cookieName: string;
  ids: {
    organisations: Record<string, string>;
    principals: Record<string, string>;
    groups: Record<string, string>;
    licences: Record<string, string>;
    assets: Record<string, string>;
    variants: Record<string, string>;
    derivatives: Record<string, string>;
    requests: Record<string, string>;
    grants: Record<string, string>;
    versions: Record<string, string>;
  };
  sessions: Record<string, string>;
}

const KEY_PATTERN = /^[a-z0-9_-]+$/;

export const DEMO_SEED = JSON.parse(
  readFileSync(fileURLToPath(new URL('./demo-seed.json', import.meta.url)), 'utf8'),
) as SeedBody;

function requireArray(body: Record<string, unknown>, field: string): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) throw errors.seedInvalid(field, 'must be an array');
  return value;
}

function validate(input: unknown): SeedBody {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw errors.seedInvalid('body', 'must be an object');
  }
  const body = input as Record<string, unknown>;
  for (const field of ['organisations', 'principals', 'groups', 'licences', 'assets', 'requests', 'grants', 'chapters', 'audit']) {
    const entries = requireArray(body, field);
    entries.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw errors.seedInvalid(`${field}[${index}]`, 'must be an object');
      }
      const record = entry as Record<string, unknown>;
      if (field === 'chapters') {
        if (typeof record['slug'] !== 'string') throw errors.seedInvalid(`${field}[${index}].slug`, 'must be a string');
        return;
      }
      if (field === 'audit') return;
      const key = record['key'];
      if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
        throw errors.seedInvalid(`${field}[${index}].key`, 'must match ^[a-z0-9_-]+$');
      }
    });
  }
  return body as unknown as SeedBody;
}

function ref(map: Record<string, string>, key: string, path: string): string {
  const value = map[key];
  if (value === undefined) throw errors.seedInvalid(path, `unknown key ${key}`);
  return value;
}

function variantLabel(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FIELD_RGB: [number, number, number] = [0x1f, 0x4e, 0x8c];

function derivativeBytes(derivative: SeedDerivative): Buffer {
  return derivative.format === 'png'
    ? makePng(derivative.width, derivative.height, FIELD_RGB)
    : makeSvg(derivative.width, derivative.height, '#1F4E8C');
}

export async function databaseIsEmpty(): Promise<boolean> {
  const result = await db.query<{ count: number }>('select count(*)::bigint as count from principals');
  return (result.rows[0]?.count ?? 0) === 0;
}

export async function applySeed(input: unknown): Promise<SeedResponse> {
  const body = validate(input);
  if (!(await databaseIsEmpty())) throw errors.seedConflict();

  const now = await readClock();
  const ids: SeedResponse['ids'] = {
    organisations: {},
    principals: {},
    groups: {},
    licences: {},
    assets: {},
    variants: {},
    derivatives: {},
    requests: {},
    grants: {},
    versions: {},
  };
  const sessions: Record<string, string> = {};
  const uploads: { key: string; bytes: Buffer; contentType: string }[] = [];

  await withTransaction(async (tx) => {
    await seedOrganisations(tx, body, ids);
    await seedPrincipals(tx, body, ids, sessions);
    await seedGroups(tx, body, ids);
    await seedLicences(tx, body, ids);
    await seedAssets(tx, body, ids, uploads);
    await seedRequests(tx, body, ids);
    await seedGrants(tx, body, ids);
    await seedChapters(tx, body, ids);
    await seedAudit(tx, body, ids);
  });

  for (const upload of uploads) {
    try {
      await storage.putObject(upload.key, upload.bytes, upload.contentType);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  }

  return { now: now.toISOString(), cookieName: config.sessionCookieName, ids, sessions };
}

async function seedOrganisations(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  for (const [index, organisation] of body.organisations.entries()) {
    const id = `org_${organisation.key}`;
    ids.organisations[organisation.key] = id;
    await tx.query(
      `insert into organisations (id, name, kind, territory, engagement_starts_on, engagement_ends_on, territories, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        organisation.name,
        organisation.kind,
        organisation.territory,
        organisation.engagement?.startsOn ?? null,
        organisation.engagement?.endsOn ?? null,
        organisation.engagement?.territories ?? [],
        index,
      ],
    );
  }
}

async function seedPrincipals(
  tx: Queryable,
  body: SeedBody,
  ids: SeedResponse['ids'],
  sessions: Record<string, string>,
): Promise<void> {
  for (const [index, principal] of body.principals.entries()) {
    const id = `usr_${principal.key}`;
    const organisationId = ids.organisations[principal.organisation];
    if (!organisationId) throw errors.seedInvalid(`principals[${index}].organisation`, 'unknown organisation key');
    ids.principals[principal.key] = id;
    await tx.query(
      `insert into principals (id, email, display_name, role, password_hash, organisation_id, sort)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, principal.email, principal.displayName, principal.role, hashPassword(principal.password), organisationId, index],
    );
    const sessionId = randomBytes(24).toString('hex');
    sessions[principal.key] = sessionId;
    await tx.query('insert into sessions (id, principal_id, created_at) values ($1,$2,now())', [sessionId, id]);
  }
}

async function seedGroups(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  for (const group of body.groups) {
    const id = `grp_${group.key}`;
    ids.groups[group.key] = id;
    await tx.query('insert into groups (id, name) values ($1,$2)', [id, group.name]);
    for (const member of group.members) {
      await tx.query('insert into group_members (group_id, principal_id) values ($1,$2)', [
        id,
        ref(ids.principals, member, `groups.${group.key}.members`),
      ]);
    }
  }
}

async function seedLicences(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  for (const licence of body.licences) {
    const id = `lic_${licence.key}`;
    ids.licences[licence.key] = id;
    await tx.query(
      `insert into licences (id, name, permitted_applications, prohibited_applications, audiences, territories,
         excluded_territories, default_duration_days, modification_permitted, attribution_required)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        licence.name,
        licence.permittedApplications,
        licence.prohibitedApplications,
        licence.audiences,
        licence.territories,
        licence.excludedTerritories,
        licence.defaultDurationDays,
        licence.modificationPermitted,
        licence.attributionRequired,
      ],
    );
  }
}

async function seedAssets(
  tx: Queryable,
  body: SeedBody,
  ids: SeedResponse['ids'],
  uploads: { key: string; bytes: Buffer; contentType: string }[],
): Promise<void> {
  for (const [index, asset] of body.assets.entries()) {
    const id = `ast_${asset.key}`;
    ids.assets[asset.key] = id;
    await tx.query(
      'insert into assets (id, name, class, state, licence_id, successor_id, sort) values ($1,$2,$3,$4,$5,$6,$7)',
      [id, asset.name, asset.class, asset.state, ref(ids.licences, asset.licence, `assets[${index}].licence`), null, index],
    );
  }
  for (const asset of body.assets) {
    if (asset.successor) {
      await tx.query('update assets set successor_id = $1 where id = $2', [
        ref(ids.assets, asset.successor, `assets.${asset.key}.successor`),
        ref(ids.assets, asset.key, `assets.${asset.key}`),
      ]);
    }
  }

  for (const asset of body.assets) {
    const assetId = ids.assets[asset.key]!;
    let counter = 0;
    let sort = 0;
    const writeDerivative = (derivative: SeedDerivative, variantId: string | null, variantKey: string | null): void => {
      counter += 1;
      const derivativeId = `drv_${asset.key}_${counter}`;
      ids.derivatives[`${asset.key}/${derivative.fileName}`] = derivativeId;
      const bytes = derivativeBytes(derivative);
      const objectKey = derivativeKey(assetId, variantKey, derivative.fileName);
      uploads.push({
        key: objectKey,
        bytes,
        contentType: derivative.format === 'png' ? 'image/png' : 'image/svg+xml',
      });
      pending.push({ derivativeId, variantId, derivative, bytes, objectKey, sort: sort++ });
    };
    const pending: {
      derivativeId: string;
      variantId: string | null;
      derivative: SeedDerivative;
      bytes: Buffer;
      objectKey: string;
      sort: number;
    }[] = [];

    for (const derivative of asset.derivatives) writeDerivative(derivative, null, null);
    for (const [variantIndex, variant] of asset.variants.entries()) {
      const variantId = `var_${asset.key}_${variant.key}`;
      ids.variants[`${asset.key}/${variant.key}`] = variantId;
      await tx.query('insert into variants (id, asset_id, key, label, sort) values ($1,$2,$3,$4,$5)', [
        variantId,
        assetId,
        variant.key,
        variantLabel(variant.key),
        variantIndex,
      ]);
      for (const derivative of variant.derivatives) writeDerivative(derivative, variantId, variant.key);
    }

    for (const entry of pending) {
      await tx.query(
        `insert into derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, object_key, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          entry.derivativeId,
          assetId,
          entry.variantId,
          entry.derivative.fileName,
          entry.derivative.format,
          entry.derivative.width,
          entry.derivative.height,
          entry.bytes.length,
          entry.objectKey,
          entry.sort,
        ],
      );
    }

    await setCounter(tx, `derivatives:${assetId}`, counter);

    const master = pending[0];
    if (master) {
      uploads.push({
        key: masterKey(assetId, master.derivative.fileName),
        bytes: master.bytes,
        contentType: master.derivative.format === 'png' ? 'image/png' : 'image/svg+xml',
      });
    }
  }
}

async function seedRequests(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  const now = await readClock(tx);
  let conditionCounter = 0;
  for (const [index, request] of body.requests.entries()) {
    const id = `REQ-${String(index + 1).padStart(4, '0')}`;
    ids.requests[request.key] = id;
    const submittedAt = request.submittedAt ? new Date(request.submittedAt) : null;
    const hours = deadlineHoursFor(request.applicationClass);
    const deadline = submittedAt ? new Date(submittedAt.getTime() + hours * 3_600_000) : null;
    const openStage = request.stages.find((stage) => stage.decision === null);
    const holderId =
      request.state === 'under_review' && openStage?.assignee
        ? ids.principals[openStage.assignee]!
        : ids.principals[request.requester]!;

    await tx.query(
      `insert into requests (id, requester_id, asset_id, variant_id, application_class, territories,
         campaign_starts_on, campaign_ends_on, cited_rules, note, state, holder_id, submitted_at, deadline,
         escalation, submission_seq, created_at, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        id,
        ids.principals[request.requester]!,
        ids.assets[request.asset]!,
        request.variant ? ids.variants[`${request.asset}/${request.variant}`]! : null,
        request.applicationClass,
        request.territories,
        request.campaignStartsOn,
        request.campaignEndsOn,
        request.citedRules,
        request.note,
        request.state,
        holderId,
        submittedAt,
        deadline,
        request.escalation,
        submittedAt ? 1 : 0,
        submittedAt ?? now,
        index + 1,
      ],
    );

    for (const [stageIndex, stage] of request.stages.entries()) {
      await tx.query(
        `insert into request_stages (request_id, n, kind, assignee_id, decision, decided_by, decided_at, comment)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          stageIndex + 1,
          stage.kind,
          stage.assignee ? ids.principals[stage.assignee]! : null,
          stage.decision,
          stage.decision && stage.assignee ? ids.principals[stage.assignee]! : null,
          stage.decidedAt ? new Date(stage.decidedAt) : null,
          stage.comment,
        ],
      );
    }

    for (const condition of request.conditions ?? []) {
      conditionCounter += 1;
      const built = buildCondition(condition.kind, condition.value);
      await tx.query(
        `insert into conditions (id, request_id, grant_id, kind, value, text, added_by, sort)
         values ($1,$2,null,$3,$4,$5,$6,$7)`,
        [
          `CON-${String(conditionCounter).padStart(4, '0')}`,
          id,
          built.kind,
          built.value,
          built.text,
          condition.addedBy ? ids.principals[condition.addedBy]! : null,
          conditionCounter,
        ],
      );
    }

    if (request.state === 'under_review' && submittedAt) {
      const windowMs = hours * 3_600_000;
      const points: [string, Date][] = [
        ['warning', new Date(submittedAt.getTime() + (windowMs * config.deadlineWarningPercent) / 100)],
        ['breach', new Date(submittedAt.getTime() + windowMs)],
        ['ceiling', new Date(submittedAt.getTime() + windowMs * config.expiryCeilingMultiplier)],
      ];
      for (const [kind, dueAt] of points) {
        await tx.query(
          'insert into timers (request_id, kind, submission_seq, due_at, fired_at) values ($1,$2,1,$3,$4)',
          [id, kind, dueAt, dueAt.getTime() <= now.getTime() ? now : null],
        );
      }
    }
  }
  await setCounter(tx, 'requests', body.requests.length);
  await setCounter(tx, 'request_sort', body.requests.length);
  await setCounter(tx, 'conditions', conditionCounter);
  await setCounter(tx, 'condition_sort', conditionCounter);
}

async function seedGrants(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  let conditionCounter =
    (await tx.query<{ value: number }>(`select value from counters where name = 'conditions'`)).rows[0]?.value ?? 0;

  for (const [index, grant] of body.grants.entries()) {
    const id = `GR-${String(index + 1).padStart(4, '0')}`;
    ids.grants[grant.key] = id;
    const requestId = grant.request ? ids.requests[grant.request]! : null;
    await tx.query(
      `insert into grants (id, holder_principal_id, holder_group_id, asset_id, variant_id, request_id,
         not_before, not_after, status, cap, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10)`,
      [
        id,
        grant.holder.principal ? ids.principals[grant.holder.principal]! : null,
        grant.holder.group ? ids.groups[grant.holder.group]! : null,
        ids.assets[grant.asset]!,
        grant.variant ? ids.variants[`${grant.asset}/${grant.variant}`]! : null,
        requestId,
        grant.notBefore,
        grant.notAfter,
        grant.status,
        index + 1,
      ],
    );
    if (requestId) {
      await tx.query('update conditions set grant_id = $1 where request_id = $2', [id, requestId]);
    }
    for (const condition of grant.conditions ?? []) {
      conditionCounter += 1;
      const built = buildCondition(condition.kind, condition.value);
      await tx.query(
        `insert into conditions (id, request_id, grant_id, kind, value, text, added_by, sort)
         values ($1,null,$2,$3,$4,$5,$6,$7)`,
        [
          `CON-${String(conditionCounter).padStart(4, '0')}`,
          id,
          built.kind,
          built.value,
          built.text,
          condition.addedBy ? ids.principals[condition.addedBy]! : null,
          conditionCounter,
        ],
      );
    }
  }
  await setCounter(tx, 'grants', body.grants.length);
  await setCounter(tx, 'grant_sort', body.grants.length);
  await setCounter(tx, 'conditions', conditionCounter);
  await setCounter(tx, 'condition_sort', conditionCounter);
}

async function seedChapters(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  for (const [index, chapter] of body.chapters.entries()) {
    await tx.query('insert into chapters (slug, title, sort) values ($1,$2,$3)', [
      chapter.slug,
      chapter.title,
      index,
    ]);
    for (const version of chapter.versions) {
      const id = `ver_${chapter.slug}_${version.number}`;
      ids.versions[`${chapter.slug}/${version.number}`] = id;
      await tx.query(
        `insert into chapter_versions (id, slug, number, state, author_id, published_at, intro, statements,
           asset_ids, withdrawn, revision)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,1)`,
        [
          id,
          chapter.slug,
          version.number,
          version.state,
          version.author ? ids.principals[version.author]! : null,
          version.publishedAt ? new Date(version.publishedAt) : null,
          version.intro,
          JSON.stringify(version.statements),
          version.assets.map((key) => ids.assets[key]!),
          JSON.stringify(version.withdrawn),
        ],
      );
    }
  }
}

async function seedAudit(tx: Queryable, body: SeedBody, ids: SeedResponse['ids']): Promise<void> {
  for (const entry of body.audit) {
    const actorId = entry.actor === 'system' ? 'system' : ids.principals[entry.actor]!;
    const actorRole =
      entry.actor === 'system'
        ? 'system'
        : ((
            await tx.query<{ role: string }>('select role from principals where id = $1', [actorId])
          ).rows[0]?.role ?? 'system');
    await appendAudit(tx, {
      occurredAt: new Date(entry.occurredAt),
      actorId,
      actorRole,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      requestId: entry.request ? ids.requests[entry.request]! : null,
      before: entry.before,
      after: entry.after,
      outcome: entry.outcome,
    });
  }
}

export async function resetEverything(): Promise<Date> {
  try {
    const keys = await storage.listKeys();
    for (const key of keys) await storage.deleteObject(key);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
  const startAt = new Date(config.appStartAt);
  await withTransaction(async (tx) => {
    await tx.query(
      `truncate audit_log, idempotency, timers, outbox, proofs, conditions, grants, request_stages, requests,
       chapter_versions, chapters, derivatives, variants, assets, licences, group_members, groups, invitations,
       sessions, principals, organisations, counters restart identity cascade`,
    );
    await tx.query('update app_clock set now_at = $1 where id = 1', [startAt]);
  });
  return startAt;
}
