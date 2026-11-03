// Domain vocabulary shared by the server and the client. Rules live in server/domain.

export const SETTINGS = ["medical", "legal", "education", "community"] as const;
export type Setting = (typeof SETTINGS)[number];

export const SETTING_LABELS: Record<Setting, string> = {
  medical: "Medical",
  legal: "Legal",
  education: "Education",
  community: "Community",
};

export const CREDENTIAL_TYPES = ["NIC", "CDI", "SC:L", "EIPA-4.0"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const ROLES = ["coordinator", "interpreter", "requester", "consumer", "billing"] as const;
export type Role = (typeof ROLES)[number];

export const GATES = [
  { gate: "credential", label: "Credential" },
  { gate: "validity", label: "Valid on date" },
  { gate: "schedule", label: "Schedule" },
  { gate: "consumer", label: "Consumer" },
] as const;
export type GateKey = (typeof GATES)[number]["gate"];
export type GateLabel = (typeof GATES)[number]["label"];

export const REQUEST_STATUSES = [
  "draft",
  "submitted",
  "partially_staffed",
  "staffed",
  "completed",
  "invoiced",
  "cancelled_on_time",
  "cancelled_late",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type SeatStatus = "open" | "offered" | "accepted";
export type OfferStatus = "active" | "accepted" | "declined" | "expired" | "withdrawn";
export type TimesheetStatus = "submitted" | "approved";

/** The three seeded requester organisations, in the order the Invoices picker lists them. */
export const ORGANISATIONS = [
  { id: "birchmere-clinic", name: "Birchmere Community Clinic" },
  { id: "kestrel-court", name: "Kestrel County Circuit Court" },
  { id: "larchfield-schools", name: "Larchfield School District" },
] as const;
