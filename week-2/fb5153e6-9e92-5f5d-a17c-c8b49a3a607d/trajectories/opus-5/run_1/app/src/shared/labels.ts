import type { Locale } from './locale.js';
import type { StringKey } from './strings.js';
import { s } from './strings.js';

function labeller<K extends string>(
  map: Readonly<Record<K, StringKey>>,
): (key: K, locale: Locale) => string {
  return (key, locale) => s(map[key], locale);
}

export const licenceLabel = labeller({
  personal: 'licPersonal',
  commercial: 'licCommercial',
  studio: 'licStudio',
  edition: 'licPersonal',
} as const);

export const categoryLabel = labeller({
  'hard-surface': 'catHardSurface',
  miniature: 'catMiniature',
  scan: 'catScan',
} as const);

export const formatLabel = labeller({ glb: 'fmtGlb', stl: 'fmtStl' } as const);

export const sortLabel = labeller({
  newest: 'sortNewest',
  price_asc: 'sortPriceAsc',
  price_desc: 'sortPriceDesc',
} as const);

export const visibilityLabel = labeller({
  public: 'visPublic',
  unlisted: 'visUnlisted',
  private: 'visPrivate',
  password: 'visPassword',
} as const);

export const stateLabel = labeller({
  draft: 'stateDraft',
  in_review: 'stateInReview',
  published: 'statePublished',
  withdrawn: 'stateWithdrawn',
} as const);

export const stageLabel = labeller({
  validate: 'stageValidate',
  transcode: 'stageTranscode',
  preview: 'stagePreview',
  index: 'stageIndex',
  publish: 'stagePublish',
} as const);

export const stageStatusLabel = labeller({
  pending: 'statusPending',
  running: 'statusRunning',
  confirmed: 'statusConfirmed',
  failed: 'statusFailed',
} as const);

export const orderStatusLabel = labeller({
  paid: 'orderPaid',
  partially_refunded: 'orderPartiallyRefunded',
  refunded: 'orderRefunded',
} as const);

export const queueStatusLabel = labeller({
  in_progress: 'queueInProgress',
  completed: 'queueCompleted',
  failed: 'queueFailed',
  none: 'queueNone',
} as const);

export const serviceLabel = labeller({
  database: 'svcDatabase',
  storage: 'svcStorage',
  search: 'svcSearch',
  billing: 'svcBilling',
  mail: 'svcMail',
} as const);

export const serviceStateLabel = labeller({ up: 'svcUp', down: 'svcDown' } as const);

export const sourceUnitLabel = labeller({
  mm: 'unitMm',
  cm: 'unitCm',
  m: 'unitM',
  in: 'unitIn',
} as const);

export const totalLabel = labeller({
  public: 'totalPublic',
  unlisted: 'totalUnlisted',
  password: 'totalPassword',
  private: 'totalPrivate',
  draft: 'totalDrafts',
  in_review: 'totalInReview',
  withdrawn: 'totalWithdrawn',
} as const);
