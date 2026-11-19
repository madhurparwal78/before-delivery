import type { Grade } from "./api";

export const gradeLine = (grade: Grade, open: number) =>
  `Grade ${grade.letter} — ${grade.label} · ${open} open ${open === 1 ? "defect" : "defects"}`;

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function utcDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function utcTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

export const utcStamp = (iso: string) => `${utcDate(iso)} ${utcTime(iso)} UTC`;

/** "in <h> h <m> min" from the server's expires_in_s. */
export function remaining(expiresInS: number): string {
  const h = Math.floor(expiresInS / 3600);
  const m = Math.floor((expiresInS % 3600) / 60);
  return `in ${h} h ${m} min`;
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const segmenter = new Intl.Segmenter("en-US", { granularity: "grapheme" });
export const graphemeCount = (text: string): number => {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
};

export const TYPE_LABEL: Record<string, string> = { hole: "Hole", tear: "Tear", chafe: "Chafe", fouling: "Fouling" };
export const METHOD_LABEL: Record<string, string> = { patch: "Patch", lace: "Lace", replace_panel: "Replace panel", clean: "Clean" };
