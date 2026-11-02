import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.ts";
import type { Tx } from "./db.ts";
import { termNameKey } from "./terms.ts";
import { serverTime, type Role, type Tag } from "./text.ts";
import { writeDerived } from "./graph.ts";

const SEED_PASSWORD = "strata-seed-2026";

const USERS: [string, string, string, Role][] = [
  ["u-morgan", "Morgan Ellery", "morgan.ellery@lakeshore-health.test", "Admin"],
  ["u-dana", "Dana Okafor", "dana.okafor@lakeshore-health.test", "Steward"],
  ["u-rui", "Rui Takahashi", "rui.takahashi@lakeshore-health.test", "Steward"],
  ["u-lena", "Lena Marsh", "lena.marsh@lakeshore-health.test", "Analyst"],
  ["u-omar", "Omar Haddad", "omar.haddad@lakeshore-health.test", "Analyst"],
  ["u-sam", "Sam Whitlock", "sam.whitlock@lakeshore-health.test", "Viewer"],
];

const TERMS: [string, string, string][] = [
  ["t-claim", "Claim", "A request for payment for a covered service."],
  ["t-eligibility-span", "Eligibility span", "A continuous period of coverage for one member."],
  ["t-member", "Member", "A person enrolled in a Lakeshore health plan."],
  ["t-paid-amount", "Paid amount", "Dollars paid on a claim after adjustments."],
  ["t-provider", "Provider", "A clinician or facility that bills the plan."],
  ["t-risk-score", "Risk score", "Modelled likelihood of high-cost care in the next 12 months."],
];

const ASSETS: [string, string, string, string[], string][] = [
  ["src.members", "table", "u-dana", ["t-member"], "Enrolled members, one row per member."],
  ["src.claims_legacy", "table", "u-dana", ["t-claim"], "Extract from the retired claims system."],
  ["stg.member_claims", "table", "u-rui", ["t-claim", "t-member"], "Claims joined to members for modelling."],
  ["scr.risk_scores", "table", "u-rui", ["t-risk-score"], "Member risk scores from the outreach model."],
  ["mart.claims_by_region", "table", "u-lena", ["t-paid-amount"], "Paid claims rolled up by 3-digit ZIP prefix."],
  ["mart.member_risk", "table", "u-lena", ["t-member", "t-risk-score"], "Members ranked by risk for outreach."],
  ["dash.claims_overview", "dashboard", "u-omar", ["t-paid-amount"], "Regional paid-claims dashboard."],
  ["dash.risk_outreach", "dashboard", "u-omar", ["t-risk-score"], "Outreach worklist dashboard."],
  ["src.eligibility_2019", "table", "u-morgan", ["t-eligibility-span"], "Eligibility spans from the 2019 feed."],
  ["stg.eligibility_spans", "table", "u-rui", ["t-eligibility-span"], "Cleaned eligibility spans."],
  ["ref.providers", "table", "u-dana", ["t-provider"], "Contracted providers."],
];

type SeedColumn = [string, string, Tag | null, [string, string][], string[]];

const COLUMNS: SeedColumn[] = [
  ["src.members.member_id", "integer", null, [], ["100231", "100232", "100233"]],
  ["src.members.ssn", "text", "PII", [], ["900-11-2041", "900-11-3378", "900-11-4402"]],
  ["src.members.full_name", "text", "PII", [], ["Avery Quill", "Jordan Pike", "Rowan Vale"]],
  ["src.members.date_of_birth", "date", "PII", [], ["1961-04-12", "1978-09-30", "1990-01-17"]],
  ["src.members.zip_code", "text", "Confidential", [], ["53202", "53704", "54301"]],
  ["src.claims_legacy.claim_id", "text", null, [], ["CL-0007781", "CL-0007782", "CL-0007783"]],
  ["src.claims_legacy.member_ssn", "text", "PII", [], ["900-11-2041", "900-11-3378", "900-11-4402"]],
  ["src.claims_legacy.diagnosis_code", "text", "Confidential", [], ["E11.9", "I10", "J45.909"]],
  ["src.claims_legacy.paid_amount", "numeric", null, [], ["412.50", "1280.00", "96.75"]],
  ["src.claims_legacy.service_date", "date", null, [], ["2026-03-02", "2026-03-09", "2026-03-15"]],
  ["stg.member_claims.claim_id", "text", null, [["copy", "src.claims_legacy.claim_id"]], ["CL-0007781", "CL-0007782", "CL-0007783"]],
  ["stg.member_claims.member_ssn", "text", null, [["join", "src.members.ssn"], ["copy", "src.claims_legacy.member_ssn"]], ["900-11-2041", "900-11-3378", "900-11-4402"]],
  ["stg.member_claims.diagnosis_code", "text", null, [["copy", "src.claims_legacy.diagnosis_code"]], ["E11.9", "I10", "J45.909"]],
  ["stg.member_claims.paid_amount", "numeric", null, [["cast", "src.claims_legacy.paid_amount"]], ["412.50", "1280.00", "96.75"]],
  ["stg.member_claims.zip_code", "text", null, [["join", "src.members.zip_code"]], ["53202", "53704", "54301"]],
  ["stg.member_claims.risk_score", "numeric", null, [["copy", "scr.risk_scores.risk_score"]], ["0.82", "0.41", "0.67"]],
  ["scr.risk_scores.member_key", "text", null, [["hash", "stg.member_claims.member_ssn"]], ["9f2c41d07ab3", "4e81aa0c55d2", "c03b7f19e6a4"]],
  ["scr.risk_scores.risk_score", "numeric", "Confidential", [["aggregate", "stg.member_claims.paid_amount"], ["copy", "stg.member_claims.risk_score"]], ["0.82", "0.41", "0.67"]],
  ["mart.claims_by_region.region_zip", "text", null, [["cast", "stg.member_claims.zip_code"]], ["532", "537", "543"]],
  ["mart.claims_by_region.total_paid", "numeric", null, [["aggregate", "stg.member_claims.paid_amount"]], ["18240.25", "9310.00", "4402.75"]],
  ["mart.claims_by_region.claim_count", "integer", null, [["aggregate", "stg.member_claims.claim_id"]], ["212", "118", "57"]],
  ["mart.member_risk.member_key", "text", null, [["copy", "scr.risk_scores.member_key"]], ["9f2c41d07ab3", "4e81aa0c55d2", "c03b7f19e6a4"]],
  ["mart.member_risk.member_ssn", "text", null, [["copy", "stg.member_claims.member_ssn"]], ["900-11-2041", "900-11-3378", "900-11-4402"]],
  ["mart.member_risk.risk_score", "numeric", null, [["copy", "scr.risk_scores.risk_score"]], ["0.82", "0.41", "0.67"]],
  ["dash.claims_overview.region", "text", null, [["rename", "mart.claims_by_region.region_zip"]], ["532", "537", "543"]],
  ["dash.claims_overview.total_paid", "numeric", null, [["copy", "mart.claims_by_region.total_paid"]], ["18240.25", "9310.00", "4402.75"]],
  ["dash.risk_outreach.member_ssn", "text", null, [["copy", "mart.member_risk.member_ssn"]], ["900-11-2041", "900-11-3378", "900-11-4402"]],
  ["dash.risk_outreach.risk_score", "numeric", null, [["copy", "mart.member_risk.risk_score"]], ["0.82", "0.41", "0.67"]],
  ["src.eligibility_2019.member_id", "integer", null, [], ["100231", "100232", "100233"]],
  ["src.eligibility_2019.plan_code", "text", null, [], ["HMO-GOLD", "PPO-SILVER", "HMO-BRONZE"]],
  ["src.eligibility_2019.coverage_start", "date", null, [], ["2019-01-01", "2019-04-01", "2019-07-01"]],
  ["stg.eligibility_spans.member_id", "integer", null, [["copy", "src.eligibility_2019.member_id"]], ["100231", "100232", "100233"]],
  ["stg.eligibility_spans.plan", "text", null, [["rename", "src.eligibility_2019.plan_code"]], ["HMO-GOLD", "PPO-SILVER", "HMO-BRONZE"]],
  ["stg.eligibility_spans.coverage_start", "date", null, [["cast", "src.eligibility_2019.coverage_start"]], ["2019-01-01", "2019-04-01", "2019-07-01"]],
  ["ref.providers.npi", "text", null, [], ["1003000126", "1003000134", "1003000142"]],
  ["ref.providers.provider_name", "text", null, [], ["Northgate Family Clinic", "Harbor Street Pediatrics", "Linden Cardiology"]],
];

/** The first-run catalog (DP-90): exactly the brief's seed records, at seq 0, with no audit rows. */
export async function writeSeed(tx: Tx): Promise<void> {
  for (const [id, name, email, role] of USERS) {
    await tx.query("insert into users(id, name, email, role, password_hash) values ($1, $2, $3, $4, $5)", [
      id, name, email, role, await hashPassword(SEED_PASSWORD),
    ]);
  }
  for (const [id, name, definition] of TERMS) {
    await tx.query("insert into terms(id) values ($1)", [id]);
    await tx.query(
      "insert into term_revisions(term_id, name, name_key, definition, revision, from_seq) values ($1, $2, $3, $4, 1, 0)",
      [id, name, termNameKey(name), definition],
    );
  }
  const now = serverTime();
  for (const [id, kind, owner, terms, description] of ASSETS) {
    await tx.query("insert into assets(id, kind, description, owner_id, registered_seq) values ($1, $2, $3, $4, 0)", [
      id, kind, description, owner,
    ]);
    for (const term of terms) {
      await tx.query("insert into term_links(asset_id, term_id, from_seq) values ($1, $2, 0)", [id, term]);
    }
    let deprecation: string | null = null;
    if (id === "src.eligibility_2019") {
      deprecation = randomUUID();
      await tx.query("insert into deprecation_events(id, asset_id, reason, at, by_id) values ($1, $2, $3, $4, $5)", [
        deprecation, id, "Replaced by the 2024 eligibility feed.", now, "u-morgan",
      ]);
    }
    await tx.query("insert into certifications(asset_id, state, deprecation_id, from_seq) values ($1, $2, $3, 0)", [
      id, deprecation ? "deprecated" : "draft", deprecation,
    ]);
  }
  const ordinals = new Map<string, number>();
  for (const [columnId, dataType, direct, , samples] of COLUMNS) {
    const asset = ASSETS.find(([id]) => columnId.startsWith(`${id}.`))![0];
    const ord = ordinals.get(asset) ?? 0;
    ordinals.set(asset, ord + 1);
    await tx.query("insert into columns(id, asset_id, name, data_type, samples, ord) values ($1, $2, $3, $4, $5, $6)", [
      columnId, asset, columnId.slice(asset.length + 1), dataType, JSON.stringify(samples), ord,
    ]);
    if (direct) await tx.query("insert into direct_tags(column_id, tag, from_seq) values ($1, $2, 0)", [columnId, direct]);
  }
  for (const [columnId, , , edgesIn] of COLUMNS) {
    for (const [transform, source] of edgesIn) {
      await tx.query("insert into edges(id, from_col, to_col, transform, from_seq) values ($1, $2, $3, $4, 0)", [
        randomUUID(), source, columnId, transform,
      ]);
    }
  }
  await writeDerived(tx);
}
