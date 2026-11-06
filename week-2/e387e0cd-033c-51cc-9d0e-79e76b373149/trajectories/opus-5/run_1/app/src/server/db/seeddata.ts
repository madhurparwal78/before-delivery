import { DueDiligence, NetworkStanding } from '../domain/case';

export interface SeedWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly timeZone: string;
  readonly city: string;
  readonly currency: string;
  readonly confirmationLimitCents: bigint;
  readonly casePrefix: string;
  readonly sendingAddress: string;
}

export const SEED_WORKSPACES: readonly SeedWorkspace[] = [
  {
    slug: 'neris',
    name: 'Neris Digital',
    legalName: 'Neris Digital UAB',
    lei: '984500NERISDIGIT0172',
    jurisdictionCode: 'LT',
    timeZone: 'Europe/Vilnius',
    city: 'Vilnius',
    currency: 'EUR',
    confirmationLimitCents: 100000n,
    casePrefix: 'NRS-',
    sendingAddress: 'lnl1neriswallet0000000000000000001',
  },
  {
    slug: 'kallang',
    name: 'Kallang Exchange',
    legalName: 'Kallang Exchange Pte. Ltd.',
    lei: '984500KALLANGEX00166',
    jurisdictionCode: 'SG',
    timeZone: 'Asia/Singapore',
    city: 'Singapore',
    currency: 'SGD',
    confirmationLimitCents: 150000n,
    casePrefix: 'KLG-',
    sendingAddress: 'lnl1kallangsend0000000000000000001',
  },
];

export const SEED_PASSWORD = 'Lantern-Desk-2027!';

export interface SeedMember {
  readonly workspaceSlug: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

export const SEED_MEMBERS: readonly SeedMember[] = [
  { workspaceSlug: 'neris', name: 'Ieva Morkūnė', email: 'officer@neris.example', role: 'compliance_officer' },
  { workspaceSlug: 'neris', name: 'Tomas Vaitkus', email: 'analyst@neris.example', role: 'compliance_analyst' },
  { workspaceSlug: 'neris', name: 'Dalia Petraitytė', email: 'ops@neris.example', role: 'operations_lead' },
  { workspaceSlug: 'neris', name: 'Marius Jankus', email: 'finance@neris.example', role: 'finance_lead' },
  { workspaceSlug: 'neris', name: 'Greta Lukoševičiūtė', email: 'support@neris.example', role: 'support_agent' },
  { workspaceSlug: 'kallang', name: 'Mei Ling Tan', email: 'officer@kallang.example', role: 'compliance_officer' },
  { workspaceSlug: 'kallang', name: 'Arjun Pillai', email: 'analyst@kallang.example', role: 'compliance_analyst' },
  { workspaceSlug: 'kallang', name: 'Siti Rahmah', email: 'ops@kallang.example', role: 'operations_lead' },
  { workspaceSlug: 'kallang', name: 'Daniel Koh', email: 'finance@kallang.example', role: 'finance_lead' },
  { workspaceSlug: 'kallang', name: 'Nur Aisyah', email: 'support@kallang.example', role: 'support_agent' },
];

export interface SeedCustomer {
  readonly id: string;
  readonly workspaceSlug: string;
  readonly name: string;
  readonly identityNumber: string;
  readonly dateOfBirth: string;
  readonly depositAddress: string;
}

export const SEED_CUSTOMERS: readonly SeedCustomer[] = [
  {
    id: 'cust-neris-01',
    workspaceSlug: 'neris',
    name: 'Łukasz Ørsted-Ækvist',
    identityNumber: 'TEST-ID-0001',
    dateOfBirth: '1986-04-12',
    depositAddress: 'lnl1nerisclient0000000000000000001',
  },
  {
    id: 'cust-neris-02',
    workspaceSlug: 'neris',
    name: 'Đurđica Weiß',
    identityNumber: 'TEST-ID-0002',
    dateOfBirth: '1979-11-03',
    depositAddress: 'lnl1nerisclient0000000000000000002',
  },
  {
    id: 'cust-neris-03',
    workspaceSlug: 'neris',
    name: 'Œnone Bérubé',
    identityNumber: 'TEST-ID-0003',
    dateOfBirth: '1992-02-29',
    depositAddress: 'lnl1nerisclient0000000000000000003',
  },
  {
    id: 'cust-neris-04',
    workspaceSlug: 'neris',
    name: 'Þóra Jónsdóttir',
    identityNumber: 'TEST-ID-0004',
    dateOfBirth: '1990-07-21',
    depositAddress: 'lnl1nerisclient0000000000000000004',
  },
  {
    id: 'cust-neris-05',
    workspaceSlug: 'neris',
    name: 'Rūta Kairienė',
    identityNumber: 'TEST-ID-0005',
    dateOfBirth: '1984-09-30',
    depositAddress: 'lnl1nerisclient0000000000000000005',
  },
  {
    id: 'cust-neris-06',
    workspaceSlug: 'neris',
    name: 'Jonas Petraitis',
    identityNumber: 'TEST-ID-0006',
    dateOfBirth: '2001-01-15',
    depositAddress: 'lnl1nerisclient0000000000000000006',
  },
  {
    id: 'cust-kallang-01',
    workspaceSlug: 'kallang',
    name: 'Tan Wei Ming',
    identityNumber: 'TEST-ID-0011',
    dateOfBirth: '1988-05-06',
    depositAddress: 'lnl1kallangcust0000000000000000001',
  },
  {
    id: 'cust-kallang-02',
    workspaceSlug: 'kallang',
    name: 'Siobhán Ó Briain',
    identityNumber: 'TEST-ID-0012',
    dateOfBirth: '1975-12-24',
    depositAddress: 'lnl1kallangcust0000000000000000002',
  },
  {
    id: 'cust-kallang-03',
    workspaceSlug: 'kallang',
    name: 'Ægir Løkke',
    identityNumber: 'TEST-ID-0013',
    dateOfBirth: '1983-03-17',
    depositAddress: 'lnl1kallangcust0000000000000000003',
  },
  {
    id: 'cust-kallang-04',
    workspaceSlug: 'kallang',
    name: 'Nguyễn Thị Lan',
    identityNumber: 'TEST-ID-0014',
    dateOfBirth: '1996-08-08',
    depositAddress: 'lnl1kallangcust0000000000000000004',
  },
  {
    id: 'cust-kallang-05',
    workspaceSlug: 'kallang',
    name: 'Paweł Strauß',
    identityNumber: 'TEST-ID-0015',
    dateOfBirth: '1991-10-10',
    depositAddress: 'lnl1kallangcust0000000000000000005',
  },
  {
    id: 'cust-kallang-06',
    workspaceSlug: 'kallang',
    name: 'Priya Raman',
    identityNumber: 'TEST-ID-0016',
    dateOfBirth: '1999-06-01',
    depositAddress: 'lnl1kallangcust0000000000000000006',
  },
];

export interface SeedCounterparty {
  readonly key: string;
  readonly legalName: string;
  readonly lei: string;
  readonly jurisdictionCode: string;
  readonly licenceNumber: string;
  readonly dueDiligence: DueDiligence;
  readonly network: NetworkStanding;
  readonly contactEmail: string;
  readonly registryAddress: string;
  readonly signingValues: Readonly<Record<string, string>>;
}

export const SEED_COUNTERPARTIES: readonly SeedCounterparty[] = [
  {
    key: 'harbourgate',
    legalName: 'Harbourgate Digital Assets Ltd',
    lei: '5299004HARBOURGATE75',
    jurisdictionCode: 'IE',
    licenceNumber: 'IE-CBI-VASP-0417',
    dueDiligence: 'trusted',
    network: 'on_network',
    contactEmail: '',
    registryAddress: 'lnl1harbourgate0000000000000000001',
    signingValues: {
      neris: 'lnls_neris_harbourgate_3f9a1c7e',
      kallang: 'lnls_kallang_harbourgate_a4c8e216',
    },
  },
  {
    key: 'tallinnstar',
    legalName: 'Tallinn Star Exchange OÜ',
    lei: '3912006TALLINNSTAR86',
    jurisdictionCode: 'EE',
    licenceNumber: 'EE-FIU-FVT000311',
    dueDiligence: 'trusted',
    network: 'off_network',
    contactEmail: 'compliance@tallinnstar.example',
    registryAddress: 'lnl1tallinnstar0000000000000000001',
    signingValues: {},
  },
  {
    key: 'keystone',
    legalName: 'Keystone Vault AG',
    lei: '2549001KEYSTONEVA089',
    jurisdictionCode: 'CH',
    licenceNumber: 'CH-FINMA-SRO-2291',
    dueDiligence: 'pending',
    network: 'on_network',
    contactEmail: '',
    registryAddress: 'lnl1keystonevlt0000000000000000001',
    signingValues: {
      neris: 'lnls_neris_keystone_8b2d4f60',
      kallang: 'lnls_kallang_keystone_17f3b9d0',
    },
  },
  {
    key: 'sakura',
    legalName: 'Sakura Vault HK Limited',
    lei: '635400SAKURAVAULT155',
    jurisdictionCode: 'HK',
    licenceNumber: 'HK-SFC-BSV-118',
    dueDiligence: 'trusted',
    network: 'on_network',
    contactEmail: '',
    registryAddress: 'lnl1sakuravault0000000000000000001',
    signingValues: {
      neris: 'lnls_neris_sakura_c71e05a9',
      kallang: 'lnls_kallang_sakura_92e5c04b',
    },
  },
  {
    key: 'meridian',
    legalName: 'Meridian Coin S.A.',
    lei: '213800MERIDIANCOIN70',
    jurisdictionCode: 'PA',
    licenceNumber: 'PA-SBP-0093',
    dueDiligence: 'trusted',
    network: 'off_network',
    contactEmail: 'compliance@meridiancoin.example',
    registryAddress: 'lnl1meridiancsa0000000000000000001',
    signingValues: {},
  },
  {
    key: 'balticrail',
    legalName: 'Baltic Rail Crypto UAB',
    lei: '5493007BALTICRAIL035',
    jurisdictionCode: 'LT',
    licenceNumber: 'LT-FNTT-VASP-0552',
    dueDiligence: 'restricted',
    network: 'on_network',
    contactEmail: '',
    registryAddress: 'lnl1balticrails0000000000000000001',
    signingValues: {
      neris: 'lnls_neris_balticrail_5d93b2e4',
      kallang: 'lnls_kallang_balticrail_6ab1d7f3',
    },
  },
  {
    key: 'nordlys',
    legalName: 'Nordlys Exchange Ltd',
    lei: '9695009NORDLYSXC0095',
    jurisdictionCode: 'SC',
    licenceNumber: 'SC-FSA-VA-0071',
    dueDiligence: 'blocked',
    network: 'off_network',
    contactEmail: 'compliance@nordlys.example',
    registryAddress: 'lnl1nordlysexch0000000000000000001',
    signingValues: {},
  },
  {
    key: 'atlaspeak',
    legalName: 'Atlas Peak Digital FZE',
    lei: '254900ATLASPEAK00012',
    jurisdictionCode: 'AE',
    licenceNumber: 'AE-VARA-0336',
    dueDiligence: 'trusted',
    network: 'on_network',
    contactEmail: '',
    registryAddress: 'lnl1atlaspeakfz0000000000000000001',
    signingValues: {
      neris: 'lnls_neris_atlaspeak_e0a6f318',
      kallang: 'lnls_kallang_atlaspeak_d38f0e65',
    },
  },
];

export interface SeedRate {
  readonly asset: string;
  readonly eurCents: bigint;
  readonly sgdCents: bigint;
}

export const SEED_RATES: readonly SeedRate[] = [
  { asset: 'BTC', eurCents: 6125000n, sgdCents: 9012550n },
  { asset: 'ETH', eurCents: 333335n, sgdCents: 500000n },
  { asset: 'USDC', eurCents: 92n, sgdCents: 135n },
  { asset: 'SOL', eurCents: 14217n, sgdCents: 20940n },
];

export const RATES_IN_FORCE_SINCE = '2026-01-01';

export type JurisdictionStatus = 'in_force' | 'announced' | 'no_rule';

export interface SeedJurisdiction {
  readonly code: string;
  readonly name: string;
  readonly region: string;
  readonly currency: string;
  readonly status: JurisdictionStatus;
  readonly thresholdCents: bigint | null;
  readonly inForceSince: string | null;
  readonly changeThresholdCents: bigint | null;
  readonly changeTakesEffectOn: string | null;
}

export const SEED_JURISDICTIONS: readonly SeedJurisdiction[] = [
  { code: 'LT', name: 'Lithuania', region: 'europe', currency: 'EUR', status: 'in_force', thresholdCents: 0n, inForceSince: '2024-12-30', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'EE', name: 'Estonia', region: 'europe', currency: 'EUR', status: 'in_force', thresholdCents: 0n, inForceSince: '2024-12-30', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'IE', name: 'Ireland', region: 'europe', currency: 'EUR', status: 'in_force', thresholdCents: 0n, inForceSince: '2024-12-30', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'DE', name: 'Germany', region: 'europe', currency: 'EUR', status: 'in_force', thresholdCents: 0n, inForceSince: '2024-12-30', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'MT', name: 'Malta', region: 'europe', currency: 'EUR', status: 'in_force', thresholdCents: 0n, inForceSince: '2024-12-30', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'CH', name: 'Switzerland', region: 'europe', currency: 'CHF', status: 'in_force', thresholdCents: 100000n, inForceSince: '2021-01-01', changeThresholdCents: 0n, changeTakesEffectOn: '2028-01-01' },
  { code: 'GB', name: 'United Kingdom', region: 'europe', currency: 'GBP', status: 'in_force', thresholdCents: 84000n, inForceSince: '2023-09-01', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'SG', name: 'Singapore', region: 'asia_pacific', currency: 'SGD', status: 'in_force', thresholdCents: 150000n, inForceSince: '2020-01-28', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'HK', name: 'Hong Kong', region: 'asia_pacific', currency: 'HKD', status: 'in_force', thresholdCents: 800000n, inForceSince: '2023-06-01', changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'AE', name: 'United Arab Emirates', region: 'middle_east', currency: 'AED', status: 'announced', thresholdCents: null, inForceSince: null, changeThresholdCents: 350000n, changeTakesEffectOn: '2028-03-01' },
  { code: 'TH', name: 'Thailand', region: 'asia_pacific', currency: 'THB', status: 'announced', thresholdCents: null, inForceSince: null, changeThresholdCents: 5000000n, changeTakesEffectOn: '2028-07-01' },
  { code: 'PA', name: 'Panama', region: 'americas', currency: 'USD', status: 'no_rule', thresholdCents: null, inForceSince: null, changeThresholdCents: null, changeTakesEffectOn: null },
  { code: 'SC', name: 'Seychelles', region: 'africa', currency: 'USD', status: 'no_rule', thresholdCents: null, inForceSince: null, changeThresholdCents: null, changeTakesEffectOn: null },
];

export interface SeedListing {
  readonly slug: string;
  readonly name: string;
  readonly jurisdictionCode: string;
  readonly onNetwork: boolean;
  readonly workspaceSlug: string | null;
}

export const SEED_LISTINGS: readonly SeedListing[] = [
  { slug: 'neris-digital', name: 'Neris Digital UAB', jurisdictionCode: 'LT', onNetwork: true, workspaceSlug: 'neris' },
  { slug: 'kallang-exchange', name: 'Kallang Exchange Pte. Ltd.', jurisdictionCode: 'SG', onNetwork: true, workspaceSlug: 'kallang' },
  { slug: 'harbourgate-digital-assets', name: 'Harbourgate Digital Assets Ltd', jurisdictionCode: 'IE', onNetwork: true, workspaceSlug: null },
  { slug: 'tallinn-star-exchange', name: 'Tallinn Star Exchange OÜ', jurisdictionCode: 'EE', onNetwork: false, workspaceSlug: null },
  { slug: 'keystone-vault', name: 'Keystone Vault AG', jurisdictionCode: 'CH', onNetwork: true, workspaceSlug: null },
  { slug: 'sakura-vault-hk', name: 'Sakura Vault HK Limited', jurisdictionCode: 'HK', onNetwork: true, workspaceSlug: null },
  { slug: 'meridian-coin', name: 'Meridian Coin S.A.', jurisdictionCode: 'PA', onNetwork: false, workspaceSlug: null },
  { slug: 'baltic-rail-crypto', name: 'Baltic Rail Crypto UAB', jurisdictionCode: 'LT', onNetwork: true, workspaceSlug: null },
  { slug: 'nordlys-exchange', name: 'Nordlys Exchange Ltd', jurisdictionCode: 'SC', onNetwork: false, workspaceSlug: null },
  { slug: 'atlas-peak-digital', name: 'Atlas Peak Digital FZE', jurisdictionCode: 'AE', onNetwork: true, workspaceSlug: null },
  { slug: 'rheinmark-krypto', name: 'Rheinmark Krypto GmbH', jurisdictionCode: 'DE', onNetwork: true, workspaceSlug: null },
  { slug: 'valletta-blockworks', name: 'Valletta Blockworks Ltd', jurisdictionCode: 'MT', onNetwork: false, workspaceSlug: null },
  { slug: 'thamesgate-digital', name: 'Thamesgate Digital Ltd', jurisdictionCode: 'GB', onNetwork: true, workspaceSlug: null },
  { slug: 'chao-phraya-digital', name: 'Chao Phraya Digital Co., Ltd.', jurisdictionCode: 'TH', onNetwork: false, workspaceSlug: null },
  { slug: 'mahe-coin', name: 'Mahé Coin Ltd', jurisdictionCode: 'SC', onNetwork: false, workspaceSlug: null },
];

export const SEED_PARTNER_KEYS: ReadonlyArray<{
  readonly workspaceSlug: string;
  readonly label: string;
  readonly key: string;
}> = [
  { workspaceSlug: 'neris', label: 'Neris core banking', key: 'lnlk_5e1f0a7c3b9d48e2a6f1c0d9b8e7a6f5' },
  { workspaceSlug: 'kallang', label: 'Kallang ledger', key: 'lnlk_9a2c4e6f8b0d1e3f5a7c9e1b3d5f7a90' },
];

/** Metered message counts seeded for the three business months before month 0. */
export const SEED_METERED_MONTHS: readonly number[] = [1002, 1003, 1215];
