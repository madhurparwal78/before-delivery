export const FEED_PAGE_SIZE = 20;
export const REFERENCE_PAGE_SIZE = 50;
export const SEARCH_DEBOUNCE_MS = 250;
export const SETTINGS_REFRESH_MS = 25_000;
export const STORAGE_RETRY_MS = 25_000;
export const MAX_EXPLORE_PAGES = 10;

export const PLAN_NAMES: Record<string, string> = {
  'rushes-pro-5': 'Pro 5 seats',
  'rushes-pro-10': 'Pro 10 seats',
  'rushes-pro-25': 'Pro 25 seats',
};

export const PLAN_SEATS: Record<string, number> = {
  'rushes-pro-5': 5,
  'rushes-pro-10': 10,
  'rushes-pro-25': 25,
};

export const PLAN_PRICES: Record<string, string> = {
  'rushes-pro-5': '150.00',
  'rushes-pro-10': '280.00',
  'rushes-pro-25': '650.00',
};

export const ALL_PLANS = ['rushes-pro-5', 'rushes-pro-10', 'rushes-pro-25'] as const;
export type PlanId = (typeof ALL_PLANS)[number];

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_review: 'In review',
  embargoed: 'Embargoed',
  public: 'Public',
  withdrawn: 'Withdrawn',
};

export function isPlanId(v: string): v is PlanId {
  return (ALL_PLANS as readonly string[]).includes(v);
}
