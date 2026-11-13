import { Decimal } from '../shared/money';
import { MarkerDefinition, UnitConversion } from '../shared/catalog';

export function parseDecimal(text: string): Decimal | null {
  const trimmed = text.trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  return new Decimal(trimmed);
}

/** A result value or range bound at the marker's decimals. */
export function atMarkerDecimals(value: Decimal, marker: MarkerDefinition): string {
  return value.toDecimalPlaces(marker.decimals, Decimal.ROUND_HALF_UP).toFixed(marker.decimals);
}

export function convertToPracticeUnit(
  value: Decimal,
  conversion: UnitConversion,
  marker: MarkerDefinition,
): string {
  const factor = new Decimal(conversion.factor);
  const converted =
    conversion.step === 'multiply' ? value.times(factor) : value.dividedBy(factor);
  return atMarkerDecimals(converted, marker);
}
