/**
 * The one place a kernel value becomes the `text/plain` of a result, a console
 * line or a display output.
 */

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function formatAt(value: unknown, depth: number): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'function':
      return `[Function ${value.name === '' ? 'anonymous' : value.name}]`;
    case 'symbol':
      return value.toString();
    default:
      break;
  }
  const object = value as object;
  if (object instanceof Date) return object.toISOString();
  if (Array.isArray(object)) {
    if (object.length === 0) return '[]';
    const items = object.map(
      (item) => `${indent(depth + 1)}${formatAt(item === undefined ? null : item, depth + 1)}`,
    );
    return `[\n${items.join(',\n')}\n${indent(depth)}]`;
  }
  if (isPlainObject(object)) {
    const entries = Object.entries(object).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return '{}';
    const items = entries.map(
      ([key, item]) => `${indent(depth + 1)}${JSON.stringify(key)}: ${formatAt(item, depth + 1)}`,
    );
    return `{\n${items.join(',\n')}\n${indent(depth)}}`;
  }
  return String(object);
}

/** The text of a result or display value. */
export function formatValue(value: unknown): string {
  return formatAt(value, 0);
}

/** One console line: strings as-is, every other value formatted. */
export function formatConsoleArgument(value: unknown): string {
  return typeof value === 'string' ? value : formatValue(value);
}
