/** Display edges for the staff pages: words for states, people-readable instants, percentages in whole basis points. */

export const humanise = (state: string): string => state.replace(/_/g, " ");

const INSTANT = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Copenhagen" });

export const formatInstant = (iso: string): string => INSTANT.format(new Date(iso));

/** The seed rate is in force from the very start, stored as instant zero; every later rate has its own instant. */
export const formatRateStart = (iso: string): string => (Date.parse(iso) === 0 ? "The start of the edition" : formatInstant(iso));

/** 3150 -> "31.5%", 3300 -> "33%". */
export const formatPercent = (basisPoints: number): string => {
  const hundredths = String(basisPoints % 100).padStart(2, "0").replace(/0$/, "");
  return `${Math.floor(basisPoints / 100)}${hundredths ? `.${hundredths}` : ""}%`;
};

/** "33" or "33.5" or "33,25" -> basis points as an integer, or null when it is not a percentage. */
export const parsePercent = (text: string): number | null => {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
};
