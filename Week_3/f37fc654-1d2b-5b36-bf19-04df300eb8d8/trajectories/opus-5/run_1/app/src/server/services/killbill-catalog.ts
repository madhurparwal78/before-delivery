import { MAINTENANCE_PLANS } from '../../shared/seed.js';

/**
 * The maintenance catalog: one base product billed monthly in advance, with
 * immediate plan changes and account billing alignment.
 */
export const CATALOG_NAME = 'SpindriftRooms';

function planXml(planName: string, priceCents: number): string {
  const price = (priceCents / 100).toFixed(2);
  return `    <plan name="${planName}">
      <product>Maintenance</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>${price}</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

export function maintenanceCatalogXml(): string {
  const plans = Object.values(MAINTENANCE_PLANS);
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>${CATALOG_NAME}</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency></currencies>
  <products>
    <product name="Maintenance">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase>
    </changePolicy>
    <changeAlignment>
      <changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase><policy>IMMEDIATE</policy></cancelPolicyCase>
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
${plans.map((p) => planXml(p.planName, p.priceCents)).join('\n')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
${plans.map((p) => `        <plan>${p.planName}</plan>`).join('\n')}
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
}
