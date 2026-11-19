// Rule identifiers across chapter versions: which are live, and which were withdrawn (brief: Chapters and versions).
import type { Tx } from "./db.ts";

interface LiveRule {
  identifier: string;
  slug: string;
  text: string;
  version: number;
}

interface PublishedRow {
  slug: string;
  number: number;
  statements: { identifier: string; text: string }[];
}

/** Statements of each chapter's published version, in chapter then statement order. */
export async function liveRules(tx: Tx): Promise<LiveRule[]> {
  const rows = await tx.q<PublishedRow>(
    `SELECT v.slug, v.number, v.statements FROM chapter_versions v JOIN chapters c ON c.slug = v.slug
      WHERE v.state = 'published' ORDER BY c.position`,
  );
  return rows.flatMap((row) => row.statements.map((s) => ({ identifier: s.identifier, slug: row.slug, text: s.text, version: row.number })));
}

/** Number of each chapter's published version. */
export async function publishedNumbers(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.q<{ slug: string; number: number }>("SELECT slug, number FROM chapter_versions WHERE state = 'published'");
  return new Map(rows.map((r) => [r.slug, r.number]));
}

/** The version that withdrew an identifier and its replacement, or null when no version withdrew it. */
export async function withdrawalOf(tx: Tx, identifier: string): Promise<{ withdrawnInVersion: number; replacedBy: string } | null> {
  const rows = await tx.q<{ number: number; withdrawn: { identifier: string; replacedBy: string }[] }>(
    "SELECT number, withdrawn FROM chapter_versions WHERE slug = $1 AND state IN ('published', 'superseded') ORDER BY number",
    [identifier.split(".")[0]],
  );
  for (const row of rows) {
    const entry = row.withdrawn.find((w) => w.identifier === identifier);
    if (entry) return { withdrawnInVersion: row.number, replacedBy: entry.replacedBy };
  }
  return null;
}
