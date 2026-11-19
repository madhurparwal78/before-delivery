import type { Tier } from '../../shared/types';

export interface TierPlan {
  readonly tier: Tier;
  readonly product: string;
  readonly plan: string;
  readonly price: string;
}

export const TIER_PLANS: readonly TierPlan[] = [
  {
    tier: 'pay-what-you-can',
    product: 'PayWhatYouCan',
    plan: 'pegworth-pay-what-you-can-annual',
    price: '15.00',
  },
  { tier: 'standard', product: 'Standard', plan: 'pegworth-standard-annual', price: '40.00' },
  { tier: 'supporter', product: 'Supporter', plan: 'pegworth-supporter-annual', price: '75.00' },
];

export function planForTier(tier: Tier): TierPlan {
  const plan = TIER_PLANS.find((candidate) => candidate.tier === tier);
  if (!plan) throw new Error(`No plan for tier ${tier}`);
  return plan;
}

function productXml(plan: TierPlan): string {
  return `    <product name="${plan.product}">
      <category>BASE</category>
    </product>`;
}

function planXml(plan: TierPlan): string {
  return `    <plan name="${plan.plan}">
      <product>${plan.product}</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>ANNUAL</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>${plan.price}</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

export const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Pegworth</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
${TIER_PLANS.map(productXml).join('\n')}
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>END_OF_TERM</policy>
      </changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase>
        <alignment>START_OF_BUNDLE</alignment>
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
        <alignment>ACCOUNT</alignment>
      </billingAlignmentCase>
    </billingAlignment>
    <priceList>
      <priceListCase>
        <toPriceList>DEFAULT</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
${TIER_PLANS.map(planXml).join('\n')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${TIER_PLANS.map((plan) => `        <plan>${plan.plan}</plan>`).join('\n')}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
