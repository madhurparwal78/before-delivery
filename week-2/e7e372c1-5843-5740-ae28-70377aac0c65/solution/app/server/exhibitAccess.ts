// Who may download an exhibit, and how conditional and range requests are answered.
// Decided from the database alone; the vault is only contacted to send bytes.

import { one, numberValue, text, type Queryable } from "./db.ts";

interface VisibleExhibit {
  sha256: string;
  accession: string;
  bytes: number;
  key: string;
  /** Cited by a published or superseded restatement. */
  published: boolean;
}

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Staff see any restatement's verified exhibit; everyone else only published or superseded ones. */
export async function visibleExhibit(q: Queryable, sha256: string, staff: boolean): Promise<VisibleExhibit | null> {
  if (!SHA256_PATTERN.test(sha256)) return null;
  const row = await one(
    q,
    `SELECT accession, exhibit_bytes, exhibit_key, state IN ('published', 'superseded') AS published
       FROM restatements WHERE exhibit_status = 'verified' AND exhibit_sha256 = $1
        AND ($2::boolean OR state IN ('published', 'superseded'))
      ORDER BY (state IN ('published', 'superseded')) DESC, created_at LIMIT 1`,
    [sha256, staff],
  );
  if (!row) return null;
  return { sha256, accession: text(row, "accession"), bytes: numberValue(row, "exhibit_bytes"), key: text(row, "exhibit_key"), published: row["published"] === true };
}

type ExhibitAnswer =
  | { kind: "not_modified" }
  | { kind: "unsatisfiable"; size: number }
  | { kind: "full" }
  | { kind: "partial"; first: number; last: number };

function matchesEtag(header: string | undefined, sha256: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((token) => {
    const candidate = token.trim().replace(/^W\//, "");
    return candidate === "*" || candidate === `"${sha256}"`;
  });
}

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

function singleRange(header: string | undefined, size: number): { first: number; last: number } | "unsatisfiable" | null {
  const match = header ? RANGE_PATTERN.exec(header.trim()) : null;
  if (!match) return null;
  const [, from = "", to = ""] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    const suffix = Number(to);
    return suffix === 0 ? "unsatisfiable" : { first: Math.max(0, size - suffix), last: size - 1 };
  }
  const first = Number(from);
  if (to !== "" && Number(to) < first) return null;
  if (first >= size) return "unsatisfiable";
  return { first, last: to === "" ? size - 1 : Math.min(Number(to), size - 1) };
}

export function answerExhibit(exhibit: VisibleExhibit, headers: { ifNoneMatch?: string; range?: string }): ExhibitAnswer {
  if (matchesEtag(headers.ifNoneMatch, exhibit.sha256)) return { kind: "not_modified" };
  const range = singleRange(headers.range, exhibit.bytes);
  if (range === "unsatisfiable") return { kind: "unsatisfiable", size: exhibit.bytes };
  return range ? { kind: "partial", ...range } : { kind: "full" };
}

interface ExhibitHeaders {
  /** Sent with every answer. */
  standing: Record<string, string>;
  /** Sent with the bytes: full or partial. */
  body: Record<string, string>;
}

export function exhibitHeaders(exhibit: VisibleExhibit): ExhibitHeaders {
  const standing = {
    ETag: `"${exhibit.sha256}"`,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": exhibit.published ? "public, max-age=31536000, immutable" : "private, no-store",
  };
  return {
    standing,
    body: {
      ...standing,
      "Content-Type": "application/pdf",
      "X-Exhibit-SHA256": exhibit.sha256,
      "Content-Disposition": `attachment; filename="${exhibit.accession}.pdf"`,
    },
  };
}

export function contentRange(answer: Exclude<ExhibitAnswer, { kind: "not_modified" | "full" }>, size: number): string {
  return answer.kind === "partial" ? `bytes ${answer.first}-${answer.last}/${size}` : `bytes */${answer.size}`;
}
