// Number text for file formats: fixed precision, no trailing zeros, never "-0".

export function trimmed(value: number, places: number): string {
  const text = value.toFixed(places);
  const stripped = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return stripped === '-0' ? '0' : stripped;
}
