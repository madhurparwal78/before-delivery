import type { Currency } from "./money.ts";

export type Town = "Turin" | "London" | "New York" | "Kyoto" | "Dubai";
export type Language = "en" | "it" | "ja" | "ar";

interface TownFacts {
  zone: string;
  currency: Currency;
  taxPercent: number;
  language: Language;
}

export const TOWNS: Record<Town, TownFacts> = {
  Turin: { zone: "Europe/Rome", currency: "EUR", taxPercent: 22, language: "it" },
  London: { zone: "Europe/London", currency: "GBP", taxPercent: 20, language: "en" },
  "New York": { zone: "America/New_York", currency: "USD", taxPercent: 0, language: "en" },
  Kyoto: { zone: "Asia/Tokyo", currency: "JPY", taxPercent: 0, language: "ja" },
  Dubai: { zone: "Asia/Dubai", currency: "AED", taxPercent: 0, language: "ar" },
};

/** Arabic reads right to left; every other language of the client page left to right. */
export function directionOf(language: string): "rtl" | "ltr" {
  return language === "ar" ? "rtl" : "ltr";
}

export const TOWN_NAMES = Object.keys(TOWNS) as Town[];
export const LANGUAGES: readonly Language[] = ["en", "it", "ja", "ar"];
export const TURIN_ZONE = TOWNS.Turin.zone;
