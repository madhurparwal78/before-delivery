import type { PreviewKind } from './api';

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
};

const formatValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'object' && (Array.isArray(value) || isPlainObject(value))) {
    try {
      return JSON.stringify(value) ?? '[unserialisable object]';
    } catch {
      return '[unserialisable object]';
    }
  }
  return String(value);
};

/** The `text` field of a preview message: the arguments joined by one space, without a label. */
export const formatArguments = (args: readonly unknown[]): string =>
  args.map(formatValue).join(' ');

/** A console entry's visible text: the message kind word, a space, then the text. */
export const entryText = (kind: PreviewKind, text: string): string => `${kind} ${text}`;

export const uncaughtText = (name: string, message: string, line: number | null): string =>
  line === null ? `${name}: ${message}` : `${name}: ${message} (line ${line})`;

export const rejectionText = (reason: unknown): string =>
  reason instanceof Error
    ? `Unhandled rejection: ${reason.message}`
    : `Unhandled rejection: ${formatValue(reason)}`;
