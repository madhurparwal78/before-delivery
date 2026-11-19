import { killbillPlanName, priceFor, type BillingTerm, type PlanCode } from '../domain/plans.js';

const PRODUCTS: Readonly<Record<PlanCode, string>> = { free: 'Free', studio: 'Studio', agency: 'Agency' };
const BILLING_PERIODS: Readonly<Record<BillingTerm, string>> = { monthly: 'MONTHLY', annual: 'ANNUAL' };

const PLAN_TERMS: ReadonlyArray<readonly [PlanCode, BillingTerm]> = [
  ['free', 'monthly'],
  ['studio', 'monthly'],
  ['studio', 'annual'],
  ['agency', 'monthly'],
  ['agency', 'annual'],
];

function planElement(plan: PlanCode, term: BillingTerm): string {
  const price = priceFor(plan, term);
  if (price === null) throw new Error(`${plan} has no ${term} term`);
  return `    <plan name="${killbillPlanName(plan, term)}">
      <product>${PRODUCTS[plan]}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>${BILLING_PERIODS[term]}</billingPeriod>
          <recurringPrice><price><currency>EUR</currency><value>${price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

/**
 * The change policies here are data uploaded to Kill Bill, mirroring the plan-change rule
 * that `planChangePolicy` decides in the app: immediate when the plan rises or the term goes
 * from monthly to annual, end of term otherwise.
 *
 * The child order of each `changePolicyCase` is fixed by Kill Bill's catalog schema
 * (from… before to… before policy); any other order is rejected as an invalid catalog.
 */
function changePolicyRules(): string {
  const cases: string[] = [];
  const ranked: readonly PlanCode[] = ['free', 'studio', 'agency'];
  for (let lower = 0; lower < ranked.length; lower += 1) {
    for (let higher = lower + 1; higher < ranked.length; higher += 1) {
      const from = ranked[lower] as PlanCode;
      const to = ranked[higher] as PlanCode;
      cases.push(
        `      <changePolicyCase><fromProduct>${PRODUCTS[from]}</fromProduct><toProduct>${PRODUCTS[to]}</toProduct><policy>IMMEDIATE</policy></changePolicyCase>`,
      );
    }
  }
  for (const plan of ranked) {
    if (priceFor(plan, 'annual') === null) continue;
    cases.push(
      `      <changePolicyCase><fromProduct>${PRODUCTS[plan]}</fromProduct><fromBillingPeriod>MONTHLY</fromBillingPeriod><toProduct>${PRODUCTS[plan]}</toProduct><toBillingPeriod>ANNUAL</toBillingPeriod><policy>IMMEDIATE</policy></changePolicyCase>`,
    );
  }
  cases.push('      <changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase>');
  return cases.join('\n');
}

const CATALOG_NAME = 'LanternfoldRooms';

/** Billing in advance, aligned to the subscription start. */
export function catalogXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>${CATALOG_NAME}</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>EUR</currency>
  </currencies>
  <products>
${Object.values(PRODUCTS)
  .map((name) => `    <product name="${name}"><category>BASE</category></product>`)
  .join('\n')}
  </products>
  <rules>
    <changePolicy>
${changePolicyRules()}
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase><alignment>START_OF_SUBSCRIPTION</alignment></changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase>
    </cancelPolicy>
    <createAlignment>
      <createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase>
    </createAlignment>
    <billingAlignment>
      <billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase>
    </priceList>
  </rules>
  <plans>
${PLAN_TERMS.map(([plan, term]) => planElement(plan, term)).join('\n')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${PLAN_TERMS.map(([plan, term]) => `        <plan>${killbillPlanName(plan, term)}</plan>`).join('\n')}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}
