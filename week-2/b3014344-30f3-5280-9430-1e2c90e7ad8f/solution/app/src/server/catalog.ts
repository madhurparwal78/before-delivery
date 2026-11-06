import type { PlanId } from "../shared/domain";
import { toAmount, type Currency } from "../shared/money";

/** The seed prices, effective from 2026-01-01T00:00:00-03:00, in minor units. */
export const SEED_PRICES: Record<PlanId, Record<Currency, bigint>> = {
  "launch-page": { USD: 184_999n, ARS: 23_333_333n },
  "studio-site": { USD: 499_999n, ARS: 58_765_432n },
  "care-lite": { USD: 14_900n, ARS: 18_999_999n },
  "care-plus": { USD: 34_900n, ARS: 44_999_999n },
};
export const SEED_PRICES_FROM = "2026-01-01T00:00:00-03:00";

function carePlanXml(plan: "care-lite" | "care-plus"): string {
  const prices = (["USD", "ARS"] as const)
    .map((currency) => `<price><currency>${currency}</currency><value>${toAmount(SEED_PRICES[plan][currency])}</value></price>`)
    .join("");
  return `
    <plan name="${plan}-monthly">
      <product>${plan}</product>
      <finalPhase type="EVERGREEN">
        <duration><unit>UNLIMITED</unit></duration>
        <recurring>
          <billingPeriod>MONTHLY</billingPeriod>
          <recurringPrice>${prices}</recurringPrice>
        </recurring>
      </finalPhase>
    </plan>`;
}

/** The Kill Bill catalog: two monthly care plans billed in advance, immediate changes, end-of-term cancels. */
export function catalogXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2026-01-01T03:00:00+00:00</effectiveDate>
  <catalogName>pampero-care</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>USD</currency><currency>ARS</currency></currencies>
  <products>
    <product name="care-lite"><category>BASE</category></product>
    <product name="care-plus"><category>BASE</category></product>
  </products>
  <rules>
    <changePolicy><changePolicyCase><policy>IMMEDIATE</policy></changePolicyCase></changePolicy>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
  </rules>
  <plans>${carePlanXml("care-lite")}${carePlanXml("care-plus")}
  </plans>
  <priceLists>
    <defaultPriceList name="DEFAULT"><plans><plan>care-lite-monthly</plan><plan>care-plus-monthly</plan></plans></defaultPriceList>
  </priceLists>
</catalog>`;
}
