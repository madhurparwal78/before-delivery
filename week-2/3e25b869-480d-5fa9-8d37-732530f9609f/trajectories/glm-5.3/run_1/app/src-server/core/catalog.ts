// Locale-dependent shared constants: scents, cadences, topics, batch states.
// The canonical copies live here for the server; the client bundles its own view.

export type Locale = "fr-CA" | "en-CA";

export interface Scent {
  slug: string;
  en: string;
  fr: string;
  tint: string;
  notesEn: string;
  notesFr: string;
}

export const DROP_SCENTS: readonly Scent[] = [
  { slug: "lavender-oat", en: "Lavender & Oat", fr: "Lavande et avoine", tint: "lilac",
    notesEn: "Lavender, colloidal oat, a little honey", notesFr: "Lavande, avoine colloïdale, un peu de miel" },
  { slug: "smoked-birch", en: "Smoked Birch", fr: "Bouleau fumé", tint: "ash",
    notesEn: "Birch tar, cedar leaf, black pepper", notesFr: "Goudron de bouleau, feuille de cèdre, poivre noir" },
  { slug: "wild-mint", en: "Wild Mint", fr: "Menthe sauvage", tint: "mint",
    notesEn: "Spearmint, nettle, green clay", notesFr: "Menthe verte, ortie, argile verte" },
  { slug: "rose-clay", en: "Rose Clay", fr: "Argile rose", tint: "rose",
    notesEn: "Rose geranium, pink kaolin", notesFr: "Géranium rosat, kaolin rose" }
];

export interface CoreScent {
  slug: string;
  en: string;
  fr: string;
}

export const TRIO_SCENTS: readonly CoreScent[] = [
  { slug: "oat-milk", en: "Oat Milk", fr: "Lait d'avoine" },
  { slug: "cedar-sage", en: "Cedar & Sage", fr: "Cèdre et sauge" },
  { slug: "unscented", en: "Unscented", fr: "Sans parfum" }
];

export type Cadence = "MONTHLY" | "BIMESTRIAL" | "QUARTERLY";

export const CADENCE_MONTHS: Record<Cadence, number> = { MONTHLY: 1, BIMESTRIAL: 2, QUARTERLY: 3 };

export function cadenceLabel(cadence: Cadence, locale: Locale): string {
  if (locale === "fr-CA") {
    return cadence === "MONTHLY" ? "Chaque mois" : cadence === "BIMESTRIAL" ? "Tous les deux mois" : "Tous les trois mois";
  }
  return cadence === "MONTHLY" ? "Every month" : cadence === "BIMESTRIAL" ? "Every two months" : "Every three months";
}

export type ContactTopic = "order" | "subscription" | "wholesale" | "other";

export function topicLabel(topic: ContactTopic, locale: Locale): string {
  if (locale === "fr-CA") {
    return topic === "order" ? "Question sur une commande" : topic === "subscription" ? "Abonnement" : topic === "wholesale" ? "Vente en gros" : "Autre chose";
  }
  return topic === "order" ? "Order question" : topic === "subscription" ? "Subscription" : topic === "wholesale" ? "Wholesale" : "Something else";
}

export type BatchState = "poured" | "curing" | "scheduled" | "live" | "sold_out" | "withdrawn";

export function batchStateLabel(state: BatchState, locale: Locale): string {
  const en: Record<BatchState, string> = { poured: "Poured", curing: "Curing", scheduled: "Scheduled", live: "Live", sold_out: "Sold out", withdrawn: "Withdrawn" };
  const fr: Record<BatchState, string> = { poured: "Coulé", curing: "En cure", scheduled: "Programmé", live: "En vente", sold_out: "Épuisé", withdrawn: "Retiré" };
  return locale === "fr-CA" ? fr[state] : en[state];
}
