import { CURRENCIES, minorToMajor, type Currency } from '../../shared/money.js';
import { TIER_KEYS, TIER_NAMES, type TierKey } from '../../shared/copy.js';
import { compareDayKeys, dayKeyToInstant, lisbonDayKey } from '../../shared/lisbon.js';
import { query } from '../db/index.js';
import {
  BASE_CATALOG_DATE_MS,
  TICKET_PLAN,
  TIER_PLANS,
  TIER_PRODUCTS,
  readCatalogVersions,
  uploadCatalog,
  type CatalogVersion,
} from '../services/killbill.js';
import type { Catalog, ScheduledPriceChange } from '../../shared/types.js';

/** The seeded Kill Bill catalog, in minor units. */
export const SEED_PRICES: Record<'ticket' | TierKey, Record<Currency, number>> = {
  ticket: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
  reader: { EUR: 500, GBP: 400, USD: 600, JPY: 800 },
  fellow: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
  patron: { EUR: 3000, GBP: 2600, USD: 3500, JPY: 5000 },
};

export const DONATION_LIMITS: Record<'min' | 'max', Record<Currency, number>> = {
  min: { EUR: 100, GBP: 100, USD: 100, JPY: 100 },
  max: { EUR: 500_000, GBP: 500_000, USD: 500_000, JPY: 500_000 },
};

export interface PriceChangeRow {
  id: string;
  tier: TierKey;
  currency: Currency;
  amount_minor: string;
  effective_on: Date;
}

export interface PriceChange {
  tier: TierKey;
  currency: Currency;
  amountMinor: number;
  effectiveOn: string;
}

export async function readPriceChanges(): Promise<PriceChange[]> {
  const rows = await query<PriceChangeRow>(
    `SELECT id::text, tier, currency, amount_minor::text, effective_on FROM plan_price_changes ORDER BY effective_on, id`,
  );
  return rows.map((row) => ({
    tier: row.tier,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    effectiveOn: lisbonDayKey(row.effective_on.getTime()),
  }));
}

/**
 * The one place a tier price for a currency and day is decided: the seeded catalog price,
 * overridden by the latest change effective on or before that day.
 */
export function tierPriceOn(changes: PriceChange[], tier: TierKey, currency: Currency, dayKey: string): number {
  let price = SEED_PRICES[tier][currency];
  for (const change of changes) {
    if (change.tier === tier && change.currency === currency && compareDayKeys(change.effectiveOn, dayKey) <= 0) {
      price = change.amountMinor;
    }
  }
  return price;
}

/** Changes still ahead of today, as shown on the Support page and the plan dialog. */
export function upcomingChanges(changes: PriceChange[], tier: TierKey, todayKey: string): ScheduledPriceChange[] {
  return changes
    .filter((change) => change.tier === tier && compareDayKeys(change.effectiveOn, todayKey) > 0)
    .map((change) => ({
      currency: change.currency,
      amount_minor: change.amountMinor,
      effective_on: change.effectiveOn,
    }));
}

/* ------------------------------------------------------- catalog versions */

function priceRows(prices: Record<Currency, number>): string {
  return CURRENCIES.map(
    (currency) =>
      `            <price><currency>${currency}</currency><value>${minorToMajor(prices[currency], currency)}</value></price>`,
  ).join('\n');
}

function tierPlanXml(tier: TierKey, prices: Record<Currency, number>, existingFrom: string | null): string {
  return `    <plan name="${TIER_PLANS[tier]}">
${existingFrom ? `      <effectiveDateForExistingSubscriptions>${existingFrom}</effectiveDateForExistingSubscriptions>\n` : ''}      <product>${TIER_PRODUCTS[tier]}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
${priceRows(prices)}
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

export function catalogXml(effectiveDateIso: string, changes: PriceChange[], dayKey: string, isBase: boolean): string {
  const tierPrices = (tier: TierKey): Record<Currency, number> =>
    Object.fromEntries(CURRENCIES.map((currency) => [currency, tierPriceOn(changes, tier, currency, dayKey)])) as Record<
      Currency,
      number
    >;
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effectiveDateIso}</effectiveDate>
  <catalogName>Sightline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
${CURRENCIES.map((currency) => `    <currency>${currency}</currency>`).join('\n')}
  </currencies>
  <products>
${TIER_KEYS.map((tier) => `    <product name="${TIER_PRODUCTS[tier]}">\n      <category>BASE</category>\n    </product>`).join('\n')}
    <product name="GuidedSessionTicket">
      <category>STANDALONE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_SUBSCRIPTION</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>END_OF_TERM</policy>
      </cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
      </createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase>
        <alignment>SUBSCRIPTION</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
${TIER_KEYS.map((tier) => tierPlanXml(tier, tierPrices(tier), isBase ? null : effectiveDateIso)).join('\n')}
    <plan name="${TICKET_PLAN}">
      <product>GuidedSessionTicket</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <fixed>
          <fixedPrice>
${priceRows(SEED_PRICES.ticket)}
          </fixedPrice>
        </fixed>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${TIER_KEYS.map((tier) => `        <plan>${TIER_PLANS[tier]}</plan>`).join('\n')}
        <plan>${TICKET_PLAN}</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}

function isoMidnightUtc(dayKey: string): string {
  return `${dayKey}T00:00:00+00:00`;
}

/** Makes sure Kill Bill holds the seeded catalog plus one version per scheduled change. */
export async function syncCatalog(): Promise<void> {
  const changes = await readPriceChanges();
  const existing = await readCatalogVersions();
  const have = new Set(existing.map((version) => version.effectiveDateMs));
  if (!have.has(BASE_CATALOG_DATE_MS)) {
    await uploadCatalog(catalogXml('2020-01-01T00:00:00+00:00', changes, '2020-01-01', true));
  }
  const dayKeys = [...new Set(changes.map((change) => change.effectiveOn))].sort(compareDayKeys);
  for (const dayKey of dayKeys) {
    const instantMs = dayKeyToInstant(dayKey);
    if (instantMs === null) continue;
    const iso = isoMidnightUtc(dayKey);
    if (have.has(Date.parse(iso))) continue;
    await uploadCatalog(catalogXml(iso, changes, dayKey, false));
  }
}

/** The displayed catalog. Prices come from the Kill Bill catalog version in force today. */
export async function buildCatalog(nowMs: number): Promise<Catalog> {
  const versions = await readCatalogVersions();
  const todayKey = lisbonDayKey(nowMs);
  const inForce = pickVersion(versions, nowMs);
  const changes = await readPriceChanges();
  const pricesFor = (planName: string, fallback: Record<Currency, number>): Record<Currency, number> =>
    Object.fromEntries(
      CURRENCIES.map((currency) => [currency, inForce?.prices[planName]?.[currency] ?? fallback[currency]]),
    ) as Record<Currency, number>;
  return {
    currencies: [...CURRENCIES],
    ticket: { prices: pricesFor(TICKET_PLAN, SEED_PRICES.ticket) },
    tiers: TIER_KEYS.map((tier) => ({
      tier,
      name: TIER_NAMES[tier],
      prices: pricesFor(TIER_PLANS[tier], SEED_PRICES[tier]),
      scheduled_changes: upcomingChanges(changes, tier, todayKey),
    })),
    donation: { min_minor: { ...DONATION_LIMITS.min }, max_minor: { ...DONATION_LIMITS.max } },
  };
}

function pickVersion(versions: CatalogVersion[], instantMs: number): CatalogVersion | null {
  let chosen: CatalogVersion | null = null;
  for (const version of versions) {
    if (version.effectiveDateMs <= instantMs) chosen = version;
  }
  return chosen;
}
