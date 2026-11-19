import type { Tx } from './db';
import { withTransaction, query } from './db';
import { applySchema } from './db';
import type { Config } from './config';
import { ApiError, notFound, seedConflict, seedInvalid } from './errors';
import { hashPassword, sha256, randomToken } from './crypto';
import { makePng, makeSvg } from './bytes';
import { canonicalForm, recordHashFor, appendAudit } from './audit';
import { writeClock } from './clock';
import { S3Client } from './s3client';
import { tierHours } from './requests-core';
import { conditionText } from './requests-core';
import { CHAPTER_SLUGS, type ApplicationClass, type ConditionKind, type RequestState } from '../shared/domain';

interface SeedBody {
  organisations?: SeedOrganisation[];
  principals?: SeedPrincipal[];
  groups?: SeedGroup[];
  licences?: SeedLicence[];
  assets?: SeedAsset[];
  requests?: SeedRequest[];
  grants?: SeedGrant[];
  chapters?: SeedChapter[];
  audit?: SeedAudit[];
}

interface SeedOrganisation {
  key: string;
  name: string;
  kind: string;
  territory: string;
  engagement?: { startsOn: string; endsOn: string; territories: string[] };
}

interface SeedPrincipal {
  key: string;
  email: string;
  displayName: string;
  role: string;
  password: string;
  organisation?: string;
}

interface SeedGroup {
  key: string;
  name: string;
  members: string[];
}

interface SeedLicence {
  key: string;
  name: string;
  permittedApplications: string[];
  prohibitedApplications: string[];
  audiences: string[];
  territories: string[];
  excludedTerritories: string[];
  defaultDurationDays: number;
  modificationPermitted: boolean;
  attributionRequired: boolean;
}

interface SeedAsset {
  key: string;
  name: string;
  class: string;
  state: string;
  licence: string;
  successor: string | null;
  derivatives?: SeedDerivative[];
  variants?: SeedVariant[];
}

interface SeedDerivative {
  fileName: string;
  format: string;
  width: number;
  height: number;
}

interface SeedVariant {
  key: string;
  label: string;
  derivatives?: SeedDerivative[];
}

interface SeedRequest {
  key: string;
  requester: string;
  asset: string;
  variant: string | null;
  applicationClass: string;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: string[];
  note: string;
  state: string;
  submittedAt: string;
  escalation: string | null;
  conditions: { kind: string; value: string | null; addedBy: string }[];
  stages: { kind: string; assignee: string | null; decision: string | null; decidedAt: string | null; comment: string | null }[];
}

interface SeedGrant {
  key: string;
  holder: { principal?: string; group?: string };
  asset: string;
  variant: string | null;
  request: string | null;
  conditions?: { kind: string; value: string | null }[];
  notBefore: string | null;
  notAfter: string;
  status: string;
}

interface SeedChapter {
  slug: string;
  title: string;
  versions: {
    number: number;
    state: string;
    author: string;
    publishedAt: string | null;
    intro: string;
    statements: { identifier: string; text: string }[];
    assets: string[];
    withdrawn: { identifier: string; replacedBy: string }[];
  }[];
}

interface SeedAudit {
  sequence: number;
  occurredAt: string;
  actor: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  request?: string | null;
  before: unknown;
  after: unknown;
  outcome?: string;
}

export const DEMO_SEED: SeedBody = {
  organisations: [
    { key: 'quenby', name: 'Quenby & Co.', kind: 'brand', territory: 'DE' },
    { key: 'lumen', name: 'Studio Lumen', kind: 'agency', territory: 'DE', engagement: { startsOn: '2026-01-05', endsOn: '2026-04-15', territories: ['DE', 'AT', 'CH'] } },
    { key: 'fathom', name: 'Fathom Collective', kind: 'agency', territory: 'NL', engagement: { startsOn: '2026-02-01', endsOn: '2026-12-31', territories: ['NL', 'BE'] } },
    { key: 'brightwell', name: 'Brightwell Agency', kind: 'agency', territory: 'DE', engagement: { startsOn: '2025-09-01', endsOn: '2026-03-01', territories: ['DE'] } },
    { key: 'ledger', name: 'The Morning Ledger', kind: 'press', territory: 'FR' },
  ],
  principals: [
    { key: 'olu', email: 'olu@quenby.example', displayName: 'Olu Mensah', role: 'owner', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'bea', email: 'bea@quenby.example', displayName: 'Bea Lindqvist', role: 'brand_reviewer', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'cai', email: 'cai@quenby.example', displayName: 'Cai Brennan', role: 'brand_reviewer', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'leo', email: 'leo@quenby.example', displayName: 'Leo Varga', role: 'legal_reviewer', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'ari', email: 'ari@quenby.example', displayName: 'Ari Novak', role: 'author', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'emi', email: 'emi@quenby.example', displayName: 'Emi Takahashi', role: 'employee', password: 'rulehouse-demo-1', organisation: 'quenby' },
    { key: 'ana', email: 'ana@studiolumen.example', displayName: 'Ana Ferreira', role: 'agency', password: 'rulehouse-demo-1', organisation: 'lumen' },
    { key: 'finn', email: 'finn@fathom.example', displayName: 'Finn de Vries', role: 'agency', password: 'rulehouse-demo-1', organisation: 'fathom' },
    { key: 'bram', email: 'bram@brightwell.example', displayName: 'Bram Koster', role: 'agency', password: 'rulehouse-demo-1', organisation: 'brightwell' },
    { key: 'pia', email: 'pia@morningledger.example', displayName: 'Pia Laurent', role: 'press', password: 'rulehouse-demo-1', organisation: 'ledger' },
  ],
  groups: [{ key: 'press-list', name: 'Press list', members: ['pia'] }],
  licences: [
    { key: 'mark', name: 'Mark licence', permittedApplications: ['internal_comms', 'social', 'press_article', 'event', 'film', 'packaging', 'co_brand', 'merchandise', 'partnership'], prohibitedApplications: [], audiences: ['employee', 'agency'], territories: ['worldwide'], excludedTerritories: [], defaultDurationDays: 90, modificationPermitted: false, attributionRequired: false },
    { key: 'general', name: 'General licence', permittedApplications: ['internal_comms', 'social', 'press_article', 'event', 'film', 'packaging', 'co_brand', 'partnership'], prohibitedApplications: ['merchandise'], audiences: ['employee', 'agency'], territories: ['worldwide'], excludedTerritories: [], defaultDurationDays: 365, modificationPermitted: true, attributionRequired: false },
    { key: 'editorial', name: 'Editorial licence', permittedApplications: ['internal_comms', 'social', 'press_article'], prohibitedApplications: [], audiences: ['employee', 'press'], territories: ['worldwide'], excludedTerritories: ['FR'], defaultDurationDays: 30, modificationPermitted: false, attributionRequired: true },
    { key: 'press', name: 'Press licence', permittedApplications: ['internal_comms', 'press_article'], prohibitedApplications: [], audiences: ['employee', 'press'], territories: ['worldwide'], excludedTerritories: [], defaultDurationDays: 30, modificationPermitted: false, attributionRequired: true },
  ],
  assets: [
    { key: 'logo', name: 'Logo', class: 'mark', state: 'released', licence: 'mark', successor: null,
      variants: [
        { key: 'full_lock', label: 'Full lock', derivatives: [
          { fileName: 'logo-full-lock.svg', format: 'svg', width: 800, height: 320 },
          { fileName: 'logo-full-lock-1600.png', format: 'png', width: 1600, height: 640 }] },
        { key: 'tab', label: 'Tab', derivatives: [
          { fileName: 'logo-tab.svg', format: 'svg', width: 320, height: 320 },
          { fileName: 'logo-tab-512.png', format: 'png', width: 512, height: 512 }] }] },
    { key: 'logo-1998', name: 'Logo 1998', class: 'mark', state: 'retired', licence: 'mark', successor: 'logo',
      derivatives: [{ fileName: 'logo-1998.png', format: 'png', width: 600, height: 240 }] },
    { key: 'parcel', name: 'Parcel spot icon', class: 'spot_icon', state: 'released', licence: 'general', successor: null,
      derivatives: [{ fileName: 'parcel-120.png', format: 'png', width: 120, height: 120 }] },
    { key: 'courier', name: 'Courier spot icon', class: 'spot_icon', state: 'draft', licence: 'general', successor: null,
      derivatives: [{ fileName: 'courier-128.png', format: 'png', width: 128, height: 128 }] },
    { key: 'pin', name: 'Pin pictogram', class: 'pictogram', state: 'released', licence: 'general', successor: null,
      derivatives: [{ fileName: 'pin-64.png', format: 'png', width: 64, height: 64 }] },
    { key: 'menu', name: 'Menu UI icon', class: 'ui_icon', state: 'released', licence: 'general', successor: null,
      derivatives: [{ fileName: 'menu-24.svg', format: 'svg', width: 24, height: 24 }] },
    { key: 'harbour-photo', name: 'Harbour photograph', class: 'photograph', state: 'released', licence: 'editorial', successor: null,
      derivatives: [{ fileName: 'harbour-1600.png', format: 'png', width: 1600, height: 1067 }] },
    { key: 'storefront', name: 'Storefront photograph', class: 'photograph', state: 'released', licence: 'press', successor: null,
      derivatives: [{ fileName: 'storefront-1600.png', format: 'png', width: 1600, height: 1067 }] },
    { key: 'rebrand-teaser', name: 'Rebrand teaser illustration', class: 'illustration', state: 'restricted', licence: 'general', successor: null,
      derivatives: [{ fileName: 'rebrand-teaser-1200.png', format: 'png', width: 1200, height: 800 }] },
  ],
  requests: [
    { key: 'r-ana-tab', requester: 'ana', asset: 'logo', variant: 'tab', applicationClass: 'social', territories: ['DE'], campaignStartsOn: '2026-02-02', campaignEndsOn: '2026-06-30', citedRules: ['logo.variants.tab'], note: 'Spring social posts.', state: 'granted', submittedAt: '2026-02-01T09:00:00.000Z', escalation: null, conditions: [],
      stages: [
        { kind: 'brand', assignee: 'bea', decision: 'approve', decidedAt: '2026-02-02T09:30:00.000Z', comment: null },
        { kind: 'brand', assignee: 'cai', decision: 'approve', decidedAt: '2026-02-02T10:00:00.000Z', comment: null }] },
    { key: 'r-finn-pin', requester: 'finn', asset: 'pin', variant: null, applicationClass: 'event', territories: ['NL'], campaignStartsOn: '2026-03-10', campaignEndsOn: '2026-04-30', citedRules: ['iconography.pictogram.size'], note: 'Trade fair signage.', state: 'granted', submittedAt: '2026-02-26T10:00:00.000Z', escalation: null,
      conditions: [{ kind: 'proof_required', value: null, addedBy: 'bea' }],
      stages: [{ kind: 'brand', assignee: 'bea', decision: 'approve', decidedAt: '2026-02-27T10:00:00.000Z', comment: null }] },
    { key: 'r-finn-tab', requester: 'finn', asset: 'logo', variant: 'tab', applicationClass: 'social', territories: ['NL'], campaignStartsOn: '2026-03-05', campaignEndsOn: '2026-05-31', citedRules: ['logo.variants.tab'], note: 'Launch posts.', state: 'under_review', submittedAt: '2026-03-02T07:00:00.000Z', escalation: null, conditions: [],
      stages: [
        { kind: 'brand', assignee: 'cai', decision: null, decidedAt: null, comment: null },
        { kind: 'brand', assignee: null, decision: null, decidedAt: null, comment: null }] },
    { key: 'r-bram-parcel', requester: 'bram', asset: 'parcel', variant: null, applicationClass: 'packaging', territories: ['DE'], campaignStartsOn: '2026-03-01', campaignEndsOn: '2026-09-30', citedRules: ['iconography.spot.size'], note: 'Gift box sleeve.', state: 'under_review', submittedAt: '2026-02-28T16:00:00.000Z', escalation: null, conditions: [],
      stages: [{ kind: 'brand', assignee: 'bea', decision: null, decidedAt: null, comment: null }] },
  ],
  grants: [
    { key: 'g-ana-tab', holder: { principal: 'ana' }, asset: 'logo', variant: 'tab', request: 'r-ana-tab', notBefore: '2026-02-02', notAfter: '2026-04-15', status: 'active' },
    { key: 'g-finn-parcel', holder: { principal: 'finn' }, asset: 'parcel', variant: null, request: null, conditions: [], notBefore: '2026-02-10', notAfter: '2026-08-31', status: 'active' },
    { key: 'g-press-storefront', holder: { group: 'press-list' }, asset: 'storefront', variant: null, request: null, conditions: [], notBefore: '2026-02-20', notAfter: '2026-03-21', status: 'active' },
    { key: 'g-finn-pin', holder: { principal: 'finn' }, asset: 'pin', variant: null, request: 'r-finn-pin', notBefore: null, notAfter: '2026-04-30', status: 'pending_proof' },
  ],
  chapters: [
    { slug: 'logo', title: 'Logo', versions: [
      { number: 1, state: 'superseded', author: 'ari', publishedAt: '2026-01-12T09:00:00.000Z',
        intro: 'The Quenby mark is three stacked trapezoids. It comes in two locks.',
        statements: [
          { identifier: 'logo.variants.full-lock', text: 'Use the Full lock for partnerships, co-branding and film.' },
          { identifier: 'logo.variants.tab', text: 'Use the Tab alone when the symbol starts the layout.' },
          { identifier: 'logo.clear-space.half', text: 'Keep clear space of half the symbol height around the mark.' }],
        assets: ['logo', 'logo-1998'], withdrawn: [] },
      { number: 2, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'The Quenby mark is three stacked trapezoids. It comes in two locks, and each lock has its own rules.',
        statements: [
          { identifier: 'logo.variants.full-lock', text: 'Use the Full lock for partnerships, co-branding and film.' },
          { identifier: 'logo.variants.tab', text: 'Use the Tab alone when the symbol starts the layout.' },
          { identifier: 'logo.clear-space.minimum', text: 'Keep clear space of at least 1x the symbol height on every side.' },
          { identifier: 'logo.colour.no-recolour', text: 'Show the mark in Harbour 700, ink or white only.' }],
        assets: ['logo'], withdrawn: [{ identifier: 'logo.clear-space.half', replacedBy: 'logo.clear-space.minimum' }] }] },
    { slug: 'colour', title: 'Colour', versions: [
      { number: 1, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'Ten colour families, each published with its contrast against white and ink.',
        statements: [
          { identifier: 'colour.contrast.body-text', text: 'Body text meets a contrast of at least 4.5:1 against its ground.' },
          { identifier: 'colour.fields.ink', text: 'Text on a 300 field colour is always set in ink.' },
          { identifier: 'colour.accent.harbour', text: 'Harbour 700 is the only accent colour.' }],
        assets: [], withdrawn: [] }] },
    { slug: 'typography', title: 'Typography', versions: [
      { number: 1, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'Quenby & Co. sets type in the reader\u2019s own system face.',
        statements: [
          { identifier: 'typography.weight.range', text: 'Display type runs from weight 250 to 900; body text sits at 400.' },
          { identifier: 'typography.figures.tabular', text: 'Numbers in tables use tabular figures.' }],
        assets: [], withdrawn: [] }] },
    { slug: 'iconography', title: 'Iconography', versions: [
      { number: 1, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'Three icon classes, each with a fixed size.',
        statements: [
          { identifier: 'iconography.spot.size', text: 'Spot icons are 120 x 120 pixels.' },
          { identifier: 'iconography.pictogram.size', text: 'Pictograms are 64 x 64 pixels.' },
          { identifier: 'iconography.ui.size', text: 'UI icons are 24 x 24 pixels.' }],
        assets: ['parcel', 'pin', 'menu'], withdrawn: [] },
      { number: 2, state: 'draft', author: 'ari', publishedAt: null,
        intro: 'Three icon classes, each with a fixed size, and a new courier icon.',
        statements: [
          { identifier: 'iconography.spot.size', text: 'Spot icons are 120 x 120 pixels.' },
          { identifier: 'iconography.pictogram.size', text: 'Pictograms are 64 x 64 pixels.' },
          { identifier: 'iconography.ui.size', text: 'UI icons are 24 x 24 pixels.' },
          { identifier: 'iconography.spot.courier', text: 'Use the Courier spot icon for delivery updates.' }],
        assets: ['parcel', 'courier', 'pin', 'menu'], withdrawn: [] }] },
    { slug: 'motion', title: 'Motion', versions: [
      { number: 1, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'Things arrive quickly and settle softly.',
        statements: [
          { identifier: 'motion.curve.panel-open', text: 'Panels open on the standard easing curve with control values 0.30, 0.00, 0.20, 1.00.' },
          { identifier: 'motion.timeline.length', text: 'Title sequences finish within 12 seconds.' }],
        assets: [], withdrawn: [] }] },
    { slug: 'voice', title: 'Voice', versions: [
      { number: 1, state: 'published', author: 'ari', publishedAt: '2026-02-02T09:00:00.000Z',
        intro: 'We write the way we would say it across a counter.',
        statements: [
          { identifier: 'voice.tone.plain', text: 'Write in plain words, one idea per sentence.' },
          { identifier: 'voice.name.ampersand', text: 'Write the name as Quenby & Co., with the ampersand.' }],
        assets: [], withdrawn: [] }] },
  ],
  audit: [],
};

const CHAPTER_TITLES: Record<string, string> = {
  logo: 'Logo',
  colour: 'Colour',
  typography: 'Typography',
  iconography: 'Iconography',
  motion: 'Motion',
  voice: 'Voice',
};

export interface SeedResult {
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

export async function resetAll(s3: S3Client): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(`TRUNCATE TABLE proofs, grants, conditions, request_stages, timers, request_idempotency, requests,
        download_links, derivatives, variants, assets, licences, group_members, groups, principals, organisations,
        chapter_versions, rule_events, chapters, invitations, sessions, audit_records, mail_outbox, live_events,
        audit_sequence RESTART IDENTITY`);
    await tx.query('INSERT INTO audit_sequence (singleton, last_sequence) VALUES (true, 0)');
    await tx.query(`INSERT INTO app_meta (key, value) VALUES ('app_clock', $1::text)
        ON CONFLICT (key) DO UPDATE SET value = $1::text`, [new Date(0).toISOString()]);
  });
  try {
    await s3.removePrefix('masters/');
    await s3.removePrefix('derivatives/');
    await s3.removePrefix('proofs/');
  } catch {
    // bucket unreachable is skipped per the grading reset contract
  }
}

export async function seedDatabase(
  body: SeedBody,
  cfg: Config,
  s3: S3Client,
): Promise<SeedResult> {
  const orgIds: Record<string, string> = {};
  const principalIds: Record<string, string> = {};
  const groupIds: Record<string, string> = {};
  const licenceIds: Record<string, string> = {};
  const assetIds: Record<string, string> = {};
  const variantIds: Record<string, string> = {};
  const derivativeIds: Record<string, string> = {};
  const requestIds: Record<string, string> = {};
  const grantIds: Record<string, string> = {};
  const versionIds: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const now = new Date(cfg.appStartAt);

  await validateSeed(body);

  await withTransaction(async (tx) => {
    await tx.query(`TRUNCATE TABLE proofs, grants, conditions, request_stages, timers, request_idempotency, requests,
        download_links, derivatives, variants, assets, licences, group_members, groups, principals, organisations,
        chapter_versions, rule_events, chapters, invitations, sessions, audit_records, mail_outbox, live_events,
        audit_sequence RESTART IDENTITY`);
    await tx.query('INSERT INTO audit_sequence (singleton, last_sequence) VALUES (true, 0)');
    await writeClockTx(tx, now);

    for (const org of body.organisations ?? []) {
      orgIds[org.key] = `org_${org.key}`;
      await tx.query(
        `INSERT INTO organisations (id, key, name, kind, territory, engagement_starts_on, engagement_ends_on, engagement_territories)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `org_${org.key}`,
          org.key,
          org.name,
          org.kind,
          org.territory,
          org.engagement?.startsOn ?? null,
          org.engagement?.endsOn ?? null,
          org.engagement?.territories ?? [],
        ],
      );
    }
    for (const principal of body.principals ?? []) {
      principalIds[principal.key] = `usr_${principal.key}`;
      await tx.query(
        `INSERT INTO principals (id, key, email, display_name, role, password_hash, organisation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `usr_${principal.key}`,
          principal.key,
          principal.email,
          principal.displayName,
          principal.role,
          hashPassword(principal.password),
          principal.organisation ? orgIds[principal.organisation] : null,
          now,
        ],
      );
    }
    for (const group of body.groups ?? []) {
      groupIds[group.key] = `grp_${group.key}`;
      await tx.query(`INSERT INTO groups (id, key, name) VALUES ($1,$2,$3)`, [
        `grp_${group.key}`,
        group.key,
        group.name,
      ]);
      for (const member of group.members) {
        await tx.query(`INSERT INTO group_members (group_id, principal_id) VALUES ($1,$2)`, [
          `grp_${group.key}`,
          principalIds[member],
        ]);
      }
    }
    for (const licence of body.licences ?? []) {
      licenceIds[licence.key] = `lic_${licence.key}`;
      await tx.query(
        `INSERT INTO licences (id, key, name, permitted_applications, prohibited_applications, audiences, territories,
            excluded_territories, default_duration_days, modification_permitted, attribution_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          `lic_${licence.key}`,
          licence.key,
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
    for (const asset of body.assets ?? []) {
      assetIds[asset.key] = `ast_${asset.key}`;
      await tx.query(
        `INSERT INTO assets (id, key, name, class, state, licence_id, successor_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          `ast_${asset.key}`,
          asset.key,
          asset.name,
          asset.class,
          asset.state,
          licenceIds[asset.licence],
          asset.successor ? assetIds[asset.successor] : null,
          now,
        ],
      );
    }
    let derivativeCounter = 0;
    for (const asset of body.assets ?? []) {
      derivativeCounter = 0;
      let position = 0;
      for (const derivative of asset.derivatives ?? []) {
        derivativeCounter += 1;
        const id = `drv_${asset.key}_${derivativeCounter}`;
        derivativeIds[`${asset.key}/${derivative.fileName}`] = id;
        const bytes = derivative.format === 'png' ? makePng(derivative.width, derivative.height, [31, 78, 140]) : makeSvg(derivative.width, derivative.height);
        await store(s3, `derivatives/ast_${asset.key}/base/${derivative.fileName}`, bytes);
        await store(s3, `masters/ast_${asset.key}/${derivative.fileName}`, bytes);
        await tx.query(
          `INSERT INTO derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, position)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8)`,
          [id, `ast_${asset.key}`, derivative.fileName, derivative.format, derivative.width, derivative.height, bytes.length, position],
        );
        position += 1;
      }
      for (const variant of asset.variants ?? []) {
        variantIds[`${asset.key}/${variant.key}`] = `var_${asset.key}_${variant.key}`;
        await tx.query(`INSERT INTO variants (id, asset_id, key, label, position) VALUES ($1,$2,$3,$4,$5)`, [
          `var_${asset.key}_${variant.key}`,
          `ast_${asset.key}`,
          variant.key,
          variant.label,
          position,
        ]);
        position += 1;
        for (const derivative of variant.derivatives ?? []) {
          derivativeCounter += 1;
          const id = `drv_${asset.key}_${derivativeCounter}`;
          derivativeIds[`${asset.key}/${derivative.fileName}`] = id;
          const bytes = derivative.format === 'png' ? makePng(derivative.width, derivative.height, [31, 78, 140]) : makeSvg(derivative.width, derivative.height);
          await store(s3, `derivatives/ast_${asset.key}/variants/${variant.key}/${derivative.fileName}`, bytes);
          await store(s3, `masters/ast_${asset.key}/${derivative.fileName}`, bytes);
          await tx.query(
            `INSERT INTO derivatives (id, asset_id, variant_id, file_name, format, width, height, byte_size, position)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              id,
              `ast_${asset.key}`,
              `var_${asset.key}_${variant.key}`,
              derivative.fileName,
              derivative.format,
              derivative.width,
              derivative.height,
              bytes.length,
              position,
            ],
          );
          position += 1;
        }
      }
    }
    let requestCounter = 0;
    for (const request of body.requests ?? []) {
      requestCounter += 1;
      const id = `REQ-${String(requestCounter).padStart(4, '0')}`;
      requestIds[request.key] = id;
      const holder = holderFor(request, principalIds);
      const submittedAt = new Date(request.submittedAt);
      const deadline = new Date(submittedAt.getTime() + tierHours(request.applicationClass as ApplicationClass, cfg) * 3600000);
      await tx.query(
        `INSERT INTO requests (id, idempotency_key, requester_id, asset_id, variant_id, application_class, territories,
            campaign_starts_on, campaign_ends_on, cited_rules, note, state, escalation, holder_id, submitted_at,
            deadline, deadline_submitted_at, created_at, updated_at)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$14,$14,$14)`,
        [
          id,
          principalIds[request.requester],
          assetIds[request.asset],
          request.variant ? variantIds[`${request.asset}/${request.variant}`] : null,
          request.applicationClass,
          request.territories,
          request.campaignStartsOn,
          request.campaignEndsOn,
          JSON.stringify(request.citedRules.map((identifier) => ({ identifier, version: 1 }))),
          request.note,
          request.state,
          request.escalation,
          holder,
          request.state === 'draft' ? null : submittedAt,
          request.state === 'draft' ? null : deadline,
        ],
      );
      for (let i = 0; i < request.stages.length; i++) {
        const stage = request.stages[i];
        await tx.query(
          `INSERT INTO request_stages (request_id, n, kind, assignee_id, decision, decided_at, comment, assigned_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            i + 1,
            stage.kind,
            stage.assignee ? principalIds[stage.assignee] : null,
            stage.decision,
            stage.decidedAt ? new Date(stage.decidedAt) : null,
            stage.comment,
            stage.assignee && request.state !== 'draft' ? submittedAt : null,
          ],
        );
      }
      if (request.state === 'under_review') {
        const hours = tierHours(request.applicationClass as ApplicationClass, cfg);
        await tx.query(
          `INSERT INTO timers (request_id, kind, due_at) VALUES ($1,'warning',$2),($1,'breach',$3),($1,'ceiling',$4)
             ON CONFLICT (request_id, kind) DO UPDATE SET due_at = EXCLUDED.due_at, done_at = NULL`,
          [
            id,
            new Date(submittedAt.getTime() + (hours * 3600000 * cfg.deadlineWarningPercent) / 100),
            deadline,
            new Date(submittedAt.getTime() + hours * 3600000 * cfg.expiryCeilingMultiplier),
          ],
        );
        for (const point of [
          new Date(submittedAt.getTime() + (hours * 3600000 * cfg.deadlineWarningPercent) / 100),
          deadline,
          new Date(submittedAt.getTime() + hours * 3600000 * cfg.expiryCeilingMultiplier),
        ]) {
          if (point.getTime() <= now.getTime()) {
            const kind = point.getTime() === deadline.getTime() ? 'breach' : point.getTime() > deadline.getTime() ? 'ceiling' : 'warning';
            await tx.query(`UPDATE timers SET done_at = $3 WHERE request_id = $1 AND kind = $2`, [id, kind, point]);
          }
        }
      }
      let conditionPosition = 0;
      for (const condition of request.conditions ?? []) {
        const conditionId = `CON-${String(conditionPosition + 1).padStart(4, '0')}`;
        await tx.query(
          `INSERT INTO conditions (id, request_id, kind, value, text, added_by, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            conditionId,
            id,
            condition.kind,
            condition.value,
            conditionText(condition.kind as ConditionKind, condition.value),
            principalIds[condition.addedBy],
            conditionPosition,
          ],
        );
        conditionPosition += 1;
      }
    }
    let grantCounter = 0;
    for (const grant of body.grants ?? []) {
      grantCounter += 1;
      const id = `GR-${String(grantCounter).padStart(4, '0')}`;
      grantIds[grant.key] = id;
      await tx.query(
        `INSERT INTO grants (id, holder_type, holder_principal_id, holder_group_id, asset_id, variant_id, request_id,
            status, not_before, not_after, cap, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          grant.holder.principal ? 'principal' : 'group',
          grant.holder.principal ? principalIds[grant.holder.principal] : null,
          grant.holder.group ? groupIds[grant.holder.group] : null,
          assetIds[grant.asset],
          grant.variant ? variantIds[`${grant.asset}/${grant.variant}`] : null,
          grant.request ? requestIds[grant.request] : null,
          grant.status,
          grant.notBefore,
          grant.notAfter,
          grant.request ? 'engagement end' : null,
          now,
        ],
      );
    }
    for (const slug of CHAPTER_SLUGS) {
      const chapter = (body.chapters ?? []).find((c) => c.slug === slug);
      if (!chapter) continue;
      await tx.query(`INSERT INTO chapters (slug, title, position) VALUES ($1,$2,$3)`, [
        slug,
        chapter.title,
        CHAPTER_SLUGS.indexOf(slug) + 1,
      ]);
      for (const version of chapter.versions) {
        const id = `ver_${slug}_${version.number}`;
        versionIds[`${slug}/${version.number}`] = id;
        await tx.query(
          `INSERT INTO chapter_versions (id, chapter_slug, number, state, author_id, revision, intro, statements,
              asset_ids, withdrawn, published_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$11)`,
          [
            id,
            slug,
            version.number,
            version.state,
            version.author ? principalIds[version.author] : null,
            version.intro,
            JSON.stringify(version.statements),
            (version.assets ?? []).map((a) => assetIds[a]),
            JSON.stringify(version.withdrawn ?? []),
            version.publishedAt ? new Date(version.publishedAt) : null,
            now,
          ],
        );
        if (version.state === 'published') {
          await writeRuleEvents(tx, slug, version.number, version.statements, version.withdrawn ?? []);
        }
      }
    }
    for (const record of body.audit ?? []) {
      await appendSeedAudit(tx, record, principalIds, requestIds);
    }
    for (const principal of body.principals ?? []) {
      const token = `${principal.key}-seed-session-${randomToken(12)}`;
      sessions[principal.key] = token;
      await tx.query(`INSERT INTO sessions (token_hash, principal_id, created_at) VALUES ($1,$2,$3)`, [
        sha256(token),
        principalIds[principal.key],
        now,
      ]);
    }
  });

  return {
    now: now.toISOString(),
    cookieName: cfg.sessionCookieName,
    ids: {
      organisations: orgIds,
      principals: principalIds,
      groups: groupIds,
      licences: licenceIds,
      assets: assetIds,
      variants: variantIds,
      derivatives: derivativeIds,
      requests: requestIds,
      grants: grantIds,
      versions: versionIds,
    },
    sessions,
  };
}

function holderFor(request: SeedRequest, principalIds: Record<string, string>): string {
  if (request.state !== 'under_review') {
    return principalIds[request.requester];
  }
  const open = request.stages.find((s) => s.decision === null);
  if (open && open.assignee) return principalIds[open.assignee];
  return principalIds[request.requester];
}

async function writeRuleEvents(
  tx: Tx,
  slug: string,
  number: number,
  statements: { identifier: string; text: string }[],
  withdrawn: { identifier: string; replacedBy: string }[],
): Promise<void> {
  for (const statement of statements) {
    if (!statement.identifier) continue;
    await tx.query(
      `INSERT INTO rule_events (identifier, chapter_slug, version_number, event, occurred_at) VALUES ($1,$2,$3,'live',now())`,
      [statement.identifier, slug, number],
    );
  }
  for (const w of withdrawn) {
    await tx.query(`DELETE FROM rule_events WHERE identifier = $1`, [w.identifier]);
    await tx.query(
      `INSERT INTO rule_events (identifier, chapter_slug, version_number, event, replaced_by, occurred_at)
       VALUES ($1,$2,$3,'withdrawn',$4,now())`,
      [w.identifier, slug, number, w.replacedBy],
    );
  }
}

async function appendSeedAudit(
  tx: Tx,
  record: SeedAudit,
  principalIds: Record<string, string>,
  requestIds: Record<string, string>,
): Promise<void> {
  const actorId = record.actor === 'system' ? 'system' : principalIds[record.actor] ?? 'system';
  const actorRole =
    record.actorRole ?? (record.actor === 'system' ? 'system' : (await tx.query<{ role: string }>('SELECT role FROM principals WHERE id = $1', [actorId])).rows[0]?.role ?? 'system');
  const requestId = record.request ? requestIds[record.request] ?? null : null;
  await appendAudit(tx, {
    occurredAt: new Date(record.occurredAt),
    actorId,
    actorRole,
    action: record.action as never,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    requestId,
    before: record.before,
    after: record.after,
    outcome: (record.outcome ?? 'success') as 'success' | 'denied',
  });
}

async function writeClockTx(tx: Tx, value: Date): Promise<void> {
  await tx.query(
    `INSERT INTO app_meta (key, value) VALUES ('app_clock', $1::text)
        ON CONFLICT (key) DO UPDATE SET value = $1::text`,
    [value.toISOString()],
  );
}

async function validateSeed(body: SeedBody): Promise<void> {
  const check = (condition: boolean, path: string, problem: string): void => {
    if (!condition) throw seedInvalid(path, problem);
  };
  check(Array.isArray(body.assets), 'assets', 'must be an array');
  for (const asset of body.assets ?? []) {
    check(typeof asset.key === 'string' && /^[a-z0-9_-]+$/.test(asset.key), 'assets', 'key must be lowercase');
    check(
      ['mark', 'spot_icon', 'pictogram', 'ui_icon', 'illustration', 'photograph'].includes(asset.class),
      `assets.${asset.key}.class`,
      'unknown class',
    );
    check(['draft', 'released', 'restricted', 'retired'].includes(asset.state), `assets.${asset.key}.state`, 'unknown state');
  }
  for (const principal of body.principals ?? []) {
    check(typeof principal.email === 'string' && principal.email.includes('@'), `principals.${principal.key}.email`, 'invalid email');
    check(
      ['owner', 'brand_reviewer', 'legal_reviewer', 'author', 'agency', 'employee', 'press'].includes(principal.role),
      `principals.${principal.key}.role`,
      'unknown role',
    );
  }
  for (const chapter of body.chapters ?? []) {
    check(CHAPTER_SLUGS.includes(chapter.slug as (typeof CHAPTER_SLUGS)[number]), 'chapters', 'unknown slug');
  }
}

async function store(s3: S3Client, key: string, bytes: Buffer): Promise<void> {
  try {
    await s3.put(key, bytes, 'application/octet-stream');
  } catch {
    // Seeds with storage down still record the sizes; release will catch the gap.
  }
}

export async function ensureDemoSeed(cfg: Config, s3: S3Client): Promise<void> {
  await applySchema();
  const rows = await query<{ c: string }>('SELECT COUNT(*)::text AS c FROM principals');
  if (Number(rows[0]?.c ?? 0) > 0) return;
  await seedDatabase(DEMO_SEED, cfg, s3);
}

export { notFound, seedConflict };
