import type { InterviewNote, Review } from "../../shared/api";
import { ANONYMOUS_LABEL, PREVIEW_CHARS, ROLE_FAMILIES, type OutcomeId, type RoleFamilyId } from "../../shared/reference";

function preview(value: string, unlocked: boolean): { text: string; cut: boolean } {
  const letters = Array.from(value);
  if (unlocked || letters.length <= PREVIEW_CHARS) return { text: value, cut: false };
  return { text: letters.slice(0, PREVIEW_CHARS).join(""), cut: true };
}

export function postedMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function excerptOf(value: string): string {
  return preview(value, false).text;
}

export type ReviewRow = {
  id: string; title: string; overall: number; work_life: number; pay: number; management: number;
  pros: string; cons: string; created_at: Date; reply_body: string | null; reply_at: Date | null; company_name: string;
};

export function publicReview(row: ReviewRow, unlocked: boolean): Review {
  const pros = preview(row.pros, unlocked);
  const cons = preview(row.cons, unlocked);
  return {
    id: row.id,
    title: row.title,
    overall: row.overall,
    work_life: row.work_life,
    pay: row.pay,
    management: row.management,
    pros: pros.text,
    cons: cons.text,
    truncated: pros.cut || cons.cut,
    posted_month: postedMonth(row.created_at),
    author_label: ANONYMOUS_LABEL,
    reply:
      row.reply_body !== null && row.reply_at !== null
        ? { company_name: row.company_name, body: row.reply_body, posted_month: postedMonth(row.reply_at) }
        : null,
  };
}

export type NoteRow = {
  id: string; role_family: RoleFamilyId; difficulty: number; outcome: OutcomeId; text: string; created_at: Date;
};

export function publicNote(row: NoteRow, unlocked: boolean): InterviewNote {
  const text = preview(row.text, unlocked);
  return {
    id: row.id,
    role_family: row.role_family,
    role_name: ROLE_FAMILIES.find((role) => role.id === row.role_family)?.name ?? row.role_family,
    difficulty: row.difficulty,
    outcome: row.outcome,
    text: text.text,
    truncated: text.cut,
    posted_month: postedMonth(row.created_at),
    author_label: ANONYMOUS_LABEL,
  };
}
