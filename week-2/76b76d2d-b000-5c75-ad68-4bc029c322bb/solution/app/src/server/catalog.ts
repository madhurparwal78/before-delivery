import { CADENCES, TIER_PRICES, TIERS, type Tier } from "../shared/domain.ts";
import { centsToDecimal } from "./money.ts";

const PRODUCT: Record<Tier, string> = { friend: "Friend", cinephile: "Cinephile", projectionist: "Projectionist" };
const PERIOD = { annual: "ANNUAL", monthly: "MONTHLY" } as const;

const price = (cents: number): string => `<price><currency>CAD</currency><value>${centsToDecimal(cents)}</value></price>`;

/** The CAD membership catalogue: `<tier>-annual`, `<tier>-monthly` in advance, and the 12-month `<tier>-gift`. */
export function catalogXml(): string {
  const plans = TIERS.flatMap((tier) => [
    ...CADENCES.map((cadence) => `
    <plan name="${tier}-${cadence}"><product>${PRODUCT[tier]}</product>
      <finalPhase type="EVERGREEN"><duration><unit>UNLIMITED</unit></duration>
        <recurring><billingPeriod>${PERIOD[cadence]}</billingPeriod><recurringPrice>${price(TIER_PRICES[tier][cadence])}</recurringPrice></recurring>
      </finalPhase></plan>`),
    `
    <plan name="${tier}-gift"><product>${PRODUCT[tier]}</product>
      <finalPhase type="FIXEDTERM"><duration><unit>MONTHS</unit><number>12</number></duration>
        <fixed><fixedPrice>${price(0)}</fixedPrice></fixed>
      </finalPhase></plan>`,
  ]);
  const names = TIERS.flatMap((tier) => [...CADENCES.map((cadence) => `${tier}-${cadence}`), `${tier}-gift`]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="CatalogSchema.xsd">
  <effectiveDate>2020-01-01T00:00:00+00:00</effectiveDate>
  <catalogName>halide-memberships</catalogName>
  <recurringBillingMode>IN_ADVANCE</recurringBillingMode>
  <currencies><currency>CAD</currency></currencies>
  <products>${TIERS.map((tier) => `<product name="${PRODUCT[tier]}"><category>BASE</category></product>`).join("")}</products>
  <rules>
    <changePolicy><changePolicyCase><policy>END_OF_TERM</policy></changePolicyCase></changePolicy>
    <changeAlignment><changeAlignmentCase><alignment>START_OF_BUNDLE</alignment></changeAlignmentCase></changeAlignment>
    <cancelPolicy><cancelPolicyCase><policy>END_OF_TERM</policy></cancelPolicyCase></cancelPolicy>
    <createAlignment><createAlignmentCase><alignment>START_OF_BUNDLE</alignment></createAlignmentCase></createAlignment>
    <billingAlignment><billingAlignmentCase><alignment>SUBSCRIPTION</alignment></billingAlignmentCase></billingAlignment>
    <priceList><priceListCase><toPriceList>DEFAULT</toPriceList></priceListCase></priceList>
  </rules>
  <plans>${plans.join("")}
  </plans>
  <priceLists><defaultPriceList name="DEFAULT"><plans>${names.map((name) => `<plan>${name}</plan>`).join("")}</plans></defaultPriceList></priceLists>
</catalog>`;
}
