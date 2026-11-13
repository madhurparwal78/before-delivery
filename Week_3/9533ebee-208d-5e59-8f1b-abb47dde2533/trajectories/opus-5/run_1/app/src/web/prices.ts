/** Reading the API's own price form into exact price units. */

/** An 8-decimal API price string becomes an integer of price units. */
export function priceUnitsOf(apiPrice: string): bigint {
  const [whole, fraction] = apiPrice.split('.');
  return BigInt(whole ?? '0') * 100000000n + BigInt((fraction ?? '').padEnd(8, '0'));
}
