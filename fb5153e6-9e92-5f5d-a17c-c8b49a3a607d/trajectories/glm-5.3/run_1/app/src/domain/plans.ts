export type PlanId = 'free' | 'basic' | 'pro' | 'premium';
export type PackageKind = 'glb' | 'gltf-package';

export interface Plan {
  id: PlanId;
  monthlyCents: number;
  maxPackageBytes: number;
  packages: PackageKind[];
  publishesPerCycle: number | null;
  publishedModelsLimit: number | null;
  embeds: boolean;
  editions: boolean;
  apiKeys: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    monthlyCents: 0,
    maxPackageBytes: 2_000_000,
    packages: ['glb'],
    publishesPerCycle: 3,
    publishedModelsLimit: 5,
    embeds: false,
    editions: false,
    apiKeys: 0,
  },
  basic: {
    id: 'basic',
    monthlyCents: 900,
    maxPackageBytes: 8_000_000,
    packages: ['glb', 'gltf-package'],
    publishesPerCycle: 10,
    publishedModelsLimit: 30,
    embeds: false,
    editions: false,
    apiKeys: 1,
  },
  pro: {
    id: 'pro',
    monthlyCents: 1900,
    maxPackageBytes: 25_000_000,
    packages: ['glb', 'gltf-package'],
    publishesPerCycle: 40,
    publishedModelsLimit: 200,
    embeds: true,
    editions: true,
    apiKeys: 5,
  },
  premium: {
    id: 'premium',
    monthlyCents: 3900,
    maxPackageBytes: 100_000_000,
    packages: ['glb', 'gltf-package'],
    publishesPerCycle: null,
    publishedModelsLimit: null,
    embeds: true,
    editions: true,
    apiKeys: 20,
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'basic', 'pro', 'premium'];

export const planOf = (id: string): Plan => PLANS[(PLAN_ORDER as string[]).includes(id) ? (id as PlanId) : 'free'];

export const planLabel = (id: PlanId): string => id.charAt(0).toUpperCase() + id.slice(1);

export const planFromKbPlanName = (planName: string): PlanId => {
  const suffix = planName.replace(/^turnstone-/, '').replace(/-monthly$/, '');
  return (PLAN_ORDER as string[]).includes(suffix) ? (suffix as PlanId) : 'free';
};

export const kbPlanNameOf = (id: PlanId): string => `turnstone-${id}-monthly`;

export function isUpgrade(from: PlanId, to: PlanId): boolean {
  return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}
