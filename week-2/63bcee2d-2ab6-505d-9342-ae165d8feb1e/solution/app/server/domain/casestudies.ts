import { tokenHash } from "../auth.js";
import { one, type Db } from "../db.js";
import { illegalTransition } from "../http/errors.js";

// Case-study states and preview links (brief: Case studies). The one place a transition is allowed or
// refused, and the one place a preview link is judged live.

type CaseStudyState = "draft" | "preview_sent" | "client_approved" | "published" | "withdrawn";
export type CaseStudyAction = "send_preview" | "approve" | "publish" | "withdraw";

const MOVES: Record<CaseStudyAction, { from: CaseStudyState[]; to: CaseStudyState }> = {
  send_preview: { from: ["draft", "preview_sent"], to: "preview_sent" },
  approve: { from: ["preview_sent"], to: "client_approved" },
  publish: { from: ["client_approved"], to: "published" },
  withdraw: { from: ["published"], to: "withdrawn" },
};

/** The state after `action`, or 409 illegal_transition. */
export function nextState(state: CaseStudyState, action: CaseStudyAction): CaseStudyState {
  const move = MOVES[action];
  if (!move.from.includes(state)) throw illegalTransition(state, action);
  return move.to;
}

/** The director's moves open from `state`, by the same rule `nextState` enforces. */
export const directorActions = (state: CaseStudyState): CaseStudyAction[] =>
  (["send_preview", "publish", "withdraw"] as const).filter((action) => MOVES[action].from.includes(state));

export interface CaseStudyRow {
  id: string;
  title: string;
  slug: string;
  sector: "retail" | "workplace" | "food_beverage";
  brand_id: string;
  brand_name: string;
  location: string;
  summary: string;
  body: string;
  featured: boolean;
  featured_order: number | null;
  state: CaseStudyState;
  published_at: string | null;
}

export const CASE_STUDY_COLUMNS = `cs.id, cs.title, cs.slug, cs.sector, cs.brand_id, b.name AS brand_name, cs.location, cs.summary,
  cs.body, cs.featured, cs.featured_order, cs.state, cs.published_at`;
export const CASE_STUDY_FROM = "case_studies cs JOIN brands b ON b.id = cs.brand_id";

/** The case study behind a preview link that works now: not revoked or replaced, not expired, not withdrawn. */
export async function livePreview(db: Db, token: string): Promise<(CaseStudyRow & { link_id: string }) | undefined> {
  return one(db,
    `SELECT ${CASE_STUDY_COLUMNS}, pl.id AS link_id FROM preview_links pl JOIN ${CASE_STUDY_FROM} ON cs.id = pl.case_study_id
     WHERE pl.token_hash = $1 AND pl.revoked_at IS NULL AND pl.expires_at > now() AND cs.state <> 'withdrawn'`, [tokenHash(token)]);
}

/** Published case studies are the only ones the public site shows. */
export const PUBLISHED = "cs.state = 'published'";
