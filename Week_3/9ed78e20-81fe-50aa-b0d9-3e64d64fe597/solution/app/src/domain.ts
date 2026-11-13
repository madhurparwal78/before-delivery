import { validation, illegal } from "./errors.js";
import type {
  Content,
  ContentStatus,
  Claim,
  BenchmarkRow,
  ReleaseRecord,
  Stage,
  Grant,
  Benefits,
} from "./types.js";
export const subjects = {
  research: "Research",
  safety: "Safety",
  policy: "Policy",
  company: "Company",
};
export const offices: Record<string, { label: string; region: string }> = {
  london: { label: "London", region: "uk" },
  edinburgh: { label: "Edinburgh", region: "uk" },
  zurich: { label: "Zurich", region: "europe" },
  toronto: { label: "Toronto", region: "north-america" },
};
export const regions: Record<string, string> = {
  uk: "United Kingdom",
  europe: "Europe",
  "north-america": "North America",
};
export const comparators: Record<
  string,
  { name: string; organisation: string }
> = {
  "halvard-3": { name: "Halvard 3", organisation: "Brightline AI" },
  "morrow-l": { name: "Morrow L", organisation: "Teague Systems" },
};
export const stageLabels: Record<Stage, string> = {
  submitted: "Submitted",
  screening: "Screening",
  interview: "Interview",
  final_review: "Final review",
  offer: "Offer",
  declined: "Not progressing",
  withdrawn: "Withdrawn",
};
const contentMoves: Record<
  string,
  { from: ContentStatus[]; to: ContentStatus }
> = {
  submit: { from: ["draft", "returned"], to: "in_review" },
  return: { from: ["in_review"], to: "returned" },
  approve: { from: ["in_review"], to: "approved" },
  schedule: { from: ["approved"], to: "scheduled" },
  release: { from: ["scheduled"], to: "published" },
  withdraw: { from: ["scheduled", "published"], to: "withdrawn" },
};
export function contentMove(
  status: ContentStatus,
  verb: string,
): ContentStatus {
  const rule = contentMoves[verb];
  if (!rule || !rule.from.includes(status)) illegal(status, rule?.to || verb);
  return rule.to;
}
export function stageMove(from: Stage, to: Stage): void {
  const path: Partial<Record<Stage, Stage>> = {
    submitted: "screening",
    screening: "interview",
    interview: "final_review",
    final_review: "offer",
  };
  if (path[from] === to) return;
  if (activeStage(from) && ["declined", "withdrawn"].includes(to)) return;
  illegal(from, to);
}
export function activeStage(stage: Stage): boolean {
  return ["submitted", "screening", "interview", "final_review"].includes(
    stage,
  );
}
export const grantActive = (g: Grant): boolean =>
  !g.revoked_at &&
  Date.parse(g.granted_at) <= Date.now() &&
  Date.parse(g.expires_at) > Date.now();
const londonDate = (): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function benefitsInForce(
  entries: Benefits[],
  region: string,
): Benefits | null {
  return (
    entries
      .filter((e) => e.region === region && e.effective_from <= londonDate())
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ||
    null
  );
}
export function londonInstant(local: string, future = true): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(local))
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const complete = local.length === 16 ? local + ":00" : local;
  const naive = Date.parse(complete + "Z");
  if (
    !Number.isFinite(naive) ||
    new Date(naive).toISOString().slice(0, 19) !== complete
  )
    validation({ release_at_local: "Use the form YYYY-MM-DDTHH:mm." });
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const candidates = [naive - 3600000, naive].filter(
    (t) =>
      Number.isFinite(t) &&
      fmt.format(new Date(t)).replace(" ", "T") === complete,
  );
  if (!candidates.length)
    validation({
      release_at_local:
        "That time does not exist in London because the clocks go forward.",
    });
  const instant = Math.min(...candidates);
  if (future && instant <= Date.now())
    validation({ release_at_local: "Choose a time in the future." });
  return new Date(instant).toISOString().replace(".000Z", "Z");
}
// Body text as read: claim markers become their claim text, section markers drop.
export function readableBody(c: Content): string {
  return c.body
    .replace(
      /\[claim:(c\d+)\]/g,
      (_, id: string) => c.claims?.find((x) => x.id === id)?.text || "",
    )
    .replace(/^## /gm, "");
}
export function readTime(c: Content): number {
  return Math.max(
    1,
    Math.ceil(readableBody(c).trim().split(/\s+/).filter(Boolean).length / 225),
  );
}
// A record falls back to the state of whichever sign-offs remain.
export const signedStatus = (r: ReleaseRecord): ReleaseRecord["status"] =>
  r.safety && r.legal
    ? "signed"
    : r.safety
      ? "safety_signed"
      : r.legal
        ? "legal_signed"
        : "open";
// Numbers in claim text: names removed, letter-adjacent tokens and dates skipped.
export function claimNumbers(
  text: string,
  names: string[],
): { value: string; index: number }[] {
  let masked = text;
  for (const name of names.filter(Boolean))
    masked = masked.split(name).join(" ".repeat(name.length));
  masked = masked.replace(/\d{4}-\d{2}-\d{2}/g, (date) =>
    " ".repeat(date.length),
  );
  return [...masked.matchAll(/\d+(?:\.\d+)?/g)]
    .filter((m) => {
      const before = masked[m.index - 1] || "";
      const after = masked[m.index + m[0].length] || "";
      return !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
    })
    .map((m) => ({ value: m[0], index: m.index }));
}
export const emptyReleaseRecord = (): ReleaseRecord => ({
  status: "open",
  safety: null,
  legal: null,
  claims_validated_at: null,
  cleared_by: null,
  cleared_at: null,
  last_validation: null,
});
export function difference(model: string, comparator: string): string {
  const decimals = Math.max(
    model.split(".")[1]?.length || 0,
    comparator.split(".")[1]?.length || 0,
  );
  const power = 10 ** decimals;
  const value =
    (Math.round(Number(model) * power) -
      Math.round(Number(comparator) * power)) /
    power;
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}`;
}
export function sections(body: string): { id: string; heading: string }[] {
  return [...body.matchAll(/^## (.+)$/gm)].map((m, i) => ({
    id: `section-${i + 1}`,
    heading: m[1],
  }));
}
export function claimOrder(c: Content): Claim[] {
  const ids = [...c.body.matchAll(/\[claim:(c\d+)\]/g)].map((m) => m[1]);
  return [...new Set(ids)]
    .map((id) => c.claims?.find((x) => x.id === id))
    .filter((v): v is Claim => !!v);
}
export function validateClaims(
  c: Content,
  rows: BenchmarkRow[],
): {
  fields: Record<string, string>;
  results: { claim: string; ok: boolean; reason: string }[];
} {
  const fields: Record<string, string> = {};
  const results: { claim: string; ok: boolean; reason: string }[] = [];
  for (const marker of c.body.matchAll(/\[claim:(c\d+)\]/g))
    if (!c.claims?.some((x) => x.id === marker[1]))
      fields.body = `The body marks claim ${marker[1]}, which is not defined.`;
  for (const claim of c.claims || []) {
    let reason = "";
    const model = rows.find(
      (r) =>
        r.subject === c.slug &&
        r.benchmark === claim.benchmark &&
        r.eval_date === claim.eval_date,
    );
    const comparator = rows.find(
      (r) =>
        r.subject === claim.comparator &&
        r.benchmark === claim.benchmark &&
        r.eval_date === claim.eval_date,
    );
    if (!c.body.includes(`[claim:${claim.id}]`))
      reason = `Claim ${claim.id} is not marked in the body.`;
    else if (!model || !comparator)
      reason = `No recorded row for ${!model ? c.slug : claim.comparator} on ${claim.benchmark} at ${claim.eval_date}.`;
    else {
      const delta = difference(model.score, comparator.score);
      if (Number(claim.stated_delta) !== Number(delta))
        reason = `Stated difference ${claim.stated_delta} does not match the recorded difference ${delta}.`;
      else {
        const allowed = [
          Number(model.score),
          Number(comparator.score),
          Math.abs(Number(delta)),
        ];
        const stray = claimNumbers(claim.text, [
          c.title,
          ...Object.values(comparators).map((x) => x.name),
          claim.benchmark,
        ]).find((n) => !allowed.includes(Number(n.value)));
        if (stray)
          reason = `The number ${stray.value} in the claim text does not match the cited rows.`;
      }
    }
    if (reason) fields[claim.id] = reason;
    results.push({ claim: claim.id, ok: !reason, reason });
  }
  return { fields, results };
}
// Text lengths are Unicode code points after trimming.
export const codePoints = (value: string): number => [...value.trim()].length;
export const withinLength = (value: string, max: number): boolean =>
  codePoints(value) >= 1 && codePoints(value) <= max;
export function validName(value: string): boolean {
  return (
    withinLength(value, 120) && !/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)
  );
}
export function validEmail(value: string): boolean {
  const email = value.trim();
  const [local, domain, ...rest] = email.split("@");
  return (
    email.length <= 254 &&
    !rest.length &&
    domain !== undefined &&
    local.length > 0 &&
    domain.includes(".") &&
    !domain.startsWith(".") &&
    !domain.endsWith(".") &&
    !/[\r\n,; "<>\u0000-\u001f\u007f]/.test(email)
  );
}
export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();
export function validSlug(slug: string): boolean {
  return slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
export function requisitionMove(from: string, to: string): void {
  if (
    !(
      (from === "draft" && to === "open") ||
      (from === "open" && to === "closed")
    )
  )
    illegal(from, to);
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(value + "T00:00:00Z");
  return (
    Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 10) === value
  );
}
export function validScore(score: string): boolean {
  return (
    /^\d+(?:\.\d{1,2})?$/.test(score) &&
    Number(score) >= 0 &&
    Number(score) <= 100
  );
}
