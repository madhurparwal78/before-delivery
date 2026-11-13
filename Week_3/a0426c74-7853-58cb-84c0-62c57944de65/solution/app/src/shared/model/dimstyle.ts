// Dimension styles.
import * as copy from '../copy.ts';
import { invalid } from '../errors.ts';
import type { Op } from '../types.ts';
import type { Context, OpOutcome } from './context.ts';
import { round6 } from '../geometry/index.ts';

/** A double carries about 15 significant digits: more decimals only print noise (and `toFixed` refuses more than 100). */
const MAX_PRECISION = 12;

export function dimStyleSetOp(ctx: Context, op: Extract<Op, { type: 'dim_style_set' }>): OpOutcome {
  if (op.name.trim() === '') throw invalid(copy.NAME_REQUIRED);
  if (!Number.isInteger(op.precision) || op.precision < 0 || op.precision > MAX_PRECISION) throw invalid(copy.invalidValue('precision'));
  const scale = round6(op.scale);
  const textHeight = round6(op.text_height_mm);
  if (scale <= 0 || textHeight <= 0) throw invalid(copy.NUMBER_ABOVE_ZERO);
  ctx.ws.dimStyles.set(op.name, {
    name: op.name, precision: op.precision, prefix: op.prefix, suffix: op.suffix, scale, text_height_mm: textHeight,
  });
  return { status: 'applied', handles: [] };
}
