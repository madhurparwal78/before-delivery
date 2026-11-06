// Display words for codes the API returns.
import type { AssignmentStatus, Role } from "./types";

export const LANGUAGES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "asl", name: "ASL" },
  { code: "es", name: "Spanish" },
  { code: "vi", name: "Vietnamese" },
  { code: "so", name: "Somali" },
  { code: "ar", name: "Arabic" },
];

export const SETTINGS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "hospital", name: "Hospital" },
  { code: "clinic", name: "Clinic" },
  { code: "school", name: "School" },
];

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

export function settingName(code: string): string {
  return SETTINGS.find((s) => s.code === code)?.name ?? code;
}

export const STATUS_LABELS: Record<AssignmentStatus, string> = {
  draft: "Awaiting release",
  released: "Open",
  partially_covered: "Partly covered",
  covered: "Covered",
  served: "Served",
  verified: "Verified",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export const ROLE_LABELS: Record<Role, string> = {
  scheduler: "Clinic scheduler",
  org_admin: "Client org admin",
  dispatcher: "Agency dispatcher",
  billing_lead: "Agency billing lead",
  interpreter: "Freelance interpreter",
};

export function coveredCount(seats: ReadonlyArray<{ status: string }>): number {
  return seats.filter((s) => s.status !== "open").length;
}
