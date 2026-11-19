export const FEE_MIN_CENTS = 100;
export const FEE_MAX_CENTS = 100_000_000;

export type MilestoneNumber = 1 | 2 | 3 | 4;

export type MilestoneDefinition = {
  number: MilestoneNumber;
  name: string;
  percent: number;
};

export const MILESTONE_DEFINITIONS: readonly MilestoneDefinition[] = [
  { number: 1, name: 'Deposit', percent: 30 },
  { number: 2, name: 'Vertical slice', percent: 20 },
  { number: 3, name: 'Content complete', percent: 20 },
  { number: 4, name: 'Final delivery', percent: 30 },
];

export type Milestone = {
  number: MilestoneNumber;
  name: string;
  percent: number;
  amount_cents: number;
};

/** The 30/20/20/30 split. Milestones 1 to 3 round down; milestone 4 takes the remainder. */
export function splitMilestones(feeCents: number): Milestone[] {
  const leading = MILESTONE_DEFINITIONS.slice(0, 3).map((definition) => ({
    ...definition,
    amount_cents: Math.floor((feeCents * definition.percent) / 100),
  }));
  const remainder = feeCents - leading.reduce((total, milestone) => total + milestone.amount_cents, 0);
  const final = MILESTONE_DEFINITIONS[3] as MilestoneDefinition;
  return [...leading, { ...final, amount_cents: remainder }];
}

export function milestoneDescription(number: MilestoneNumber, reference: string): string {
  const definition = MILESTONE_DEFINITIONS[number - 1] as MilestoneDefinition;
  return `Milestone ${number} of 4: ${definition.name} (${reference})`;
}

/** Integer cents written as decimal dollars with exactly two decimals, without floating-point maths. */
export function centsToDecimalString(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

/** Decimal digits from Kill Bill converted back to integer cents with no rounding step. */
export function decimalStringToCents(value: string | number): number {
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new Error('Cannot read a money value from Kill Bill');
  const sign = match[1] as string;
  const whole = match[2] as string;
  const fraction = (match[3] ?? '').padEnd(2, '0').slice(0, 2);
  const cents = Number(`${whole}${fraction}`);
  return sign === '-' ? -cents : cents;
}

/** `$1,499.99` */
export function formatMoney(cents: number): string {
  const decimal = centsToDecimalString(Math.abs(cents));
  const parts = decimal.split('.');
  const whole = (parts[0] ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${whole}.${parts[1] ?? '00'}`;
}

/** `30%` */
export function formatShare(percent: number): string {
  return `${percent}%`;
}

/** Plain decimal dollars, optional comma thousands separators, at most two decimals. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(trimmed) && !/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const parts = trimmed.replace(/,/g, '').split('.');
  const fraction = (parts[1] ?? '').padEnd(2, '0');
  return Number(`${parts[0] ?? '0'}${fraction}`);
}
