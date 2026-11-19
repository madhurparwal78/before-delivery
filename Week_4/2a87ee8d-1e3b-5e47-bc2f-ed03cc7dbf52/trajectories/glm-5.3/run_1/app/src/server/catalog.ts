/**
 * The Kill Bill catalog, uploaded once per tenant (DP-46, Services).
 * Billing in advance aligned to the subscription start; change policies:
 * immediate on a rank rise or monthly→annual, otherwise end of term.
 */
export const CATALOG_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="CatalogSchema.xsd ">

    <effectiveDate>1970-01-01T00:00:00Z</effectiveDate>
    <catalogName>Lanternfold</catalogName>
    <currencies>
        <currency>EUR</currency>
    </currencies>
    <units/>
    <products>
        <product name="Free" prettyName="Free">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
        <product name="Studio" prettyName="Studio">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
        <product name="Agency" prettyName="Agency">
            <category>BASE</category>
            <included/>
            <available/>
            <limits/>
        </product>
    </products>
    <rules>
        <changePolicy>
            <changePolicyCase>
                <toProduct>Agency</toProduct>
                <policy>IMMEDIATE</policy>
            </changePolicyCase>
            <changePolicyCase>
                <fromProduct>Free</fromProduct>
                <toProduct>Studio</toProduct>
                <policy>IMMEDIATE</policy>
            </changePolicyCase>
            <changePolicyCase>
                <fromBillingPeriod>MONTHLY</fromBillingPeriod>
                <toBillingPeriod>ANNUAL</toBillingPeriod>
                <policy>IMMEDIATE</policy>
            </changePolicyCase>
            <changePolicyCase>
                <policy>END_OF_TERM</policy>
            </changePolicyCase>
        </changePolicy>
        <changeAlignment/>
        <cancelPolicy>
            <cancelPolicyCase>
                <policy>IMMEDIATE</policy>
            </cancelPolicyCase>
        </cancelPolicy>
        <createAlignment/>
        <billingAlignment/>
        <priceList/>
    </rules>
    <plans>
        <plan name="free-monthly">
            <product>Free</product>
            <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>EUR</currency>
                            <value>0</value>
                        </price>
                    </recurringPrice>
                </recurring>
                <usages/>
            </finalPhase>
            <plansAllowedInBundle>-1</plansAllowedInBundle>
        </plan>
        <plan name="studio-monthly">
            <product>Studio</product>
            <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>EUR</currency>
                            <value>24</value>
                        </price>
                    </recurringPrice>
                </recurring>
                <usages/>
            </finalPhase>
            <plansAllowedInBundle>-1</plansAllowedInBundle>
        </plan>
        <plan name="studio-annual">
            <product>Studio</product>
            <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>ANNUAL</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>EUR</currency>
                            <value>230.40</value>
                        </price>
                    </recurringPrice>
                </recurring>
                <usages/>
            </finalPhase>
            <plansAllowedInBundle>-1</plansAllowedInBundle>
        </plan>
        <plan name="agency-monthly">
            <product>Agency</product>
            <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>MONTHLY</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>EUR</currency>
                            <value>59</value>
                        </price>
                    </recurringPrice>
                </recurring>
                <usages/>
            </finalPhase>
            <plansAllowedInBundle>-1</plansAllowedInBundle>
        </plan>
        <plan name="agency-annual">
            <product>Agency</product>
            <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
            <finalPhase type="EVERGREEN">
                <duration>
                    <unit>UNLIMITED</unit>
                    <number>-1</number>
                </duration>
                <recurring>
                    <billingPeriod>ANNUAL</billingPeriod>
                    <recurringPrice>
                        <price>
                            <currency>EUR</currency>
                            <value>566.40</value>
                        </price>
                    </recurringPrice>
                </recurring>
                <usages/>
            </finalPhase>
            <plansAllowedInBundle>-1</plansAllowedInBundle>
        </plan>
    </plans>
    <priceLists>
        <defaultPriceList name="DEFAULT">
            <plans>
                <plan>free-monthly</plan>
                <plan>studio-monthly</plan>
                <plan>studio-annual</plan>
                <plan>agency-monthly</plan>
                <plan>agency-annual</plan>
            </plans>
        </defaultPriceList>
    </priceLists>
</catalog>`;
