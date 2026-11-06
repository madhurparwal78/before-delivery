import type { BatchState, Cadence, ContactTopic, Locale } from './types.js';

export type Bilingual = { 'en-CA': string; 'fr-CA': string };

export type DropScent = {
  slug: string;
  name: Bilingual;
  tint: string;
  notes: Bilingual;
};

export const DROP_SCENTS: readonly DropScent[] = [
  {
    slug: 'lavender-oat',
    name: { 'en-CA': 'Lavender & Oat', 'fr-CA': 'Lavande et avoine' },
    tint: 'lilac',
    notes: {
      'en-CA': 'Lavender, colloidal oat, a little honey',
      'fr-CA': 'Lavande, avoine colloïdale, un peu de miel',
    },
  },
  {
    slug: 'smoked-birch',
    name: { 'en-CA': 'Smoked Birch', 'fr-CA': 'Bouleau fumé' },
    tint: 'ash',
    notes: {
      'en-CA': 'Birch tar, cedar leaf, black pepper',
      'fr-CA': 'Goudron de bouleau, feuille de cèdre, poivre noir',
    },
  },
  {
    slug: 'wild-mint',
    name: { 'en-CA': 'Wild Mint', 'fr-CA': 'Menthe sauvage' },
    tint: 'mint',
    notes: {
      'en-CA': 'Spearmint, nettle, green clay',
      'fr-CA': 'Menthe verte, ortie, argile verte',
    },
  },
  {
    slug: 'rose-clay',
    name: { 'en-CA': 'Rose Clay', 'fr-CA': 'Argile rose' },
    tint: 'rose',
    notes: {
      'en-CA': 'Rose geranium, pink kaolin',
      'fr-CA': 'Géranium rosat, kaolin rose',
    },
  },
];

const DROP_SCENT_BY_SLUG = new Map(DROP_SCENTS.map((scent) => [scent.slug, scent]));

export function dropScent(slug: string): DropScent | undefined {
  return DROP_SCENT_BY_SLUG.get(slug);
}

export type TrioScent = { slug: string; name: Bilingual };

export const TRIO_SCENTS: readonly TrioScent[] = [
  { slug: 'oat-milk', name: { 'en-CA': 'Oat Milk', 'fr-CA': "Lait d'avoine" } },
  { slug: 'cedar-sage', name: { 'en-CA': 'Cedar & Sage', 'fr-CA': 'Cèdre et sauge' } },
  { slug: 'unscented', name: { 'en-CA': 'Unscented', 'fr-CA': 'Sans parfum' } },
];

const TRIO_SCENT_BY_SLUG = new Map(TRIO_SCENTS.map((scent) => [scent.slug, scent]));

/** Scent names reach emails and Kill Bill descriptions in English. */
export function scentName(slug: string, locale: Locale): string {
  const scent = DROP_SCENT_BY_SLUG.get(slug) ?? TRIO_SCENT_BY_SLUG.get(slug);
  return scent ? scent.name[locale] : slug;
}

export const CADENCES: readonly Cadence[] = ['MONTHLY', 'BIMESTRIAL', 'QUARTERLY'];

export const CADENCE_MONTHS: Record<Cadence, number> = {
  MONTHLY: 1,
  BIMESTRIAL: 2,
  QUARTERLY: 3,
};

export const CADENCE_LABELS: Record<Cadence, Bilingual> = {
  MONTHLY: { 'en-CA': 'Every month', 'fr-CA': 'Chaque mois' },
  BIMESTRIAL: { 'en-CA': 'Every two months', 'fr-CA': 'Tous les deux mois' },
  QUARTERLY: { 'en-CA': 'Every three months', 'fr-CA': 'Tous les trois mois' },
};

export function cadencePlanName(cadence: Cadence): string {
  return `trio-${cadence.toLowerCase()}`;
}

export const CONTACT_TOPICS: readonly ContactTopic[] = ['order', 'subscription', 'wholesale', 'other'];

export const CONTACT_TOPIC_LABELS: Record<ContactTopic, Bilingual> = {
  order: { 'en-CA': 'Order question', 'fr-CA': 'Question sur une commande' },
  subscription: { 'en-CA': 'Subscription', 'fr-CA': 'Abonnement' },
  wholesale: { 'en-CA': 'Wholesale', 'fr-CA': 'Vente en gros' },
  other: { 'en-CA': 'Something else', 'fr-CA': 'Autre chose' },
};

export const BATCH_STATE_LABELS: Record<BatchState, Bilingual> = {
  poured: { 'en-CA': 'Poured', 'fr-CA': 'Coulé' },
  curing: { 'en-CA': 'Curing', 'fr-CA': 'En cure' },
  scheduled: { 'en-CA': 'Scheduled', 'fr-CA': 'Programmé' },
  live: { 'en-CA': 'Live', 'fr-CA': 'En vente' },
  sold_out: { 'en-CA': 'Sold out', 'fr-CA': 'Épuisé' },
  withdrawn: { 'en-CA': 'Withdrawn', 'fr-CA': 'Retiré' },
};
