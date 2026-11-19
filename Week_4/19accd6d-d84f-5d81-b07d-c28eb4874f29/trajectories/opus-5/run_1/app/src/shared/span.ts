import { delimiterLength, type Args, type OpDef } from './ops.js';

/** A half-open byte range [start, end) of a step's input or output. */
export interface SpanRange {
  readonly start: number;
  readonly end: number;
}

/** The single place that decides how a span carries through one step. Null means the span is lost. */
export function carrySpan(
  op: OpDef,
  args: Args,
  range: SpanRange,
  inputLength: number,
  outputLength: number,
): SpanRange | null {
  switch (op.name) {
    case 'To Hex': {
      const k = delimiterLength(String(args['delimiter']));
      return { start: range.start * (2 + k), end: range.end * (2 + k) - k };
    }
    case 'To Binary': {
      const k = delimiterLength(String(args['delimiter']));
      return { start: range.start * (8 + k), end: range.end * (8 + k) - k };
    }
    case 'To Base64': {
      const start = Math.min(Math.floor(range.start / 3) * 4, outputLength);
      const end = Math.min(Math.ceil(range.end / 3) * 4, outputLength);
      return { start, end };
    }
    case 'Change Case':
      return inputLength === outputLength ? range : null;
    default:
      return null;
  }
}
