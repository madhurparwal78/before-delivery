<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog>
  <effectiveDate>__EFFECTIVE_DATE__</effectiveDate>
  <catalogName>Sightline</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies>
    <currency>EUR</currency>
    <currency>GBP</currency>
    <currency>USD</currency>
    <currency>JPY</currency>
  </currencies>
  <products>
    <product name="guided-session-ticket">
      <category>BASE</category>
    </product>
    <product name="supporter-reader">
      <category>BASE</category>
    </product>
    <product name="supporter-fellow">
      <category>BASE</category>
    </product>
    <product name="supporter-patron">
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
        <toPriceList>Default</toPriceList>
      </priceListCase>
    </priceList>
  </rules>
  <plans>
    <plan name="guided-session-ticket" prettyName="Guided session ticket">
      <product>guided-session-ticket</product>
      <initialPhases/>
      <finalPhase prettyName="Ticket" type="EVERGREEN">
        <duration>
          <unit>UNLIMITED</unit>
        </duration>
        <fixed>
          <fixedPrice>
__TICKET_PRICES__
          </fixedPrice>
        </fixed>
      </finalPhase>
    </plan>
__SUPPORTER_PLANS__
  </plans>
  <priceLists>
    <defaultPriceList name="Default">
      <plans>
        <plan>guided-session-ticket</plan>
        <plan>supporter-reader-monthly</plan>
        <plan>supporter-fellow-monthly</plan>
        <plan>supporter-patron-monthly</plan>
      </plans>
    </defaultPriceList>
  </priceLists>
</catalog>

