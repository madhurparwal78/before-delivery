// The shop's fixed lists from the brief: locales, scents, cadences, provinces, topics, batch states.
const LOCALES = ['en-CA', 'fr-CA'];
export const pick = (text, locale) => (locale === 'fr-CA' ? text.fr : text.en);
export const DROP_SCENTS = [
    {
        slug: 'lavender-oat',
        name: { en: 'Lavender & Oat', fr: 'Lavande et avoine' },
        tint: 'lilac',
        notes: { en: 'Lavender, colloidal oat, a little honey', fr: 'Lavande, avoine colloïdale, un peu de miel' },
    },
    {
        slug: 'smoked-birch',
        name: { en: 'Smoked Birch', fr: 'Bouleau fumé' },
        tint: 'ash',
        notes: { en: 'Birch tar, cedar leaf, black pepper', fr: 'Goudron de bouleau, feuille de cèdre, poivre noir' },
    },
    {
        slug: 'wild-mint',
        name: { en: 'Wild Mint', fr: 'Menthe sauvage' },
        tint: 'mint',
        notes: { en: 'Spearmint, nettle, green clay', fr: 'Menthe verte, ortie, argile verte' },
    },
    {
        slug: 'rose-clay',
        name: { en: 'Rose Clay', fr: 'Argile rose' },
        tint: 'rose',
        notes: { en: 'Rose geranium, pink kaolin', fr: 'Géranium rosat, kaolin rose' },
    },
];
export const CORE_SCENTS = [
    { slug: 'oat-milk', name: { en: 'Oat Milk', fr: "Lait d'avoine" } },
    { slug: 'cedar-sage', name: { en: 'Cedar & Sage', fr: 'Cèdre et sauge' } },
    { slug: 'unscented', name: { en: 'Unscented', fr: 'Sans parfum' } },
];
export const dropScent = (slug) => DROP_SCENTS.find((s) => s.slug === slug);
export const coreScent = (slug) => CORE_SCENTS.find((s) => s.slug === slug);
export const CADENCES = ['MONTHLY', 'BIMESTRIAL', 'QUARTERLY'];
export const CADENCE_MONTHS = { MONTHLY: 1, BIMESTRIAL: 2, QUARTERLY: 3 };
export const CADENCE_LABELS = {
    MONTHLY: { en: 'Every month', fr: 'Chaque mois' },
    BIMESTRIAL: { en: 'Every two months', fr: 'Tous les deux mois' },
    QUARTERLY: { en: 'Every three months', fr: 'Tous les trois mois' },
};
export const TAX_LABELS = {
    GST: { en: 'GST', fr: 'TPS' },
    QST: { en: 'QST', fr: 'TVQ' },
    HST: { en: 'HST', fr: 'TVH' },
};
const GST = { code: 'GST', rate: 5000, label: '5%' };
const QST = { code: 'QST', rate: 9975, label: '9.975%' };
const hst = (rate, label) => ({ code: 'HST', rate, label });
export const PROVINCES = [
    { code: 'AB', name: { en: 'Alberta', fr: 'Alberta' }, taxes: [GST] },
    { code: 'BC', name: { en: 'British Columbia', fr: 'Colombie-Britannique' }, taxes: [GST] },
    { code: 'MB', name: { en: 'Manitoba', fr: 'Manitoba' }, taxes: [GST] },
    { code: 'NB', name: { en: 'New Brunswick', fr: 'Nouveau-Brunswick' }, taxes: [hst(15000, '15%')] },
    { code: 'NL', name: { en: 'Newfoundland and Labrador', fr: 'Terre-Neuve-et-Labrador' }, taxes: [hst(15000, '15%')] },
    { code: 'NS', name: { en: 'Nova Scotia', fr: 'Nouvelle-Écosse' }, taxes: [hst(14000, '14%')] },
    { code: 'NT', name: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' }, taxes: [GST] },
    { code: 'NU', name: { en: 'Nunavut', fr: 'Nunavut' }, taxes: [GST] },
    { code: 'ON', name: { en: 'Ontario', fr: 'Ontario' }, taxes: [hst(13000, '13%')] },
    { code: 'PE', name: { en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard' }, taxes: [hst(15000, '15%')] },
    { code: 'QC', name: { en: 'Québec', fr: 'Québec' }, taxes: [GST, QST] },
    { code: 'SK', name: { en: 'Saskatchewan', fr: 'Saskatchewan' }, taxes: [GST] },
    { code: 'YT', name: { en: 'Yukon', fr: 'Yukon' }, taxes: [GST] },
];
export const province = (code) => PROVINCES.find((p) => p.code === code);
export const DEFAULT_PROVINCE = 'QC';
export const TOPICS = [
    { value: 'order', label: { en: 'Order question', fr: 'Question sur une commande' } },
    { value: 'subscription', label: { en: 'Subscription', fr: 'Abonnement' } },
    { value: 'wholesale', label: { en: 'Wholesale', fr: 'Vente en gros' } },
    { value: 'other', label: { en: 'Something else', fr: 'Autre chose' } },
];
const BATCH_STATES = ['poured', 'curing', 'scheduled', 'live', 'sold_out', 'withdrawn'];
export const BATCH_STATE_LABELS = {
    poured: { en: 'Poured', fr: 'Coulé' },
    curing: { en: 'Curing', fr: 'En cure' },
    scheduled: { en: 'Scheduled', fr: 'Programmé' },
    live: { en: 'Live', fr: 'En vente' },
    sold_out: { en: 'Sold out', fr: 'Épuisé' },
    withdrawn: { en: 'Withdrawn', fr: 'Retiré' },
};
export const STUDIO_ACCESS = {
    batches: ['maker'],
    packing: ['maker', 'packing'],
    money: ['maker', 'finance'],
    books: ['maker', 'finance'],
};
/** Studio pages in navigation order, with the area each belongs to. */
export const STUDIO_PAGES = [
    { slug: 'batches', area: 'batches' },
    { slug: 'packing', area: 'packing' },
    { slug: 'finance', area: 'money' },
    { slug: 'reconciliation', area: 'books' },
    { slug: 'audit', area: 'books' },
    { slug: 'notices', area: 'books' },
];
