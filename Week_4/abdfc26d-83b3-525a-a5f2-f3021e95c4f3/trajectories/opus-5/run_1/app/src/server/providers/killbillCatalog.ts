/** Products Studio and Pro, plans studio-monthly and pro-monthly, monthly in advance, USD. */
export const catalogXml = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2026-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>PhospheneYard</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>USD</currency>
  </currencies>
  <products>
    <product name="Studio">
      <category>BASE</category>
    </product>
    <product name="Pro">
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
        <policy>END_OF_TERM</policy>
      </cancelPolicyCase>
    </cancelPolicy>
  </rules>
  <plans>
    <plan name="studio-monthly">
      <product>Studio</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>12.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
    <plan name="pro-monthly">
      <product>Pro</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice><price><currency>USD</currency><value>36.00</value></price></recurringPrice>
        </recurring>
      </finalPhase>
    </plan>
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT">
      <plans>
        <plan>studio-monthly</plan>
        <plan>pro-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>
`;
