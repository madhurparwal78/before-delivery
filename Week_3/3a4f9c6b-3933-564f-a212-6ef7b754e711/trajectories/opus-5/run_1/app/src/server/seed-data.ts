import type { Overrides, ProjectRole, WeekDay } from '../shared/types.js';

export const SEED_PASSWORD = 'keelson-demo-2026';

export interface SeedPerson {
  email: string;
  name: string;
  roles: { project: string; role: ProjectRole }[];
}

export const PEOPLE: SeedPerson[] = [
  {
    email: 'ines.okafor@keelson.test',
    name: 'Ines Okafor',
    roles: [{ project: 'payments-core', role: 'platform_engineer' }],
  },
  {
    email: 'tomas.reyes@keelson.test',
    name: 'Tomás Reyes',
    roles: [{ project: 'payments-core', role: 'service_developer' }],
  },
  {
    email: 'mei.lindqvist@keelson.test',
    name: 'Mei Lindqvist',
    roles: [{ project: 'payments-core', role: 'service_developer' }],
  },
  {
    email: 'hana.sato@keelson.test',
    name: 'Hana Sato',
    roles: [{ project: 'payments-core', role: 'release_manager' }],
  },
  {
    email: 'olu.adeyemi@keelson.test',
    name: 'Olu Adeyemi',
    roles: [{ project: 'payments-core', role: 'release_manager' }],
  },
  {
    email: 'kofi.brandt@keelson.test',
    name: 'Kofi Brandt',
    roles: [{ project: 'payments-core', role: 'oncall_sre' }],
  },
  {
    email: 'ravi.castell@keelson.test',
    name: 'Ravi Castell',
    roles: [{ project: 'claims-hub', role: 'service_developer' }],
  },
  {
    email: 'june.park@keelson.test',
    name: 'June Park',
    roles: [{ project: 'claims-hub', role: 'release_manager' }],
  },
];

export const PROJECTS = [
  { slug: 'payments-core', name: 'Payments Core' },
  { slug: 'claims-hub', name: 'Claims Hub' },
];

export const CLUSTERS = [
  { project: 'payments-core', name: 'lon1-nonprod', timeZone: 'Europe/London', token: 'agt-pc-lon1-nonprod-5e1f' },
  { project: 'payments-core', name: 'lon1-prod', timeZone: 'Europe/London', token: 'agt-pc-lon1-prod-8a2c' },
  { project: 'payments-core', name: 'use1-prod', timeZone: 'America/New_York', token: 'agt-pc-use1-prod-3d7b' },
  { project: 'payments-core', name: 'sin1-prod', timeZone: 'Asia/Singapore', token: 'agt-pc-sin1-prod-9c4e' },
  { project: 'claims-hub', name: 'fra1-nonprod', timeZone: 'Europe/Berlin', token: 'agt-ch-fra1-nonprod-2b6a' },
  { project: 'claims-hub', name: 'use2-prod', timeZone: 'America/Chicago', token: 'agt-ch-use2-prod-7f3d' },
];

const PAYMENTS_API_REF = 'Deployment/payments/payments-api';

export interface SeedStage {
  project: string;
  name: string;
  cluster: string;
  upstream: string | null;
  requiresApproval: boolean;
  defaults: Overrides;
}

export const STAGES: SeedStage[] = [
  {
    project: 'payments-core',
    name: 'dev',
    cluster: 'lon1-nonprod',
    upstream: null,
    requiresApproval: false,
    defaults: { parameters: { LOG_LEVEL: 'debug' }, replicas: { [PAYMENTS_API_REF]: 1 } },
  },
  {
    project: 'payments-core',
    name: 'staging',
    cluster: 'lon1-nonprod',
    upstream: 'dev',
    requiresApproval: false,
    defaults: { parameters: { LOG_LEVEL: 'info' }, replicas: { [PAYMENTS_API_REF]: 2 } },
  },
  {
    project: 'payments-core',
    name: 'prod-eu',
    cluster: 'lon1-prod',
    upstream: 'staging',
    requiresApproval: true,
    defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { [PAYMENTS_API_REF]: 4 } },
  },
  {
    project: 'payments-core',
    name: 'prod-us',
    cluster: 'use1-prod',
    upstream: 'staging',
    requiresApproval: true,
    defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { [PAYMENTS_API_REF]: 4 } },
  },
  {
    project: 'payments-core',
    name: 'prod-apac',
    cluster: 'sin1-prod',
    upstream: 'staging',
    requiresApproval: true,
    defaults: { parameters: { LOG_LEVEL: 'warn' }, replicas: { [PAYMENTS_API_REF]: 4 } },
  },
  {
    project: 'claims-hub',
    name: 'dev',
    cluster: 'fra1-nonprod',
    upstream: null,
    requiresApproval: false,
    defaults: { parameters: {}, replicas: {} },
  },
  {
    project: 'claims-hub',
    name: 'staging',
    cluster: 'fra1-nonprod',
    upstream: 'dev',
    requiresApproval: false,
    defaults: { parameters: {}, replicas: {} },
  },
  {
    project: 'claims-hub',
    name: 'prod-us',
    cluster: 'use2-prod',
    upstream: 'staging',
    requiresApproval: true,
    defaults: { parameters: {}, replicas: {} },
  },
];

export const SYNC_WINDOWS: {
  project: string;
  cluster: string;
  label: string;
  days: WeekDay[];
  start: number;
  end: number;
}[] = [
  {
    project: 'payments-core',
    cluster: 'lon1-prod',
    label: 'EU change window',
    days: ['tue'],
    start: 9 * 60,
    end: 12 * 60,
  },
  {
    project: 'payments-core',
    cluster: 'sin1-prod',
    label: 'APAC business hours',
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start: 10 * 60,
    end: 16 * 60,
  },
];

export const FREEZE_POLICIES = [
  {
    project: 'payments-core',
    version: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    createdBy: 'ines.okafor@keelson.test',
    freezes: [
      {
        name: 'Year-end freeze',
        stages: ['prod-eu', 'prod-us', 'prod-apac'],
        starts_at: '2026-12-23T00:00:00.000Z',
        ends_at: '2027-01-04T00:00:00.000Z',
      },
    ],
  },
  {
    project: 'claims-hub',
    version: 1,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    createdBy: 'june.park@keelson.test',
    freezes: [],
  },
];

function paymentsManifests(
  featurePayouts: string,
  password: string,
  apiKey: string,
  imageTag: string,
): Record<string, unknown>[] {
  return [
    {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'payments-api-config', namespace: 'payments' },
      data: { FEATURE_PAYOUTS: featurePayouts },
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'payments-db', namespace: 'payments' },
      type: 'Opaque',
      stringData: { password },
    },
    {
      apiVersion: 'bitnami.com/v1alpha1',
      kind: 'SealedSecret',
      metadata: { name: 'payments-psp-key', namespace: 'payments' },
      spec: { encryptedData: { apiKey } },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'payments-api', namespace: 'payments' },
      spec: {
        replicas: 2,
        template: {
          spec: { containers: [{ name: 'api', image: `registry.keelson.test/payments-api:${imageTag}` }] },
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'payments-api', namespace: 'payments' },
      spec: { ports: [{ port: 443 }] },
    },
  ];
}

export const BUNDLES = [
  {
    project: 'payments-core',
    version: '1.4.0',
    sourceCommit: '4a1c9e0b7d2f63a85e19c04b7f3d2a6e8c5b1f90',
    ingestedBy: 'tomas.reyes@keelson.test',
    ingestedAt: '2026-10-19T07:30:00.000Z',
    manifests: paymentsManifests('off', 'pc-db-pass-1.4-THETA', 'AgB4sealedPSPkey14', '1.4.0'),
  },
  {
    project: 'payments-core',
    version: '1.5.0',
    sourceCommit: '9e3b5d7f1a2c4e6b8d0f1a3c5e7b9d2f4a6c8e01',
    ingestedBy: 'mei.lindqvist@keelson.test',
    ingestedAt: '2026-10-22T07:30:00.000Z',
    manifests: paymentsManifests('on', 'pc-db-pass-1.5-ZETA', 'AgB7sealedPSPkey15', '1.5.0'),
  },
  {
    project: 'claims-hub',
    version: '2.0.0',
    sourceCommit: 'c0ffee1234567890abcdef1234567890abcdef12',
    ingestedBy: 'ravi.castell@keelson.test',
    ingestedAt: '2026-10-21T08:30:00.000Z',
    manifests: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'claims-api', namespace: 'claims' },
        spec: {
          replicas: 2,
          template: {
            spec: { containers: [{ name: 'api', image: 'registry.keelson.test/claims-api:2.0.0' }] },
          },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'claims-db', namespace: 'claims' },
        type: 'Opaque',
        stringData: { password: 'ch-db-pass-2.0-KAPPA' },
      },
    ],
  },
];

export interface SeedPromotion {
  project: string;
  stage: string;
  version: string;
  requestedBy: string;
  requestedAt: string;
  appliedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** Every seeded promotion reached healthy, with every health row Synced and Healthy. */
export const PROMOTIONS: SeedPromotion[] = [
  {
    project: 'payments-core',
    stage: 'dev',
    version: '1.4.0',
    requestedBy: 'tomas.reyes@keelson.test',
    requestedAt: '2026-10-19T08:00:00.000Z',
    appliedAt: '2026-10-19T08:01:00.000Z',
    approvedBy: null,
    approvedAt: null,
  },
  {
    project: 'payments-core',
    stage: 'staging',
    version: '1.4.0',
    requestedBy: 'tomas.reyes@keelson.test',
    requestedAt: '2026-10-19T10:00:00.000Z',
    appliedAt: '2026-10-19T10:01:00.000Z',
    approvedBy: null,
    approvedAt: null,
  },
  {
    project: 'payments-core',
    stage: 'prod-eu',
    version: '1.4.0',
    requestedBy: 'tomas.reyes@keelson.test',
    requestedAt: '2026-10-20T08:00:00.000Z',
    appliedAt: '2026-10-20T08:35:00.000Z',
    approvedBy: 'hana.sato@keelson.test',
    approvedAt: '2026-10-20T08:30:00.000Z',
  },
  {
    project: 'payments-core',
    stage: 'prod-us',
    version: '1.4.0',
    requestedBy: 'tomas.reyes@keelson.test',
    requestedAt: '2026-10-20T08:00:00.000Z',
    appliedAt: '2026-10-20T08:35:00.000Z',
    approvedBy: 'hana.sato@keelson.test',
    approvedAt: '2026-10-20T08:30:00.000Z',
  },
  {
    project: 'payments-core',
    stage: 'prod-apac',
    version: '1.4.0',
    requestedBy: 'tomas.reyes@keelson.test',
    requestedAt: '2026-10-20T08:00:00.000Z',
    appliedAt: '2026-10-20T08:35:00.000Z',
    approvedBy: 'hana.sato@keelson.test',
    approvedAt: '2026-10-20T08:30:00.000Z',
  },
  {
    project: 'payments-core',
    stage: 'dev',
    version: '1.5.0',
    requestedBy: 'mei.lindqvist@keelson.test',
    requestedAt: '2026-10-22T08:00:00.000Z',
    appliedAt: '2026-10-22T08:01:00.000Z',
    approvedBy: null,
    approvedAt: null,
  },
  {
    project: 'payments-core',
    stage: 'staging',
    version: '1.5.0',
    requestedBy: 'mei.lindqvist@keelson.test',
    requestedAt: '2026-10-22T10:00:00.000Z',
    appliedAt: '2026-10-22T10:01:00.000Z',
    approvedBy: null,
    approvedAt: null,
  },
  {
    project: 'claims-hub',
    stage: 'dev',
    version: '2.0.0',
    requestedBy: 'ravi.castell@keelson.test',
    requestedAt: '2026-10-21T09:00:00.000Z',
    appliedAt: '2026-10-21T09:01:00.000Z',
    approvedBy: null,
    approvedAt: null,
  },
];
