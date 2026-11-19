// The catalog XML, one product with two usage-only monthly plans.

export function catalogXml(billingPrefix: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>Lowfield</catalogName>
  <recurringBillingMode>IN_ARREAR</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <units>
    <unit name="billable-second"/>
  </units>
  <products>
    <product name="${billingPrefix}-usage">
      <category>BASE</category>
    </product>
  </products>
  <rules>
    <changePolicy>
      <changePolicyCase>
        <policy>IMMEDIATE</policy>
      </changePolicyCase>
    </changePolicy>
    <cancelPolicy>
      <cancelPolicyCase>
        <policy>IMMEDIATE</policy>
      </cancelPolicyCase>
    </cancelPolicy>
  </rules>
  <plans>
    <plan name="${billingPrefix}-pilot">
      <product>${billingPrefix}-usage</product>
      <recurringBillingMode>IN_ARREAR</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>0</value>
            </price>
          </recurringPrice>
        </recurring>
        <usages>
          <usage name="${billingPrefix}-pilot-seconds" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>billable-second</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0.001</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>
    <plan name="${billingPrefix}-scale">
      <product>${billingPrefix}-usage</product>
      <recurringBillingMode>IN_ARREAR</recurringBillingMode>
      <finalPhase type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>
            <price>
              <currency>USD</currency>
              <value>0</value>
            </price>
          </recurringPrice>
        </recurring>
        <usages>
          <usage name="${billingPrefix}-scale-seconds" billingMode="IN_ARREAR" usageType="CONSUMABLE">
            <billingPeriod>MONTHLY</billingPeriod>
            <tiers>
              <tier>
                <blocks>
                  <tieredBlock>
                    <unit>billable-second</unit>
                    <size>1</size>
                    <prices>
                      <price>
                        <currency>USD</currency>
                        <value>0.0005</value>
                      </price>
                    </prices>
                    <max>-1</max>
                  </tieredBlock>
                </blocks>
              </tier>
            </tiers>
          </usage>
        </usages>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>${billingPrefix}-pilot</plan>
        <plan>${billingPrefix}-scale</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>`;
}
