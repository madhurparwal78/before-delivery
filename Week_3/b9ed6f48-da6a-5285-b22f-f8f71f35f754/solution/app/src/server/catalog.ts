// The price catalog lives in Kill Bill (brief: Services › Kill Bill › Catalog). Each scheduled
// price change is a catalog version effective from 00:00 Lisbon on its date. Every price the app
// shows or charges is read from those versions.

import { locked } from "./db.js";
import { CatalogUnreadable, deleteCatalog, getCatalog, uploadCatalogVersion, type KbCatalogVersion } from "./killbill.js";
import { CURRENCIES, majorToMinor, minorToMajor, type Currency } from "../shared/money.js";
import { TIERS, TIER_NAMES, type Tier } from "../shared/copy.js";
import { lisbonDate, lisbonMidnight } from "../shared/lisbon.js";

type PriceTable = Record<Currency, number>;

export interface CatalogVersion {
  effectiveFrom: number;
  ticket: PriceTable;
  tiers: Record<Tier, PriceTable>;
}

const TICKET_PLAN = "guided-session-ticket";
export const planName = (tier: Tier) => `supporter-${tier}-monthly`;
export const tierOfPlan = (plan: string): Tier => TIERS.find((t) => planName(t) === plan) ?? "reader";

const BASE_EFFECTIVE = Date.UTC(2020, 0, 1);
const BASE: CatalogVersion = {
  effectiveFrom: BASE_EFFECTIVE,
  ticket: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
  tiers: {
    reader: { EUR: 500, GBP: 400, USD: 600, JPY: 800 },
    fellow: { EUR: 1200, GBP: 1000, USD: 1400, JPY: 2000 },
    patron: { EUR: 3000, GBP: 2600, USD: 3500, JPY: 5000 },
  },
};

export const DONATION_LIMITS = { min: 100, max: 500000 };

const RANK: Record<Tier, number> = { reader: 0, fellow: 1, patron: 2 };
export const isUpgrade = (from: Tier, to: Tier) => RANK[to] > RANK[from];

function prices(table: PriceTable): string {
  return CURRENCIES.map((c) => `<price><currency>${c}</currency><value>${minorToMajor(table[c], c)}</value></price>`).join("");
}

/**
 * One catalog version. Subscriptions stay on the version they started under, so Kill Bill never
 * splits a paid period at a price change; the price an existing member pays from their first
 * period on or after the date is `tierPriceOn` (brief: Business rules › Price changes).
 */
function versionXml(version: CatalogVersion): string {
  const effective = new Date(version.effectiveFrom).toISOString().replace(".000Z", "+00:00");
  const downgrades = TIERS.flatMap((from) =>
    TIERS.filter((to) => RANK[to] < RANK[from]).map(
      (to) => `<changePolicyCase><fromProduct>${TIER_NAMES[from]}</fromProduct><toProduct>${TIER_NAMES[to]}</toProduct><policy>END_OF_TERM</policy></changePolicyCase>`,
    ),
  ).join("");
  const tierPlans = TIERS.map(
    (tier) => `<plan name="${planName(tier)}"><product>${TIER_NAMES[tier]}</product>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>MONTHLY</billingPeriod><recurringPrice>${prices(version.tiers[tier])}</recurringPrice></recurring>
      </finalPhase></plan>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>${effective}</effectiveDate>
  <catalogName>HaldenSightline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>${CURRENCIES.map((c) => `<currency>${c}</currency>`).join("")}</currencies>
  <products>
    ${TIERS.map((t) => `<product name="${TIER_NAMES[t]}"><category>BASE</category></product>`).join("")}
    <product name="GuidedSessionTicket"><category>STANDALONE</category></product>
  </products>
  <rules>
    <changePolicy>${downgrades}<changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>
    ${tierPlans}
    <plan name="${TICKET_PLAN}"><product>GuidedSessionTicket</product>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration><fixed><fixedPrice>${prices(version.ticket)}</fixedPrice></fixed></finalPhase>
    </plan>
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${[...TIERS.map(planName), TICKET_PLAN].map((p) => `<plan>${p}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}

function table(list: { currency: Currency; value: number }[]): PriceTable {
  const out = {} as PriceTable;
  for (const c of CURRENCIES) out[c] = majorToMinor(list.find((p) => p.currency === c)?.value ?? 0, c);
  return out;
}

function fromKillBill(version: KbCatalogVersion): CatalogVersion {
  const plans = version.products.flatMap((p) => p.plans);
  const phase = (name: string) => plans.find((p) => p.name === name)?.phases.at(-1);
  const tiers = {} as Record<Tier, PriceTable>;
  for (const tier of TIERS) tiers[tier] = table(phase(planName(tier))?.prices ?? []);
  return { effectiveFrom: Date.parse(version.effectiveDate), ticket: table(phase(TICKET_PLAN)?.fixedPrices ?? []), tiers };
}

/** The catalog versions in Kill Bill, oldest first. */
export async function catalogVersions(): Promise<CatalogVersion[]> {
  return (await getCatalog()).map(fromKillBill).sort((a, b) => a.effectiveFrom - b.effectiveFrom);
}

/**
 * Makes sure the tenant holds the plans (brief: "On every start"). The advisory lock serialises
 * instances on one database, but deployments with their own databases share the tenant, so two
 * of them can both find it empty and both upload the base version. Kill Bill then cannot load the
 * catalog at all; the base version is uploaded again after a random pause, and the caller retries
 * until a read succeeds.
 */
export async function ensureCatalog(): Promise<void> {
  await locked("killbill-catalog", async () => {
    try {
      if ((await getCatalog()).length === 0) await uploadCatalogVersion(versionXml(BASE));
    } catch (error) {
      if (!(error instanceof CatalogUnreadable)) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 3000));
      await deleteCatalog();
      await uploadCatalogVersion(versionXml(BASE));
    }
    await getCatalog();
  });
}

function versionAt(versions: CatalogVersion[], instant: number): CatalogVersion {
  return versions.filter((v) => v.effectiveFrom <= instant).at(-1) ?? versions[0];
}

/** The price for a tier and currency in force at an instant: the one rule every caller uses. */
export function tierPriceAt(versions: CatalogVersion[], tier: Tier, currency: Currency, instant: number): number {
  return versionAt(versions, instant).tiers[tier][currency];
}

export function ticketPriceAt(versions: CatalogVersion[], currency: Currency, instant: number): number {
  return versionAt(versions, instant).ticket[currency];
}

/** The price for a tier and currency on a Lisbon date (a period that starts that day). */
export function tierPriceOn(versions: CatalogVersion[], tier: Tier, currency: Currency, isoDate: string): number {
  return tierPriceAt(versions, tier, currency, lisbonMidnight(isoDate));
}

interface ScheduledChange {
  currency: Currency;
  amount_minor: number;
  effective_on: string;
}

/** Changes for a tier whose date has not passed, read off successive catalog versions. */
export function scheduledChanges(versions: CatalogVersion[], tier: Tier, now: number): ScheduledChange[] {
  const out: ScheduledChange[] = [];
  versions.forEach((version, i) => {
    if (i === 0 || version.effectiveFrom <= now) return;
    for (const currency of CURRENCIES) {
      if (version.tiers[tier][currency] !== versions[i - 1].tiers[tier][currency]) {
        out.push({ currency, amount_minor: version.tiers[tier][currency], effective_on: lisbonDate(version.effectiveFrom) });
      }
    }
  });
  return out;
}

type PriceChangeResult = "scheduled" | "conflict";

/** True when a change for this tier and currency is already scheduled on or after `from`. */
export function hasLaterChange(versions: CatalogVersion[], tier: Tier, currency: Currency, from: number): boolean {
  return versions.some((v, i) => i > 0 && v.effectiveFrom >= from && v.tiers[tier][currency] !== versions[i - 1].tiers[tier][currency]);
}

/**
 * Adds a version from 00:00 Lisbon on `effectiveOn`. A date after every version is appended;
 * an earlier or shared date rebuilds the versions so later ones carry the change too.
 */
export async function schedulePriceChange(tier: Tier, currency: Currency, amountMinor: number, effectiveOn: string): Promise<PriceChangeResult> {
  return locked("killbill-catalog", async () => {
    const versions = await catalogVersions();
    const from = lisbonMidnight(effectiveOn);
    if (hasLaterChange(versions, tier, currency, from)) return "conflict";
    const apply = (v: CatalogVersion): CatalogVersion => ({ ...v, tiers: { ...v.tiers, [tier]: { ...v.tiers[tier], [currency]: amountMinor } } });
    const last = versions[versions.length - 1];
    if (from > last.effectiveFrom) {
      await uploadCatalogVersion(versionXml({ ...apply(last), effectiveFrom: from }));
      return "scheduled";
    }
    const before = versionAt(versions, from - 1);
    const rebuilt = [
      ...versions.filter((v) => v.effectiveFrom < from),
      ...(versions.some((v) => v.effectiveFrom === from) ? [] : [{ ...apply(before), effectiveFrom: from }]),
      ...versions.filter((v) => v.effectiveFrom >= from).map(apply),
    ];
    await deleteCatalog();
    for (const v of rebuilt) await uploadCatalogVersion(versionXml(v));
    return "scheduled";
  });
}
