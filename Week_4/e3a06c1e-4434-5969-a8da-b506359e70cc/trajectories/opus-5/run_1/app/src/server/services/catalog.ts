import type { Plan } from '../../shared/types.js';

export const catalogPlanName: Record<Plan, string> = {
  pilot: 'lowfield-pilot',
  scale: 'lowfield-scale',
};

export const USAGE_UNIT = 'billable-second';

const usagePlan = (plan: Plan, pricePerUnit: string): string => `    <plan name="${catalogPlanName[plan]}">
      <product>LowfieldSignal</product>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <usages>
          <usage name="${catalogPlanName[plan]}-usage" billingMode="IN_ARREAR" usageType="CONSUMABLE" tierBlockPolicy="ALL_TIERS">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>${USAGE_UNIT}</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>${pricePerUnit}</value>
                      </price>
                    </prices>
                    <max>1000000000</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>`;

/** One product and two usage-only monthly plans, priced per billable second. */
export const catalogXml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2024-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>LowfieldSignal</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <units>
    <unit name="${USAGE_UNIT}"/>
  </units>
  <products>
    <product name="LowfieldSignal">
      <category>BASE</category>
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
        <alignment>START_OF_BUNDLE</alignment>
      </changeAlignmentCase>
    </changeAlignment>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
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
${usagePlan('pilot', '0.001')}
${usagePlan('scale', '0.0005')}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>${catalogPlanName.pilot}</plan>
        <plan>${catalogPlanName.scale}</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
