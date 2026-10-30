// Status always shown as a word plus a fill pattern.

import type { HoldStatus, LoanStatus, SpanStatus } from "../shared/api.js";
import { HOLD_STATUS_WORD, LOAN_STATUS_WORD, SPAN_STATUS_WORD } from "../shared/copy.js";
import { h } from "./dom.js";

type Pattern = "free" | "closed" | SpanStatus | HoldStatus | LoanStatus;

export function chip(word: string, pattern: Pattern): HTMLSpanElement {
  return h("span", { class: `chip chip--${pattern}` }, h("span", { class: "chip__swatch", "aria-hidden": "true" }), h("span", { class: "chip__word" }, word));
}

export const holdChip = (status: HoldStatus) => chip(HOLD_STATUS_WORD[status], status);
export const loanChip = (status: LoanStatus) => chip(LOAN_STATUS_WORD[status], status);
export const spanChip = (status: SpanStatus) => chip(SPAN_STATUS_WORD[status], status);
export const freeChip = () => chip("Free", "free");
