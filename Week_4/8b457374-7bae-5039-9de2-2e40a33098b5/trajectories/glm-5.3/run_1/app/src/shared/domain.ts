// Shared domain types and constants used by both server and frontend builds.

export type CampaignStatus =
  | "draft"
  | "live"
  | "funded"
  | "collecting"
  | "settled"
  | "unfunded"
  | "cancelled";

export type PledgeState =
  | "authorising"
  | "authorised"
  | "captured"
  | "errored"
  | "voided"
  | "dropped";

export type Zone = "domestic" | "europe" | "rest_of_world";

export type MediaKind = "cover" | "spread";
export type MediaStatus = "stored" | "uploading" | "failed";

export interface Country {
  readonly code: string;
  readonly name: string;
  readonly zone: "europe" | "rest_of_world";
}

export const COUNTRIES: readonly Country[] = [
  { code: "AT", name: "Austria", zone: "europe" },
  { code: "AU", name: "Australia", zone: "rest_of_world" },
  { code: "BE", name: "Belgium", zone: "europe" },
  { code: "BR", name: "Brazil", zone: "rest_of_world" },
  { code: "CA", name: "Canada", zone: "rest_of_world" },
  { code: "CH", name: "Switzerland", zone: "europe" },
  { code: "DE", name: "Germany", zone: "europe" },
  { code: "DK", name: "Denmark", zone: "europe" },
  { code: "ES", name: "Spain", zone: "europe" },
  { code: "FI", name: "Finland", zone: "europe" },
  { code: "FR", name: "France", zone: "europe" },
  { code: "GB", name: "United Kingdom", zone: "europe" },
  { code: "IE", name: "Ireland", zone: "europe" },
  { code: "IT", name: "Italy", zone: "europe" },
  { code: "JP", name: "Japan", zone: "rest_of_world" },
  { code: "MX", name: "Mexico", zone: "rest_of_world" },
  { code: "NL", name: "Netherlands", zone: "europe" },
  { code: "NZ", name: "New Zealand", zone: "rest_of_world" },
  { code: "NO", name: "Norway", zone: "europe" },
  { code: "PL", name: "Poland", zone: "europe" },
  { code: "PT", name: "Portugal", zone: "europe" },
  { code: "SE", name: "Sweden", zone: "europe" },
  { code: "SG", name: "Singapore", zone: "rest_of_world" },
  { code: "US", name: "United States", zone: "rest_of_world" },
];

export const COUNTRY_BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((c) => [c.code, c]),
);

export const ZONE_NAMES: Readonly<Record<Zone, string>> = {
  domestic: "Domestic",
  europe: "Europe",
  rest_of_world: "Rest of world",
};

export type CardBehaviour = "authorise_capture" | "decline_auth" | "fail_capture";

const CARD_BEHAVIOURS: ReadonlyMap<string, CardBehaviour> = new Map([
  ["4242424242424242", "authorise_capture"],
  ["4000000000000002", "decline_auth"],
  ["4000000000000341", "fail_capture"],
]);

/** Spaces are ignored in card numbers. Returns null when the number is not a test card. */
export function cardBehaviour(raw: string): CardBehaviour | null {
  const digits = raw.replace(/ /g, "");
  return CARD_BEHAVIOURS.get(digits) ?? null;
}
