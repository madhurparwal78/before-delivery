export const CITIES = [
  { id: "harrowgate", name: "Harrowgate" },
  { id: "kelvane", name: "Kelvane" },
  { id: "brindlemoor", name: "Brindlemoor" },
  { id: "saltmere", name: "Saltmere" },
] as const;
export type CityId = (typeof CITIES)[number]["id"];

export const ROLE_FAMILIES = [
  { id: "research_assistant", name: "Research Assistant" },
  { id: "qc_analyst", name: "QC Analyst" },
  { id: "lab_manager", name: "Lab Manager" },
  { id: "core_facility", name: "Core Facility Specialist" },
] as const;
export type RoleFamilyId = (typeof ROLE_FAMILIES)[number]["id"];

export const WORK_PATTERNS = [
  { id: "on_site", name: "On site" },
  { id: "hybrid", name: "Hybrid" },
  { id: "remote", name: "Remote" },
] as const;
export type WorkPatternId = (typeof WORK_PATTERNS)[number]["id"];

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-1000"] as const;

export const PAY_BANDS = [
  { id: "under_4", name: "Under ₹4 lakh", floor: 0 },
  { id: "4_6", name: "₹4–6 lakh", floor: 400000 },
  { id: "6_8", name: "₹6–8 lakh", floor: 600000 },
  { id: "8_10", name: "₹8–10 lakh", floor: 800000 },
  { id: "10_plus", name: "₹10 lakh and over", floor: 1000000 },
] as const;
export type PayBandId = (typeof PAY_BANDS)[number]["id"];

export function payBandOf(payLow: number): PayBandId {
  const band = [...PAY_BANDS].reverse().find((candidate) => payLow >= candidate.floor);
  return band ? band.id : "under_4";
}

export const POST_KINDS = ["review", "pay_report", "interview_note"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const POST_KIND_NAMES: Record<PostKind, string> = {
  review: "review",
  pay_report: "pay report",
  interview_note: "interview note",
};

export const POST_STATES = ["pending", "claimed", "approved", "rejected"] as const;
export type PostState = (typeof POST_STATES)[number];

export const OUTCOMES = [
  { id: "offer", name: "Got an offer" },
  { id: "no_offer", name: "No offer" },
  { id: "no_reply", name: "Never heard back" },
] as const;
export type OutcomeId = (typeof OUTCOMES)[number]["id"];

export const REJECTION_REASONS = [
  "Identifies a person",
  "Not about this employer",
  "Abusive language",
  "Duplicate post",
  "Other",
] as const;

export const STAGES = [
  { id: "submitted", name: "Submitted" },
  { id: "screening", name: "Screening" },
  { id: "interview", name: "Interview" },
  { id: "offer", name: "Offer" },
  { id: "declined", name: "Declined" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export const ROLES = ["member", "moderator", "employer_admin", "recruiter", "founder"] as const;
export type Role = (typeof ROLES)[number];

export const JOB_STATUSES = ["draft", "listed", "closed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ANONYMOUS_LABEL = "Anonymous bench member";
export const PREVIEW_CHARS = 140;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function monthYear(postedMonth: string): string {
  const [year, month] = postedMonth.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return `${name ?? ""} ${year ?? ""}`;
}

export function nameOf<T extends { id: string; name: string }>(list: readonly T[], id: string): string {
  const found = list.find((entry) => entry.id === id);
  return found ? found.name : id;
}
