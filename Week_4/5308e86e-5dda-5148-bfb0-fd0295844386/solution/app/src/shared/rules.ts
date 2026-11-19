/** Business constants. Each rule is defined once here and imported wherever it is checked. */

export const APPROVAL_THRESHOLD_CENTS = 500_000;
export const DUAL_APPROVAL_THRESHOLD_CENTS = 5_000_000;
export const APPROVAL_BUSINESS_DAYS = 5;

export const ACH_CUTOFF_HOUR = 16;
export const WIRE_CUTOFF_HOUR = 17;

export const LOCKOUT_COUNT = 5;
export const INQUIRY_RATE_COUNT = 5;

export const PAYMENT_METHODS = ["ach", "wire", "rtp", "check"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const ACCOUNT_KINDS = ["checking", "savings", "treasury"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const TRANSACTION_METHODS = ["ach", "wire", "rtp", "check", "card", "transfer"] as const;
export type TransactionMethod = (typeof TRANSACTION_METHODS)[number];

export const DISPLAY_NAME_MAX = 120;
export const ACCOUNT_NAME_MAX = 60;
export const MEMO_MAX = 140;
export const INQUIRY_MESSAGE_MAX = 5000;
export const INQUIRY_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const SEARCH_LIMIT = 20;

export const FEED_PAGE = 50;
export const FEED_MAX_LIMIT = 100;
export const SPARKLINE_DAYS = 30;
export const STATEMENT_MONTHS = 12;

export const BODY_CAP_BYTES = 32_768;
export const IDEMPOTENCY_RETENTION_HOURS = 24;
export const MAX_DATABASE_CONNECTIONS = 10;

export const CURRENCY_RATES_PER_DOLLAR: Readonly<Record<string, { whole: number; scale: number }>> = {
  EUR: { whole: 9200, scale: 10_000 },
  GBP: { whole: 7900, scale: 10_000 },
  CAD: { whole: 13_600, scale: 10_000 },
};
export const QUOTE_FEE_PERCENT = 1;

export const SYSTEM_ACTOR = "system@tallwind.invalid";
export const REFRESH_SECONDS = 10;
export const APPROVALS_REFRESH_SECONDS = 5;
