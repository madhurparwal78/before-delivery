export type Cadence = "sixMonths" | "yearly";
export type Sex = "female" | "male";
export type TimeZoneKey = "newYork" | "chicago" | "denver" | "phoenix" | "losAngeles";
export type Flag = "belowRange" | "inRange" | "optimal" | "aboveRange";
export type DrawState = "booked" | "collected" | "ready" | "released" | "cancelled";
export type PacketTime = "morning" | "evening" | "split";
export type AccountState = "active" | "closing" | "erasing" | "erased";
export type MembershipState = "free" | "pending" | "active" | "cancelled";
export type Role = "owner" | "specialist" | "coordinator" | "billingLead" | "member";
export type MarkerSex = "female" | "male";
export type AgeBandKey = "age18To39" | "age40To59" | "age60Plus";
export type VisitPageState = "live" | "ended" | "none";
export type PlanState = "draft" | "published";
export type ThreadState = "open" | "handled";
export type AttachmentKind = "pdf" | "jpeg" | "png";
export type StaffRole = "owner" | "specialist" | "coordinator" | "billingLead";

export const CADENCE_LABEL: Record<Cadence, string> = {
  sixMonths: "Every 6 months",
  yearly: "Yearly",
};

export const SEX_LABEL: Record<Sex, string> = {
  female: "Female",
  male: "Male",
};

export const TIME_ZONE_LABEL: Record<TimeZoneKey, string> = {
  newYork: "New York time",
  chicago: "Chicago time",
  denver: "Denver time",
  phoenix: "Phoenix time",
  losAngeles: "Los Angeles time",
};

export const FLAG_LABEL: Record<Flag, string> = {
  belowRange: "Below range",
  inRange: "In range",
  optimal: "Optimal",
  aboveRange: "Above range",
};

export const DRAW_STATE_LABEL: Record<DrawState, string> = {
  booked: "Booked",
  collected: "Collected",
  ready: "Ready",
  released: "Released",
  cancelled: "Cancelled",
};

export const PACKET_TIME_LABEL: Record<PacketTime, string> = {
  morning: "Morning",
  evening: "Evening",
  split: "Split",
};

export const ACCOUNT_STATE_LABEL: Record<AccountState, string> = {
  active: "Active",
  closing: "Closing",
  erasing: "Erasing",
  erased: "Erased",
};

export const MEMBERSHIP_STATE_LABEL: Record<MembershipState, string> = {
  free: "Free",
  pending: "Plus · Pending",
  active: "Plus · Active",
  cancelled: "Plus · Ending",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Practice owner",
  specialist: "Longevity specialist",
  coordinator: "Care coordinator",
  billingLead: "Billing lead",
  member: "Member",
};

export const AGE_BAND_LABEL: Record<AgeBandKey, string> = {
  age18To39: "18–39",
  age40To59: "40–59",
  age60Plus: "60 and over",
};

export const VISIT_PAGE_STATE_LABEL: Record<VisitPageState, string> = {
  live: "Live",
  ended: "Ended",
  none: "None",
};

export const PLAN_STATE_LABEL: Record<PlanState, string> = {
  draft: "Draft",
  published: "Published",
};

export const THREAD_STATE_LABEL: Record<ThreadState, string> = {
  open: "Open",
  handled: "Handled",
};
