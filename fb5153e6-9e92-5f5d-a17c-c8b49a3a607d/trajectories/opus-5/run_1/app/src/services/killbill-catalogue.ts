import { PLAN_NAMES, PLANS } from '../domain/plans.js';
import { centsToEuroString } from '../domain/money.js';

/** The author's plan catalogue, at the prices in the plan table. */
export function catalogueXml(): string {
  const products = PLAN_NAMES.map(
    (name) => `    <product name="${PLANS[name].killbillProduct}">
      <category>BASE</category>
    </product>`,
  ).join('\n');

  const plans = PLAN_NAMES.map((name) => {
    const p = PLANS[name];
    return `    <plan name="${p.killbillPlan}">
      <product>${p.killbillProduct}</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>EUR</currency>
              <value>${centsToEuroString(p.monthlyPriceCents)}</value>
            </price>
          </recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
  }).join('\n');

  const priceListPlans = PLAN_NAMES.map(
    (name) => `        <plan>${PLANS[name].killbillPlan}</plan>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Turnstone</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>EUR</currency>
  </currencies>
  <products>
${products}
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
${plans}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${priceListPlans}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}
