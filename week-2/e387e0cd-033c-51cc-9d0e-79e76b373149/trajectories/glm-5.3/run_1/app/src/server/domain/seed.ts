// Invented seed data, exactly as published. Each seeded business, person,
// address and signing value is fictional.
export interface WorkspaceSeed {
  slug: string; name: string; legalName: string; lei: string; jurisdictionCode: string;
  timeZone: string; city: string; currency: string; confirmationLimitCents: number;
  casePrefix: string; sendingAddress: string; listingSlug: string; onNetwork: boolean;
}
export const WORKSPACES: WorkspaceSeed[] = [
  { slug: 'neris', name: 'Neris Digital', legalName: 'Neris Digital UAB', lei: '984500NERISDIGIT0172', jurisdictionCode: 'LT', timeZone: 'Europe/Vilnius', city: 'Vilnius', currency: 'EUR', confirmationLimitCents: 100000, casePrefix: 'NRS-', sendingAddress: 'lnl1neriswallet0000000000000000001', listingSlug: 'neris-digital', onNetwork: true },
  { slug: 'kallang', name: 'Kallang Exchange', legalName: 'Kallang Exchange Pte. Ltd.', lei: '984500KALLANGEX00166', jurisdictionCode: 'SG', timeZone: 'Asia/Singapore', city: 'Singapore', currency: 'SGD', confirmationLimitCents: 150000, casePrefix: 'KLG-', sendingAddress: 'lnl1kallangsend0000000000000000001', listingSlug: 'kallang-exchange', onNetwork: true },
];

export const STAFF_PASSWORD = 'Lantern-Desk-2027!';

export const MEMBERS: { workspace: string; name: string; email: string; role: string }[] = [
  { workspace: 'neris', name: 'Ieva Morkūnė', email: 'officer@neris.example', role: 'compliance_officer' },
  { workspace: 'neris', name: 'Tomas Vaitkus', email: 'analyst@neris.example', role: 'compliance_analyst' },
  { workspace: 'neris', name: 'Dalia Petraitytė', email: 'ops@neris.example', role: 'operations_lead' },
  { workspace: 'neris', name: 'Marius Jankus', email: 'finance@neris.example', role: 'finance_lead' },
  { workspace: 'neris', name: 'Greta Lukoševičiūtė', email: 'support@neris.example', role: 'support_agent' },
  { workspace: 'kallang', name: 'Mei Ling Tan', email: 'officer@kallang.example', role: 'compliance_officer' },
  { workspace: 'kallang', name: 'Arjun Pillai', email: 'analyst@kallang.example', role: 'compliance_analyst' },
  { workspace: 'kallang', name: 'Siti Rahmah', email: 'ops@kallang.example', role: 'operations_lead' },
  { workspace: 'kallang', name: 'Daniel Koh', email: 'finance@kallang.example', role: 'finance_lead' },
  { workspace: 'kallang', name: 'Nur Aisyah', email: 'support@kallang.example', role: 'support_agent' },
];

export const CUSTOMERS: { id: string; workspace: string; name: string; identityNumber: string; dateOfBirth: string; depositAddress: string }[] = [
  { id: 'cust-neris-01', workspace: 'neris', name: 'Łukasz Ørsted-Ækvist', identityNumber: 'TEST-ID-0001', dateOfBirth: '1986-04-12', depositAddress: 'lnl1nerisclient0000000000000000001' },
  { id: 'cust-neris-02', workspace: 'neris', name: 'Đurđica Weiß', identityNumber: 'TEST-ID-0002', dateOfBirth: '1979-11-03', depositAddress: 'lnl1nerisclient0000000000000000002' },
  { id: 'cust-neris-03', workspace: 'neris', name: 'Œnone Bérubé', identityNumber: 'TEST-ID-0003', dateOfBirth: '1992-02-29', depositAddress: 'lnl1nerisclient0000000000000000003' },
  { id: 'cust-neris-04', workspace: 'neris', name: 'Þóra Jónsdóttir', identityNumber: 'TEST-ID-0004', dateOfBirth: '1990-07-21', depositAddress: 'lnl1nerisclient0000000000000000004' },
  { id: 'cust-neris-05', workspace: 'neris', name: 'Rūta Kairienė', identityNumber: 'TEST-ID-0005', dateOfBirth: '1984-09-30', depositAddress: 'lnl1nerisclient0000000000000000005' },
  { id: 'cust-neris-06', workspace: 'neris', name: 'Jonas Petraitis', identityNumber: 'TEST-ID-0006', dateOfBirth: '2001-01-15', depositAddress: 'lnl1nerisclient0000000000000000006' },
  { id: 'cust-kallang-01', workspace: 'kallang', name: 'Tan Wei Ming', identityNumber: 'TEST-ID-0011', dateOfBirth: '1988-05-06', depositAddress: 'lnl1kallangcust0000000000000000001' },
  { id: 'cust-kallang-02', workspace: 'kallang', name: 'Siobhán Ó Briain', identityNumber: 'TEST-ID-0012', dateOfBirth: '1975-12-24', depositAddress: 'lnl1kallangcust0000000000000000002' },
  { id: 'cust-kallang-03', workspace: 'kallang', name: 'Ægir Løkke', identityNumber: 'TEST-ID-0013', dateOfBirth: '1983-03-17', depositAddress: 'lnl1kallangcust0000000000000000003' },
  { id: 'cust-kallang-04', workspace: 'kallang', name: 'Nguyễn Thị Lan', identityNumber: 'TEST-ID-0014', dateOfBirth: '1996-08-08', depositAddress: 'lnl1kallangcust0000000000000000004' },
  { id: 'cust-kallang-05', workspace: 'kallang', name: 'Paweł Strauß', identityNumber: 'TEST-ID-0015', dateOfBirth: '1991-10-10', depositAddress: 'lnl1kallangcust0000000000000000005' },
  { id: 'cust-kallang-06', workspace: 'kallang', name: 'Priya Raman', identityNumber: 'TEST-ID-0016', dateOfBirth: '1999-06-01', depositAddress: 'lnl1kallangcust0000000000000000006' },
];

export interface CounterpartySeed {
  legalName: string; lei: string; jurisdictionCode: string; licenceNumber: string;
  dueDiligence: string; network: 'on_network' | 'off_network'; contactEmail: string | null; address: string;
}
export const COUNTERPARTIES: CounterpartySeed[] = [
  { legalName: 'Harbourgate Digital Assets Ltd', lei: '5299004HARBOURGATE75', jurisdictionCode: 'IE', licenceNumber: 'IE-CBI-VASP-0417', dueDiligence: 'trusted', network: 'on_network', contactEmail: null, address: 'lnl1harbourgate0000000000000000001' },
  { legalName: 'Tallinn Star Exchange OÜ', lei: '3912006TALLINNSTAR86', jurisdictionCode: 'EE', licenceNumber: 'EE-FIU-FVT000311', dueDiligence: 'trusted', network: 'off_network', contactEmail: 'compliance@tallinnstar.example', address: 'lnl1tallinnstar0000000000000000001' },
  { legalName: 'Keystone Vault AG', lei: '2549001KEYSTONEVA089', jurisdictionCode: 'CH', licenceNumber: 'CH-FINMA-SRO-2291', dueDiligence: 'pending', network: 'on_network', contactEmail: null, address: 'lnl1keystonevlt0000000000000000001' },
  { legalName: 'Sakura Vault HK Limited', lei: '635400SAKURAVAULT155', jurisdictionCode: 'HK', licenceNumber: 'HK-SFC-BSV-118', dueDiligence: 'trusted', network: 'on_network', contactEmail: null, address: 'lnl1sakuravault0000000000000000001' },
  { legalName: 'Meridian Coin S.A.', lei: '213800MERIDIANCOIN70', jurisdictionCode: 'PA', licenceNumber: 'PA-SBP-0093', dueDiligence: 'trusted', network: 'off_network', contactEmail: 'compliance@meridiancoin.example', address: 'lnl1meridiancsa0000000000000000001' },
  { legalName: 'Baltic Rail Crypto UAB', lei: '5493007BALTICRAIL035', jurisdictionCode: 'LT', licenceNumber: 'LT-FNTT-VASP-0552', dueDiligence: 'restricted', network: 'on_network', contactEmail: null, address: 'lnl1balticrails0000000000000000001' },
  { legalName: 'Nordlys Exchange Ltd', lei: '9695009NORDLYSXC0095', jurisdictionCode: 'SC', licenceNumber: 'SC-FSA-VA-0071', dueDiligence: 'blocked', network: 'off_network', contactEmail: 'nordlys@example', address: 'lnl1nordlysexch0000000000000000001' },
  { legalName: 'Atlas Peak Digital FZE', lei: '254900ATLASPEAK00012', jurisdictionCode: 'AE', licenceNumber: 'AE-VARA-0336', dueDiligence: 'trusted', network: 'on_network', contactEmail: null, address: 'lnl1atlaspeakfz0000000000000000001' },
];

export const SIGNING_VALUES: Record<string, Record<string, string>> = {
  harbourgate: { neris: 'lnls_neris_harbourgate_3f9a1c7e', kallang: 'lnls_kallang_harbourgate_a4c8e216' },
  keystone: { neris: 'lnls_neris_keystone_8b2d4f60', kallang: 'lnls_kallang_keystone_17f3b9d0' },
  sakura: { neris: 'lnls_neris_sakura_c71e05a9', kallang: 'lnls_kallang_sakura_92e5c04b' },
  balticrail: { neris: 'lnls_neris_balticrail_5d93b2e4', kallang: 'lnls_kallang_balticrail_6ab1d7f3' },
  atlaspeak: { neris: 'lnls_neris_atlaspeak_e0a6f318', kallang: 'lnls_kallang_atlaspeak_d38f0e65' },
};

export const SIGNING_VALUE_BY_LEI: Record<string, Record<string, string>> = {
  '5299004HARBOURGATE75': SIGNING_VALUES.harbourgate,
  '2549001KEYSTONEVA089': SIGNING_VALUES.keystone,
  '635400SAKURAVAULT155': SIGNING_VALUES.sakura,
  '5493007BALTICRAIL035': SIGNING_VALUES.balticrail,
  '254900ATLASPEAK00012': SIGNING_VALUES.atlaspeak,
};

export const RATES: { asset: string; eurCents: number; sgdCents: number; since: string }[] = [
  { asset: 'BTC', eurCents: 6125000, sgdCents: 9012550, since: '2026-01-01' },
  { asset: 'ETH', eurCents: 333335, sgdCents: 500000, since: '2026-01-01' },
  { asset: 'USDC', eurCents: 92, sgdCents: 135, since: '2026-01-01' },
  { asset: 'SOL', eurCents: 14217, sgdCents: 20940, since: '2026-01-01' },
];

export interface JurisdictionSeed {
  code: string; name: string; region: string; currency: string;
  thresholdCents: number | null; inForceSince: string | null;
  change: { thresholdCents: number; takesEffectOn: string } | null;
}
export const JURISDICTIONS: JurisdictionSeed[] = [
  { code: 'LT', name: 'Lithuania', region: 'europe', currency: 'EUR', thresholdCents: 0, inForceSince: '2024-12-30', change: null },
  { code: 'EE', name: 'Estonia', region: 'europe', currency: 'EUR', thresholdCents: 0, inForceSince: '2024-12-30', change: null },
  { code: 'IE', name: 'Ireland', region: 'europe', currency: 'EUR', thresholdCents: 0, inForceSince: '2024-12-30', change: null },
  { code: 'DE', name: 'Germany', region: 'europe', currency: 'EUR', thresholdCents: 0, inForceSince: '2024-12-30', change: null },
  { code: 'MT', name: 'Malta', region: 'europe', currency: 'EUR', thresholdCents: 0, inForceSince: '2024-12-30', change: null },
  { code: 'CH', name: 'Switzerland', region: 'europe', currency: 'CHF', thresholdCents: 100000, inForceSince: '2021-01-01', change: { thresholdCents: 0, takesEffectOn: '2028-01-01' } },
  { code: 'GB', name: 'United Kingdom', region: 'europe', currency: 'GBP', thresholdCents: 84000, inForceSince: '2023-09-01', change: null },
  { code: 'SG', name: 'Singapore', region: 'asia_pacific', currency: 'SGD', thresholdCents: 150000, inForceSince: '2020-01-28', change: null },
  { code: 'HK', name: 'Hong Kong', region: 'asia_pacific', currency: 'HKD', thresholdCents: 800000, inForceSince: '2023-06-01', change: null },
  { code: 'AE', name: 'United Arab Emirates', region: 'middle_east', currency: 'AED', thresholdCents: null, inForceSince: null, change: { thresholdCents: 350000, takesEffectOn: '2028-03-01' } },
  { code: 'TH', name: 'Thailand', region: 'asia_pacific', currency: 'THB', thresholdCents: null, inForceSince: null, change: { thresholdCents: 5000000, takesEffectOn: '2028-07-01' } },
  { code: 'PA', name: 'Panama', region: 'americas', currency: 'USD', thresholdCents: null, inForceSince: null, change: null },
  { code: 'SC', name: 'Seychelles', region: 'africa', currency: 'USD', thresholdCents: null, inForceSince: null, change: null },
];

export const LISTINGS: { slug: string; name: string; jurisdictionCode: string; onNetwork: boolean }[] = [
  { slug: 'neris-digital', name: 'Neris Digital UAB', jurisdictionCode: 'LT', onNetwork: true },
  { slug: 'kallang-exchange', name: 'Kallang Exchange Pte. Ltd.', jurisdictionCode: 'SG', onNetwork: true },
  { slug: 'harbourgate-digital-assets', name: 'Harbourgate Digital Assets Ltd', jurisdictionCode: 'IE', onNetwork: true },
  { slug: 'tallinn-star-exchange', name: 'Tallinn Star Exchange OÜ', jurisdictionCode: 'EE', onNetwork: false },
  { slug: 'keystone-vault', name: 'Keystone Vault AG', jurisdictionCode: 'CH', onNetwork: true },
  { slug: 'sakura-vault-hk', name: 'Sakura Vault HK Limited', jurisdictionCode: 'HK', onNetwork: true },
  { slug: 'meridian-coin', name: 'Meridian Coin S.A.', jurisdictionCode: 'PA', onNetwork: false },
  { slug: 'baltic-rail-crypto', name: 'Baltic Rail Crypto UAB', jurisdictionCode: 'LT', onNetwork: true },
  { slug: 'nordlys-exchange', name: 'Nordlys Exchange Ltd', jurisdictionCode: 'SC', onNetwork: false },
  { slug: 'atlas-peak-digital', name: 'Atlas Peak Digital FZE', jurisdictionCode: 'AE', onNetwork: true },
  { slug: 'rheinmark-krypto', name: 'Rheinmark Krypto GmbH', jurisdictionCode: 'DE', onNetwork: true },
  { slug: 'valletta-blockworks', name: 'Valletta Blockworks Ltd', jurisdictionCode: 'MT', onNetwork: false },
  { slug: 'thamesgate-digital', name: 'Thamesgate Digital Ltd', jurisdictionCode: 'GB', onNetwork: true },
  { slug: 'chao-phraya-digital', name: 'Chao Phraya Digital Co., Ltd.', jurisdictionCode: 'TH', onNetwork: false },
  { slug: 'mahe-coin', name: 'Mahé Coin Ltd', jurisdictionCode: 'SC', onNetwork: false },
];

export const PARTNER_KEYS: { workspace: string; label: string; key: string }[] = [
  { workspace: 'neris', label: 'Neris core banking', key: 'lnlk_5e1f0a7c3b9d48e2a6f1c0d9b8e7a6f5' },
  { workspace: 'kallang', label: 'Kallang ledger', key: 'lnlk_9a2c4e6f8b0d1e3f5a7c9e1b3d5f7a90' },
];

export const SEEDED_MONTHS: { month: string; messages: number }[] = [
  { month: '-1', messages: 1002 },
  { month: '-2', messages: 1003 },
  { month: '-3', messages: 1215 },
];

export const TIER_PRICES: Record<string, { currency: string; tier1: number; tier2: number; tier3: number }[]> = {
  EUR: [{ currency: 'EUR', tier1: 4250, tier2: 2125, tier3: 1375 }],
  SGD: [{ currency: 'SGD', tier1: 6250, tier2: 3125, tier3: 2050 }],
};

export const TIERS = [
  { tier: 1, label: 'Tier 1: first 100 messages' },
  { tier: 2, label: 'Tier 2: messages 101 to 1,000' },
  { tier: 3, label: 'Tier 3: messages over 1,000' },
] as const;
