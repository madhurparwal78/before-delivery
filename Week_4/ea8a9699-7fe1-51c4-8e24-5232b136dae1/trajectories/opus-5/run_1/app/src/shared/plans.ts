import type { PlanId } from './types.js';

export interface PlanDefinition {
  plan: PlanId;
  planName: string;
  seatCap: number;
  monthlyPrice: string;
}

export const plans: readonly PlanDefinition[] = [
  { plan: 'rushes-pro-5', planName: 'Pro 5 seats', seatCap: 5, monthlyPrice: '150.00' },
  { plan: 'rushes-pro-10', planName: 'Pro 10 seats', seatCap: 10, monthlyPrice: '280.00' },
  { plan: 'rushes-pro-25', planName: 'Pro 25 seats', seatCap: 25, monthlyPrice: '650.00' },
];

export function planById(plan: string): PlanDefinition | undefined {
  return plans.find((candidate) => candidate.plan === plan);
}

export function upgradesFrom(plan: PlanId): PlanDefinition[] {
  const current = planById(plan);
  if (!current) {
    return [];
  }
  return plans.filter((candidate) => candidate.seatCap > current.seatCap);
}
