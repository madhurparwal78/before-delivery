export type PlanCode = 'studio-monthly' | 'pro-monthly';

export interface PlanDefinition {
  readonly code: PlanCode;
  readonly name: 'Studio' | 'Pro';
  readonly priceCents: number;
  /** Credits granted on each Kill Bill-confirmed subscription invoice payment. */
  readonly credits: number;
  readonly description: string;
  readonly action: string;
}

export const PLANS: readonly PlanDefinition[] = [
  {
    code: 'studio-monthly',
    name: 'Studio',
    priceCents: 1200,
    credits: 300,
    description: '300 credits a month, billed monthly in advance.',
    action: 'Choose Studio',
  },
  {
    code: 'pro-monthly',
    name: 'Pro',
    priceCents: 3600,
    credits: 1500,
    description: '1,500 credits a month, billed monthly in advance.',
    action: 'Choose Pro',
  },
];

export const CREDIT_PACK = {
  code: 'pack-500',
  credits: 500,
  priceCents: 1900,
  description: 'Credit pack \u2014 500 credits',
  note: '500 credits, a one-off top-up with no plan.',
  action: 'Buy 500 credits',
} as const;

export function planByCode(code: PlanCode): PlanDefinition {
  const plan = PLANS.find((candidate) => candidate.code === code);
  if (!plan) throw new Error(`Unknown plan ${code}`);
  return plan;
}

export function isPlanCode(value: unknown): value is PlanCode {
  return value === 'studio-monthly' || value === 'pro-monthly';
}
