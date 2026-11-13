import { FIELD_MESSAGES, type FieldMessageKey } from "../../shared/messages";
import { parseUtText, withinSession, parseUtc } from "../../shared/time";
import type { ObjectKind } from "../../shared/types";
import type { FormValues } from "../state/drafts";

interface Checked {
  errors: Partial<Record<FieldMessageKey, string>>;
  observedAt: string | null;
  seeing: number | null;
  transparency: number | null;
}

/** The browser's first check of the form, with the published messages. */
export function checkForm(values: FormValues, kind: ObjectKind | null, startedAt: string, pairMarked: boolean): Checked {
  const errors: Checked["errors"] = {};
  if (!kind) errors.object_id = FIELD_MESSAGES.object_id;

  let observedAt: string | null = null;
  if (values.ut.trim() !== "") {
    const when = parseUtText(values.ut);
    const started = parseUtc(startedAt);
    if (!when || !started || !withinSession(started, when)) errors.observed_at = FIELD_MESSAGES.observed_at;
    else observedAt = `${values.ut.trim().replace(" ", "T")}:00Z`;
  }

  let seeing: number | null = null;
  if (values.seeing.trim() !== "") {
    const n = Number(values.seeing);
    if (!Number.isInteger(n) || n < 1 || n > 10) errors.seeing = FIELD_MESSAGES.seeing;
    else seeing = n;
  }

  let transparency: number | null = null;
  if (values.nelm.trim() !== "") {
    const n = Number(values.nelm);
    if (!Number.isFinite(n) || n < 1 || n > 8 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) errors.transparency_nelm = FIELD_MESSAGES.transparency_nelm;
    else transparency = Math.round(n * 10) / 10;
  }

  if (values.description.trim().length > 4000) errors.description = FIELD_MESSAGES.description;
  if (values.concentration !== "" && kind !== "globular") errors.concentration_class = FIELD_MESSAGES.concentration_class;
  if (pairMarked && kind !== "double_star") errors.pair = FIELD_MESSAGES.pair;
  return { errors, observedAt, seeing, transparency };
}
