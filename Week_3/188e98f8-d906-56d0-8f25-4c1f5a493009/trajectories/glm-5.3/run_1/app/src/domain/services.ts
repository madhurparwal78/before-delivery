import { ARCHIVE_PAGE_CAP, ARCHIVE_PAGE_DEFAULT } from "./constants";
import type { Answer } from "./types";

/** The one archive time-sent format: the UTC HH:MM:SS of submitted_at, truncated. */
export function timeSent(submittedAtIso: string): string {
  return submittedAtIso.slice(11, 19);
}

interface CursorState {
  readonly afterId: number;
}

export function encodeCursor(afterId: number): string {
  return Buffer.from(String(afterId), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorState | undefined {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
  if (!/^\d{1,18}$/.test(raw)) return undefined;
  const id = Number.parseInt(raw, 10);
  if (!(id > 0)) return undefined;
  return { afterId: id };
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor: string | null;
}

export function resolveLimit(rawLimit: string | undefined): { limit: number } | { bad: true } {
  if (rawLimit === undefined) return { limit: ARCHIVE_PAGE_DEFAULT };
  if (!/^-?\d+$/.test(rawLimit)) return { bad: true };
  const value = Number.parseInt(rawLimit, 10);
  if (!Number.isSafeInteger(value) || value < 1) return { bad: true };
  return { limit: Math.min(value, ARCHIVE_PAGE_CAP) };
}

/** Case-fold and strip accents, so bjork finds Björk. */
export function foldText(text: string): string {
  const caseFolded = text.toLocaleLowerCase("en");
  return caseFolded.normalize("NFD").replace(/\p{M}/gu, "");
}

export function answerMatches(answer: Answer, queryFolded: string): boolean {
  return foldText(answer.text).includes(queryFolded);
}

/** The one table order: total highest first, then name in ascending code-point order. */
export function tableOrder(
  entries: readonly { team_id: number; name: string; total: number }[],
): { team_id: number; name: string; total: number; position: number }[] {
  const sorted = [...entries].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return nameCompare(a.name, b.name);
  });
  return sorted.map((entry, index) => ({ ...entry, position: index + 1 }));
}

export function nameCompare(a: string, b: string): number {
  const ac = [...a];
  const bc = [...b];
  const len = Math.min(ac.length, bc.length);
  for (let i = 0; i < len; i++) {
    const ca = ac[i]!.codePointAt(0)!;
    const cb = bc[i]!.codePointAt(0)!;
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  if (ac.length !== bc.length) return ac.length < bc.length ? -1 : 1;
  return 0;
}
