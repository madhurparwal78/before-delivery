import { TIERS, TIER_PLANS, type Tier } from '../../shared/domain.ts';

function dollars(cents: number): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function productName(tier: Tier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function recurringPlan(tier: Tier, cadence: 'annual' | 'monthly'): string {
  const price = TIER_PLANS[tier][cadence];
  return `    <plan name="${tier}-${cadence}">
      <product>${productName(tier)}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>${cadence === 'annual' ? 'ANNUAL' : 'MONTHLY'}</billingPeriod>
          <recurringPrice><price><currency>CAD</currency><value>${dollars(price)}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

function giftPlan(tier: Tier): string {
  return `    <plan name="${tier}-gift">
      <product>${productName(tier)}</product>
      <finalPhase type="FIXEDTERM">
        <duration><unit>MONTHS</unit><number>12</number></duration>
        <fixed><fixedPrice><price><currency>CAD</currency><value>0.00</value></price></fixedPrice></fixed>
      </finalPhase>
    </plan>`;
}

export const PLAN_NAMES = TIERS.flatMap((tier) => [`${tier}-annual`, `${tier}-monthly`, `${tier}-gift`]);

export const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>HalideFilmSociety</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>CAD</currency>
  </currencies>
  <products>
${TIERS.map((tier) => `    <product name="${productName(tier)}"><category>BASE</category></product>`).join('\n')}
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase>
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
      <billingAlignmentCase><alignment>ACCOUNT</alignment></billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase>
    </priceList>
  </rules>
  <plans>
${TIERS.map((tier) => [recurringPlan(tier, 'annual'), recurringPlan(tier, 'monthly'), giftPlan(tier)].join('\n')).join('\n')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${PLAN_NAMES.map((name) => `        <plan>${name}</plan>`).join('\n')}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
