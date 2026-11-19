export const MAX_JSON_BYTES = 65_536;
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 2_000;
export const SUGGESTION_LIMIT = 8;

export const TASK_ESTIMATE_MIN = 5;
export const TASK_ESTIMATE_MAX = 600;
export const TASK_ESTIMATE_STEP = 5;
export const ROUTINE_MINUTES_MIN = 5;
export const ROUTINE_MINUTES_MAX = 240;
export const ROUTINE_MINUTES_STEP = 5;
export const DEFAULT_THRESHOLD = 360;
export const FEED_TOKEN_BYTES = 32;

export interface PlanBounds {
  readonly planName: string;
  readonly product: string;
  readonly priceList: string;
  readonly currency: string;
  readonly trialPhaseDays: number;
  readonly monthlyPrice: string;
}

export const DAYBOOK_PLAN: PlanBounds = {
  planName: 'daybook-seat-monthly',
  product: 'Daybook',
  priceList: 'DEFAULT',
  currency: 'USD',
  trialPhaseDays: 14,
  monthlyPrice: '12.00',
};

export interface FeedWindow {
  readonly daysBack: number;
  readonly daysForward: number;
}

export const FEED_WINDOW: FeedWindow = { daysBack: 7, daysForward: 28 };

export const DAILY_RITUAL_STEPS = ['Pull', 'Estimate', 'Check', 'Timebox', 'Shut down'] as const;
export type RitualStep = (typeof DAILY_RITUAL_STEPS)[number];

export const ESTIMATE_CHOICES: readonly number[] = [15, 30, 45, 60, 90, 120];

export const ESTIMATE_CHOICE_LABEL: Record<number, string> = {
  15: '15m',
  30: '30m',
  45: '45m',
  60: '60m',
  90: '90m',
  120: '2h',
};
