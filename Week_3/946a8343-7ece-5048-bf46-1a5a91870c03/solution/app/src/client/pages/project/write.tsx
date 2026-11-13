// Shared bits of the settings forms: how an API refusal is shown (field errors under their fields with an error summary, any
// other refusal in the status strip) and the role options.
import { ApiError } from "../../api.ts";
import { ErrorSummary, Notice, type SummaryError } from "../../ui/feedback.tsx";
import type { SelectOption } from "../../ui/fields.tsx";
import type { CustomRole, Member } from "./types.ts";

export const ROLE_OPTIONS: readonly SelectOption[] = [
  { value: "guest", label: "Guest" },
  { value: "reporter", label: "Reporter" },
  { value: "developer", label: "Developer" },
  { value: "maintainer", label: "Maintainer" },
  { value: "owner", label: "Owner" },
];

interface Feedback {
  summary: SummaryError[];
  byField: Record<string, string>;
  notice: string | null;
}

const none: Feedback = { summary: [], byField: {}, notice: null };

/** Field errors keep the ids `field-<prefix>-<field>`; a refusal without field errors becomes the strip text. */
export function feedbackOf(error: ApiError | null, prefix: string, fields: readonly string[]): Feedback {
  if (error === null) return none;
  const named = error.status === 422 ? error.fieldErrors() : {};
  const summary: SummaryError[] = [];
  const byField: Record<string, string> = {};
  for (const field of fields) {
    const message = named[field];
    if (message === undefined) continue;
    byField[field] = message;
    summary.push({ field: `${prefix}-${field}`, message });
  }
  if (summary.length > 0) return { summary, byField, notice: null };
  return { summary, byField, notice: error.message };
}

export function FeedbackView({ feedback, signal }: { feedback: Feedback; signal: unknown }) {
  return (
    <>
      <ErrorSummary errors={feedback.summary} focusSignal={signal} />
      {feedback.notice !== null ? <Notice>{feedback.notice}</Notice> : null}
    </>
  );
}

/** The select value of a member: the base role, or `custom:<id>` for a custom role. */
export function grantValue(member: Pick<Member, "role" | "custom_role">, custom: readonly CustomRole[]): string {
  if (member.custom_role === null) return member.role ?? "guest";
  const found = custom.find((role) => role.name === member.custom_role);
  return found ? `custom:${found.id}` : `custom:${member.custom_role}`;
}

export function grantBody(value: string): { role: string } | { custom_role: number } {
  if (value.startsWith("custom:")) return { custom_role: Number(value.slice("custom:".length)) };
  return { role: value };
}

export function words(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

export function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The refusal the server gives for an empty name or pattern, raised before a request with an empty path segment is sent. */
export function blankField(field: string, message: string): ApiError {
  return new ApiError(422, "validation", message, { fields: { [field]: message } });
}
