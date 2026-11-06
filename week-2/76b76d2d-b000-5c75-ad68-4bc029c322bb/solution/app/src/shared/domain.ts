export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const FARES = ["regular", "reduced", "member", "member-guest", "group"] as const;
export type Fare = (typeof FARES)[number];

export const TIERS = ["friend", "cinephile", "projectionist"] as const;
export type Tier = (typeof TIERS)[number];

export const CADENCES = ["annual", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const FORMATS = ["35mm", "16mm", "DCP"] as const;
export const AUDITORIUMS = ["MH1", "MH2", "AC1"] as const;
export type AuditoriumCode = (typeof AUDITORIUMS)[number];

export const STEPUP_PURPOSES = ["checkout", "gift", "membership"] as const;
export type StepupPurpose = (typeof STEPUP_PURPOSES)[number];

export type SeasonState = "draft" | "scheduled" | "member-priority" | "on-sale" | "archived" | "withdrawn";
export type Role = "patron" | "door" | "programmer" | "finance";

export const UPLIFT_PRESETS = [200, 500, 1000] as const;

export const FARE_LABELS: Record<Fare, Record<Locale, string>> = {
  regular: { en: "Regular", fr: "Ordinaire" },
  reduced: { en: "Reduced (student, 65+)", fr: "Réduit (étudiant, 65 ans et plus)" },
  member: { en: "Member", fr: "Membre" },
  "member-guest": { en: "Member guest", fr: "Invité de membre" },
  group: { en: "Group", fr: "Groupe" },
};

export const TIER_LABELS: Record<Tier, Record<Locale, string>> = {
  friend: { en: "Friend", fr: "Ami" },
  cinephile: { en: "Cinephile", fr: "Cinéphile" },
  projectionist: { en: "Projectionist", fr: "Projectionniste" },
};

export const CADENCE_LABELS: Record<Cadence, Record<Locale, string>> = {
  annual: { en: "Annual", fr: "Annuelle" },
  monthly: { en: "Monthly", fr: "Mensuelle" },
};

/** Membership and gift prices in cents, tax included (brief: Prices). */
export const TIER_PRICES: Record<Tier, Record<Cadence, number>> = {
  friend: { annual: 6000, monthly: 600 },
  cinephile: { annual: 12000, monthly: 1200 },
  projectionist: { annual: 24000, monthly: 2400 },
};

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "fr";
}

/** `<amount>`: integer cents formatted for a locale, with no floating-point step. */
export function formatMoney(cents: number, locale: Locale): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String((abs - (abs % 100)) / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const groups: string[] = [];
  for (let end = whole.length; end > 0; end -= 3) groups.unshift(whole.slice(Math.max(0, end - 3), end));
  if (locale === "en") return `${sign}$${groups.join(",")}.${frac}`;
  return `${sign}${groups.join(" ")},${frac} $`;
}

/** Seat order: row letter, then number. */
export function compareSeats(a: string, b: string): number {
  const row = a.charCodeAt(0) - b.charCodeAt(0);
  return row !== 0 ? row : Number(a.slice(1)) - Number(b.slice(1));
}
