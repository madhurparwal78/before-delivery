/** How a value is shown as a result, a console argument or a plain-text display. */
export function formatValue(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
      return String(value);
    case "bigint":
      return `${value}n`;
    case "function":
      return `[Function ${value.name || "anonymous"}]`;
    default:
      break;
  }
  if (value === null) return "null";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  const plain = Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
  if (plain) {
    try {
      const text = JSON.stringify(value, null, 2);
      if (text !== undefined) return text;
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** A console argument: strings as written, everything else formatted as a result. */
export const consoleText = (value: unknown): string => (typeof value === "string" ? value : formatValue(value));
