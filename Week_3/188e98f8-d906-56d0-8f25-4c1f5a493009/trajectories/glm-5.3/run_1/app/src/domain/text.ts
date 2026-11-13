import { LIMITS } from "./constants";

export interface TextCheck {
  readonly codePoints: number;
  readonly empty: boolean;
  readonly tooLong: boolean;
}

/** The one counting rule: NFC, then trim, then Unicode code points. */
export function countText(text: string): number {
  return [...normalise(text)].length;
}

export type FieldProblem = "required" | "too_long" | "invalid" | "too_deep";

export function normalise(text: string): string {
  return text.normalize("NFC").trim();
}

export function checkText(text: string, limit: number): TextCheck {
  const n = normalise(text);
  const codePoints = [...n].length;
  return {
    codePoints,
    empty: n.length === 0,
    tooLong: codePoints > limit,
  };
}

export function fieldProblem(text: string, limit: number): FieldProblem | undefined {
  const n = normalise(text);
  if (n.length === 0) return "required";
  if ([...n].length > limit) return "too_long";
  return undefined;
}

export function limitFor(kind: "name" | "answerText" | "query" | "reason"): number {
  switch (kind) {
    case "name":
      return LIMITS.teamNameMax;
    case "answerText":
      return LIMITS.answerMax;
    case "query":
      return LIMITS.searchQueryMax;
    case "reason":
      return LIMITS.disputeReasonMax;
  }
}
