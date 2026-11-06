export type PlanName = 'free' | 'basic' | 'pro' | 'premium';

export const PLAN_NAMES: readonly PlanName[] = ['free', 'basic', 'pro', 'premium'];

export function isPlanName(v: unknown): v is PlanName {
  return v === 'free' || v === 'basic' || v === 'pro' || v === 'premium';
}

export type PackageKind = 'gltf-binary' | 'gltf-package';

export interface Plan {
  readonly name: PlanName;
  readonly label: string;
  /** Kill Bill plan name and product. */
  readonly killbillPlan: string;
  readonly killbillProduct: string;
  readonly monthlyPriceCents: number;
  /** A file of exactly this many bytes is accepted; one byte more is refused. */
  readonly maxPackageBytes: number;
  readonly packages: readonly PackageKind[];
  /** `null` means no limit. */
  readonly publishesPerCycle: number | null;
  readonly publishedWithinPlan: number | null;
  readonly embeds: boolean;
  readonly editions: boolean;
  readonly readKeys: number;
  /** Rank used to tell an upgrade from a downgrade. */
  readonly rank: number;
}

const BINARY_ONLY: readonly PackageKind[] = ['gltf-binary'];
const BOTH: readonly PackageKind[] = ['gltf-binary', 'gltf-package'];

export const PLANS: Readonly<Record<PlanName, Plan>> = {
  free: {
    name: 'free',
    label: 'Free',
    killbillPlan: 'turnstone-free-monthly',
    killbillProduct: 'Free',
    monthlyPriceCents: 0,
    maxPackageBytes: 2_000_000,
    packages: BINARY_ONLY,
    publishesPerCycle: 3,
    publishedWithinPlan: 5,
    embeds: false,
    editions: false,
    readKeys: 0,
    rank: 0,
  },
  basic: {
    name: 'basic',
    label: 'Basic',
    killbillPlan: 'turnstone-basic-monthly',
    killbillProduct: 'Basic',
    monthlyPriceCents: 900,
    maxPackageBytes: 8_000_000,
    packages: BOTH,
    publishesPerCycle: 10,
    publishedWithinPlan: 30,
    embeds: false,
    editions: false,
    readKeys: 1,
    rank: 1,
  },
  pro: {
    name: 'pro',
    label: 'Pro',
    killbillPlan: 'turnstone-pro-monthly',
    killbillProduct: 'Pro',
    monthlyPriceCents: 1900,
    maxPackageBytes: 25_000_000,
    packages: BOTH,
    publishesPerCycle: 40,
    publishedWithinPlan: 200,
    embeds: true,
    editions: true,
    readKeys: 5,
    rank: 2,
  },
  premium: {
    name: 'premium',
    label: 'Premium',
    killbillPlan: 'turnstone-premium-monthly',
    killbillProduct: 'Premium',
    monthlyPriceCents: 3900,
    maxPackageBytes: 100_000_000,
    packages: BOTH,
    publishesPerCycle: null,
    publishedWithinPlan: null,
    embeds: true,
    editions: true,
    readKeys: 20,
    rank: 3,
  },
};

export function plan(name: PlanName): Plan {
  return PLANS[name];
}

export function planByKillbillPlanName(killbillPlan: string): PlanName | null {
  for (const name of PLAN_NAMES) {
    if (PLANS[name].killbillPlan === killbillPlan) return name;
  }
  return null;
}

export function isUpgrade(from: PlanName, to: PlanName): boolean {
  return PLANS[to].rank > PLANS[from].rank;
}

export function acceptsPackage(name: PlanName, kind: PackageKind): boolean {
  return PLANS[name].packages.includes(kind);
}
