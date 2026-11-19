// Chapter versions: visibility, the state machine, identifier validation and the publication check
// (brief: Business rules / Chapters and versions). Each rule is decided here once.
import type { Tx } from "./db.ts";
import { ApiError, wrongState } from "./errors.ts";
import {
  IDENTIFIER_PATTERN,
  VERSION_STATE_WORDS,
  type Role,
  type VersionState,
} from "../shared/domain.ts";
import type { Principal, VersionView } from "../shared/api.ts";

export interface Statement {
  identifier: string;
  text: string;
}
export interface Withdrawal {
  identifier: string;
  replacedBy: string;
}

export interface VersionRow {
  id: string;
  slug: string;
  number: number;
  state: VersionState;
  author_id: string | null;
  revision: number;
  intro: string;
  statements: Statement[];
  asset_ids: string[];
  withdrawn: Withdrawal[];
  published_at: string | null;
  review_comment: string | null;
}

const COLUMNS = "id, slug, number, state, author_id, revision, intro, statements, asset_ids, withdrawn, published_at, review_comment";

export const OPEN_STATES: readonly VersionState[] = ["draft", "in_review", "approved"];
const EDITORS: readonly Role[] = ["author", "brand_reviewer", "owner"];

export const loadVersion = (tx: Tx, id: string, lock = false): Promise<VersionRow | undefined> =>
  tx.one<VersionRow>(`SELECT ${COLUMNS} FROM chapter_versions WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);

export const versionsOf = (tx: Tx, slug: string): Promise<VersionRow[]> =>
  tx.q<VersionRow>(`SELECT ${COLUMNS} FROM chapter_versions WHERE slug = $1 ORDER BY number`, [slug]);

/** Published and superseded versions are public; every other state is visible to authors, brand reviewers and the owner. */
export function canSee(principal: Principal | null, version: VersionRow): boolean {
  return version.state === "published" || version.state === "superseded" || (principal !== null && EDITORS.includes(principal.role));
}

export const canEdit = (principal: Principal): boolean => EDITORS.includes(principal.role);

export const toView = (row: VersionRow): VersionView => ({
  id: row.id,
  slug: row.slug,
  number: row.number,
  state: row.state,
  revision: row.revision,
  publishedAt: row.published_at,
  intro: row.intro,
  statements: row.statements,
  assetIds: row.asset_ids,
  withdrawn: row.withdrawn,
  reviewComment: row.review_comment,
});

/** Transitions: draft -> in_review -> approved -> published -> superseded, and in_review -> draft; others are 409. */
export function assertState(version: VersionRow, allowed: VersionState | readonly VersionState[]): void {
  const states = typeof allowed === "string" ? [allowed] : allowed;
  if (!states.includes(version.state)) throw wrongState(`Version ${version.number} is ${VERSION_STATE_WORDS[version.state]}.`);
}

const invalid = (code: string, message: string): ApiError => new ApiError(422, code, message);

/** Identifier rules for a saved draft, in statement order, then the replacement rule for withdrawn live identifiers. */
export async function validateDraft(tx: Tx, slug: string, statements: Statement[], withdrawn: Withdrawal[]): Promise<void> {
  const seen = new Set<string>();
  for (const { identifier } of statements) {
    if (identifier === "") continue;
    if (!IDENTIFIER_PATTERN.test(identifier)) throw invalid("identifier_invalid", `${identifier} is not a valid rule identifier.`);
    if (!identifier.startsWith(`${slug}.`)) throw invalid("identifier_prefix", `${identifier} must start with ${slug}.`);
    if (seen.has(identifier)) throw invalid("identifier_duplicate", `${identifier} appears twice.`);
    seen.add(identifier);
  }
  const live = await tx.one<{ statements: Statement[] }>("SELECT statements FROM chapter_versions WHERE slug = $1 AND state = 'published'", [slug]);
  for (const { identifier } of live?.statements ?? []) {
    if (seen.has(identifier)) continue;
    const entry = withdrawn.find((w) => w.identifier === identifier);
    if (!entry || !seen.has(entry.replacedBy)) throw invalid("replacement_missing", `${identifier} was removed without a replacement.`);
  }
}

/** Every statement of a version going to review needs an identifier. */
export function assertIdentified(version: VersionRow): void {
  if (version.statements.some((s) => s.identifier === "")) throw invalid("identifier_missing", "Every statement needs a rule identifier.");
}

/** 409 `publish_blocked` listing each referenced asset that is not released, in reference order. */
export async function assertPublishable(tx: Tx, version: Pick<VersionRow, "number" | "asset_ids">): Promise<void> {
  const rows = await tx.q<{ id: string; name: string; state: string }>("SELECT id, name, state FROM assets WHERE id = ANY($1)", [version.asset_ids]);
  const blocked = version.asset_ids.flatMap((id) => rows.filter((r) => r.id === id && r.state !== "released"));
  if (blocked.length > 0) {
    throw new ApiError(409, "publish_blocked", `Cannot publish version ${version.number}: ${blocked.map((a) => `${a.name} is ${a.state}`).join(", ")}.`);
  }
}

/** Makes a version published and supersedes the previous published version, in the caller's transaction. */
export async function markPublished(tx: Tx, versionId: string, slug: string): Promise<void> {
  await tx.q("UPDATE chapter_versions SET state = 'superseded' WHERE slug = $1 AND state = 'published'", [slug]);
  await tx.q("UPDATE chapter_versions SET state = 'published', published_at = $2 WHERE id = $1", [versionId, tx.now]);
}
