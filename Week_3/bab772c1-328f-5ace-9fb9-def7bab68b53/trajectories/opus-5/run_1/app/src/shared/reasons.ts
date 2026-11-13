/** Capture rejection reasons and their `<reason text>`. */

import type { RejectionReason } from "./model.js";

const REASON_TEXT: Record<RejectionReason, string> = {
  line_too_long: "line is longer than 1024 bytes",
  unknown_record: "unknown record type",
  too_many_samples: "more than 50000 samples",
  bad_field: "a field cannot be read",
  out_of_order: "sample time is not after the previous sample",
  no_samples: "no sample lines",
  parser_failed: "the parser stopped unexpectedly",
};

export function reasonText(reason: RejectionReason): string {
  return REASON_TEXT[reason];
}
