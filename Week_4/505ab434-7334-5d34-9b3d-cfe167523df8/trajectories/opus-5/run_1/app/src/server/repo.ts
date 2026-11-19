import { db, type Queryable } from './db.js';
import type {
  AssetRecord,
  ConditionRecord,
  DerivativeRecord,
  GrantRecord,
  LicenceRecord,
  OrganisationRecord,
  PrincipalRecord,
  ProofRecord,
  RequestRecord,
  StageRecord,
  VariantRecord,
  VersionRecord,
  Viewer,
} from './domain/records.js';
import type {
  ApplicationClass,
  AssetClass,
  AssetState,
  Audience,
  ConditionKind,
  Decision,
  Escalation,
  GrantCap,
  GrantStatus,
  ProofStatus,
  RequestState,
  Role,
  StageKind,
  Statement,
  VersionState,
} from '../shared/types.js';
import type { WithdrawnEntry } from './domain/records.js';

/* eslint-disable @typescript-eslint/naming-convention */
interface OrganisationRow {
  id: string;
  name: string;
  kind: string;
  territory: string;
  engagement_starts_on: string | null;
  engagement_ends_on: string | null;
  territories: string[];
}

interface PrincipalRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  organisation_id: string;
}

interface LicenceRow {
  id: string;
  name: string;
  permitted_applications: string[];
  prohibited_applications: string[];
  audiences: string[];
  territories: string[];
  excluded_territories: string[];
  default_duration_days: number;
  modification_permitted: boolean;
  attribution_required: boolean;
}

interface AssetRow {
  id: string;
  name: string;
  class: string;
  state: string;
  licence_id: string;
  successor_id: string | null;
  sort: number;
}

interface VariantRow {
  id: string;
  asset_id: string;
  key: string;
  label: string;
  sort: number;
}

interface DerivativeRow {
  id: string;
  asset_id: string;
  variant_id: string | null;
  file_name: string;
  format: string;
  width: number;
  height: number;
  byte_size: number;
  object_key: string;
  sort: number;
}

interface GrantRow {
  id: string;
  holder_principal_id: string | null;
  holder_group_id: string | null;
  asset_id: string;
  variant_id: string | null;
  request_id: string | null;
  not_before: string | null;
  not_after: string;
  status: string;
  cap: string | null;
  revoked_reason: string | null;
}

interface ConditionRow {
  id: string;
  request_id: string | null;
  grant_id: string | null;
  kind: string;
  value: string | null;
  text: string;
  added_by: string | null;
}

interface StageRow {
  request_id: string;
  n: number;
  kind: string;
  assignee_id: string | null;
  decision: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  comment: string | null;
}

interface RequestRow {
  id: string;
  requester_id: string;
  asset_id: string;
  variant_id: string | null;
  application_class: string;
  territories: string[];
  campaign_starts_on: string;
  campaign_ends_on: string;
  cited_rules: string[];
  note: string | null;
  state: string;
  holder_id: string;
  submitted_at: Date | null;
  deadline: Date | null;
  escalation: string | null;
  submission_seq: number;
}

interface ProofRow {
  id: string;
  grant_id: string;
  file_name: string;
  status: string;
  reason: string | null;
  uploaded_at: Date;
  object_key: string;
  content_type: string;
}

interface VersionRow {
  id: string;
  slug: string;
  number: number;
  state: string;
  author_id: string | null;
  published_at: Date | null;
  intro: string;
  statements: Statement[];
  asset_ids: string[];
  withdrawn: WithdrawnEntry[];
  revision: number;
  review_comment: string | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

const toOrganisation = (row: OrganisationRow): OrganisationRecord => ({
  id: row.id,
  name: row.name,
  kind: row.kind as OrganisationRecord['kind'],
  territory: row.territory,
  engagementStartsOn: row.engagement_starts_on,
  engagementEndsOn: row.engagement_ends_on,
  territories: row.territories,
});

const toPrincipal = (row: PrincipalRow): PrincipalRecord => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  role: row.role as Role,
  organisationId: row.organisation_id,
});

const toLicence = (row: LicenceRow): LicenceRecord => ({
  id: row.id,
  name: row.name,
  permittedApplications: row.permitted_applications as ApplicationClass[],
  prohibitedApplications: row.prohibited_applications as ApplicationClass[],
  audiences: row.audiences as Audience[],
  territories: row.territories,
  excludedTerritories: row.excluded_territories,
  defaultDurationDays: row.default_duration_days,
  modificationPermitted: row.modification_permitted,
  attributionRequired: row.attribution_required,
});

const toAsset = (row: AssetRow): AssetRecord => ({
  id: row.id,
  name: row.name,
  assetClass: row.class as AssetClass,
  state: row.state as AssetState,
  licenceId: row.licence_id,
  successorId: row.successor_id,
  sort: row.sort,
});

const toVariant = (row: VariantRow): VariantRecord => ({
  id: row.id,
  assetId: row.asset_id,
  key: row.key,
  label: row.label,
  sort: row.sort,
});

const toDerivative = (row: DerivativeRow): DerivativeRecord => ({
  id: row.id,
  assetId: row.asset_id,
  variantId: row.variant_id,
  fileName: row.file_name,
  format: row.format as 'png' | 'svg',
  width: row.width,
  height: row.height,
  byteSize: row.byte_size,
  objectKey: row.object_key,
  sort: row.sort,
});

const toGrant = (row: GrantRow): GrantRecord => ({
  id: row.id,
  holderPrincipalId: row.holder_principal_id,
  holderGroupId: row.holder_group_id,
  assetId: row.asset_id,
  variantId: row.variant_id,
  requestId: row.request_id,
  notBefore: row.not_before,
  notAfter: row.not_after,
  status: row.status as GrantStatus,
  cap: row.cap as GrantCap | null,
  revokedReason: row.revoked_reason,
});

const toCondition = (row: ConditionRow): ConditionRecord => ({
  id: row.id,
  requestId: row.request_id,
  grantId: row.grant_id,
  kind: row.kind as ConditionKind,
  value: row.value,
  text: row.text,
  addedBy: row.added_by,
});

const toStage = (row: StageRow): StageRecord => ({
  requestId: row.request_id,
  n: row.n,
  kind: row.kind as StageKind,
  assigneeId: row.assignee_id,
  decision: row.decision as Decision | null,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
  comment: row.comment,
});

const toRequest = (row: RequestRow): RequestRecord => ({
  id: row.id,
  requesterId: row.requester_id,
  assetId: row.asset_id,
  variantId: row.variant_id,
  applicationClass: row.application_class as ApplicationClass,
  territories: row.territories,
  campaignStartsOn: row.campaign_starts_on,
  campaignEndsOn: row.campaign_ends_on,
  citedRules: row.cited_rules,
  note: row.note,
  state: row.state as RequestState,
  holderId: row.holder_id,
  submittedAt: row.submitted_at,
  deadline: row.deadline,
  escalation: row.escalation as Escalation,
  submissionSeq: row.submission_seq,
});

const toProof = (row: ProofRow): ProofRecord => ({
  id: row.id,
  grantId: row.grant_id,
  fileName: row.file_name,
  status: row.status as ProofStatus,
  reason: row.reason,
  uploadedAt: row.uploaded_at,
  objectKey: row.object_key,
  contentType: row.content_type,
});

const toVersion = (row: VersionRow): VersionRecord => ({
  id: row.id,
  slug: row.slug,
  number: row.number,
  state: row.state as VersionState,
  authorId: row.author_id,
  publishedAt: row.published_at,
  intro: row.intro,
  statements: row.statements,
  assetIds: row.asset_ids,
  withdrawn: row.withdrawn,
  revision: row.revision,
  reviewComment: row.review_comment,
});

export const repo = {
  async organisation(id: string, source: Queryable = db): Promise<OrganisationRecord | null> {
    const result = await source.query<OrganisationRow>('select * from organisations where id = $1', [id]);
    return result.rows[0] ? toOrganisation(result.rows[0]) : null;
  },

  async organisations(source: Queryable = db): Promise<OrganisationRecord[]> {
    const result = await source.query<OrganisationRow>('select * from organisations order by sort asc, id asc');
    return result.rows.map(toOrganisation);
  },

  async principal(id: string, source: Queryable = db): Promise<PrincipalRecord | null> {
    const result = await source.query<PrincipalRow>('select * from principals where id = $1', [id]);
    return result.rows[0] ? toPrincipal(result.rows[0]) : null;
  },

  async principalByEmail(email: string, source: Queryable = db): Promise<PrincipalRecord | null> {
    const result = await source.query<PrincipalRow>('select * from principals where lower(email) = lower($1)', [email]);
    return result.rows[0] ? toPrincipal(result.rows[0]) : null;
  },

  async principals(source: Queryable = db): Promise<PrincipalRecord[]> {
    const result = await source.query<PrincipalRow>('select * from principals order by sort asc, id asc');
    return result.rows.map(toPrincipal);
  },

  async principalsByRole(role: Role, source: Queryable = db): Promise<PrincipalRecord[]> {
    const result = await source.query<PrincipalRow>(
      'select * from principals where role = $1 order by display_name asc',
      [role],
    );
    return result.rows.map(toPrincipal);
  },

  async groupIdsFor(principalId: string, source: Queryable = db): Promise<string[]> {
    const result = await source.query<{ group_id: string }>(
      'select group_id from group_members where principal_id = $1',
      [principalId],
    );
    return result.rows.map((row) => row.group_id);
  },

  async groupMembers(groupId: string, source: Queryable = db): Promise<PrincipalRecord[]> {
    const result = await source.query<PrincipalRow>(
      `select p.* from principals p join group_members m on m.principal_id = p.id where m.group_id = $1
       order by p.display_name asc`,
      [groupId],
    );
    return result.rows.map(toPrincipal);
  },

  async group(groupId: string, source: Queryable = db): Promise<{ id: string; name: string } | null> {
    const result = await source.query<{ id: string; name: string }>('select * from groups where id = $1', [groupId]);
    return result.rows[0] ?? null;
  },

  async licences(source: Queryable = db): Promise<LicenceRecord[]> {
    const result = await source.query<LicenceRow>('select * from licences order by id asc');
    return result.rows.map(toLicence);
  },

  async assets(source: Queryable = db): Promise<AssetRecord[]> {
    const result = await source.query<AssetRow>('select * from assets order by sort asc, id asc');
    return result.rows.map(toAsset);
  },

  async asset(id: string, source: Queryable = db): Promise<AssetRecord | null> {
    const result = await source.query<AssetRow>('select * from assets where id = $1', [id]);
    return result.rows[0] ? toAsset(result.rows[0]) : null;
  },

  async variants(source: Queryable = db): Promise<VariantRecord[]> {
    const result = await source.query<VariantRow>('select * from variants order by sort asc, id asc');
    return result.rows.map(toVariant);
  },

  async variant(id: string, source: Queryable = db): Promise<VariantRecord | null> {
    const result = await source.query<VariantRow>('select * from variants where id = $1', [id]);
    return result.rows[0] ? toVariant(result.rows[0]) : null;
  },

  async derivatives(source: Queryable = db): Promise<DerivativeRecord[]> {
    const result = await source.query<DerivativeRow>('select * from derivatives order by sort asc, id asc');
    return result.rows.map(toDerivative);
  },

  async derivative(id: string, source: Queryable = db): Promise<DerivativeRecord | null> {
    const result = await source.query<DerivativeRow>('select * from derivatives where id = $1', [id]);
    return result.rows[0] ? toDerivative(result.rows[0]) : null;
  },

  async derivativesOfAsset(assetId: string, source: Queryable = db): Promise<DerivativeRecord[]> {
    const result = await source.query<DerivativeRow>(
      'select * from derivatives where asset_id = $1 order by sort asc, id asc',
      [assetId],
    );
    return result.rows.map(toDerivative);
  },

  async grants(source: Queryable = db): Promise<GrantRecord[]> {
    const result = await source.query<GrantRow>('select * from grants order by sort asc, id asc');
    return result.rows.map(toGrant);
  },

  async grant(id: string, source: Queryable = db): Promise<GrantRecord | null> {
    const result = await source.query<GrantRow>('select * from grants where id = $1', [id]);
    return result.rows[0] ? toGrant(result.rows[0]) : null;
  },

  async grantsForViewer(viewer: Viewer, source: Queryable = db): Promise<GrantRecord[]> {
    const result = await source.query<GrantRow>(
      `select * from grants where holder_principal_id = $1 or holder_group_id = any($2::text[])
       order by sort asc, id asc`,
      [viewer.principal.id, viewer.groupIds],
    );
    return result.rows.map(toGrant);
  },

  async conditionsOfRequest(requestId: string, source: Queryable = db): Promise<ConditionRecord[]> {
    const result = await source.query<ConditionRow>(
      'select * from conditions where request_id = $1 order by sort asc',
      [requestId],
    );
    return result.rows.map(toCondition);
  },

  async conditionsOfGrant(grantId: string, source: Queryable = db): Promise<ConditionRecord[]> {
    const result = await source.query<ConditionRow>('select * from conditions where grant_id = $1 order by sort asc', [
      grantId,
    ]);
    return result.rows.map(toCondition);
  },

  async request(id: string, source: Queryable = db): Promise<RequestRecord | null> {
    const result = await source.query<RequestRow>('select * from requests where id = $1', [id]);
    return result.rows[0] ? toRequest(result.rows[0]) : null;
  },

  async requestForUpdate(id: string, source: Queryable): Promise<RequestRecord | null> {
    const result = await source.query<RequestRow>('select * from requests where id = $1 for update', [id]);
    return result.rows[0] ? toRequest(result.rows[0]) : null;
  },

  async requestsOf(requesterId: string, source: Queryable = db): Promise<RequestRecord[]> {
    const result = await source.query<RequestRow>(
      'select * from requests where requester_id = $1 order by sort asc',
      [requesterId],
    );
    return result.rows.map(toRequest);
  },

  async allRequests(source: Queryable = db): Promise<RequestRecord[]> {
    const result = await source.query<RequestRow>('select * from requests order by sort asc');
    return result.rows.map(toRequest);
  },

  async stages(requestId: string, source: Queryable = db): Promise<StageRecord[]> {
    const result = await source.query<StageRow>('select * from request_stages where request_id = $1 order by n asc', [
      requestId,
    ]);
    return result.rows.map(toStage);
  },

  async openStages(source: Queryable = db): Promise<(StageRecord & { state: RequestState })[]> {
    const result = await source.query<StageRow & { state: string }>(
      `select s.*, r.state from request_stages s join requests r on r.id = s.request_id
       where s.decision is null and r.state = 'under_review'`,
    );
    return result.rows.map((row) => ({ ...toStage(row), state: row.state as RequestState }));
  },

  async proof(id: string, source: Queryable = db): Promise<ProofRecord | null> {
    const result = await source.query<ProofRow>('select * from proofs where id = $1', [id]);
    return result.rows[0] ? toProof(result.rows[0]) : null;
  },

  async proofsOfGrant(grantId: string, source: Queryable = db): Promise<ProofRecord[]> {
    const result = await source.query<ProofRow>('select * from proofs where grant_id = $1 order by sort asc', [
      grantId,
    ]);
    return result.rows.map(toProof);
  },

  async chapters(source: Queryable = db): Promise<{ slug: string; title: string; sort: number }[]> {
    const result = await source.query<{ slug: string; title: string; sort: number }>(
      'select * from chapters order by sort asc',
    );
    return result.rows;
  },

  async versions(source: Queryable = db): Promise<VersionRecord[]> {
    const result = await source.query<VersionRow>('select * from chapter_versions order by slug asc, number asc');
    return result.rows.map(toVersion);
  },

  async versionsOfChapter(slug: string, source: Queryable = db): Promise<VersionRecord[]> {
    const result = await source.query<VersionRow>(
      'select * from chapter_versions where slug = $1 order by number asc',
      [slug],
    );
    return result.rows.map(toVersion);
  },

  async version(id: string, source: Queryable = db): Promise<VersionRecord | null> {
    const result = await source.query<VersionRow>('select * from chapter_versions where id = $1', [id]);
    return result.rows[0] ? toVersion(result.rows[0]) : null;
  },

  async publishedVersion(slug: string, source: Queryable = db): Promise<VersionRecord | null> {
    const result = await source.query<VersionRow>(
      `select * from chapter_versions where slug = $1 and state = 'published' order by number desc limit 1`,
      [slug],
    );
    return result.rows[0] ? toVersion(result.rows[0]) : null;
  },

  async publishedVersions(source: Queryable = db): Promise<VersionRecord[]> {
    const result = await source.query<VersionRow>(
      `select v.* from chapter_versions v join chapters c on c.slug = v.slug
       where v.state = 'published' order by c.sort asc`,
    );
    return result.rows.map(toVersion);
  },

  async viewer(principal: PrincipalRecord, source: Queryable = db): Promise<Viewer> {
    const organisation = await this.organisation(principal.organisationId, source);
    if (!organisation) throw new Error(`Organisation ${principal.organisationId} is missing`);
    const groupIds = await this.groupIdsFor(principal.id, source);
    return { principal, organisation, groupIds };
  },
};
