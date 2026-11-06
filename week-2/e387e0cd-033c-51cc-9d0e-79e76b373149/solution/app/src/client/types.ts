// The API's JSON shapes as the screens receive them (cents read as BigInt, amounts decimal strings).

export type Role = "compliance_officer" | "compliance_analyst" | "operations_lead" | "finance_lead" | "support_agent";

export interface SessionBody {
  member: { id: string; name: string; email: string; role: Role };
  workspace: { slug: string; name: string };
  home: string;
}

export interface WorkspaceBody {
  slug: string;
  name: string;
  legalName: string;
  lei: string;
  jurisdictionCode: string;
  timeZone: string;
  city: string;
  currency: string;
  confirmationLimitCents: bigint;
  today: string;
  now: string;
}

export type StationState = "pending" | "current" | "done" | "late" | "refused" | "not_required";

export interface Station {
  station: "screened" | "counterparty" | "data_sent" | "answered" | "closed";
  label: string;
  state: StationState;
  text: string;
  at: string | null;
}

export type CaseStatus =
  | "awaiting_ownership" | "in_review" | "awaiting_answer" | "accepted" | "rejected" | "no_response" | "cleared" | "released" | "returned";

export interface CaseBody {
  id: string;
  reference: string;
  createdAt: string;
  createdBy: { kind: "member"; name: string } | { kind: "partner_key"; label: string };
  asset: string;
  amount: string;
  destinationAddress: string;
  sendingAddress: string;
  wallet: "hosted" | "self_hosted";
  counterparty: { id: string; name: string; lei: string; jurisdictionCode: string; network: string } | null;
  originator: { customerId: string; name: string; identityNumber: string; dateOfBirth?: string } | null;
  beneficiaryName: string | null;
  fiatValueCents: bigint;
  currency: string;
  decidedUnder: {
    jurisdictionCode: string; thresholdCents: bigint | null; thresholdCurrency: string; ruleInForceSince: string | null;
    rateCents: bigint; confirmationLimitCents: bigint; counterpartyName: string | null; counterpartyRule: "in_force" | "no_rule" | null;
  };
  path: string;
  status: CaseStatus;
  dataSent: { channel: "network" | "request_page"; at: string; counterpartyNameAsSent: string } | null;
  answer: { decision: "accepted" | "rejected"; at: string; late: boolean; via: string } | null;
  answerDueAt: string | null;
  answerRemainingSeconds: number | null;
  ownership: { required: boolean; confirmedOn: string | null; recordedAt: string | null; recordedBy: string | null };
  review: {
    claim: { memberId: string; memberName: string; claimedAt: string; endsAt: string; remainingSeconds: number } | null;
    decision: { decision: "accept" | "reject"; reason: string; decidedBy: string; decidedAt: string } | null;
  } | null;
  requestPage: { status: "live" | "ended" | "answered"; sentAt: string; endsAt: string; remainingSeconds: number; contactEmail: string } | null;
  releaseReason: { text: string; recordedBy: string; recordedAt: string } | null;
  releaseAllowed: boolean;
  outcome: "released" | "returned" | null;
  closedAt: string | null;
  erasure: { status: "not_due" | "scheduled" | "pending" | "erased"; dueAt: string | null; erasedAt: string | null;
    digests: { kind: string; objectKey: string; sha256: string }[] };
  archived: boolean;
  archivedAt?: string | null;
  track: Station[];
  now: string;
}

export interface ArchivedCase {
  id: string;
  reference: string;
  archived: true;
  archivedAt: string;
  closedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  identityNumber: string;
  dateOfBirth?: string;
  depositAddress: string;
}

export interface Counterparty {
  id: string;
  legalName: string;
  lei: string;
  jurisdictionCode: string;
  licenceNumber: string;
  dueDiligence: "trusted" | "pending" | "restricted" | "blocked";
  network: "on_network" | "off_network";
  contactEmail: string | null;
  notes: string;
  updatedAt: string;
}

export interface CounterpartyDetail extends Counterparty {
  previousNames: { name: string; from: string; until: string }[];
  addresses: string[];
}

export interface RuleChange {
  id: string;
  thresholdCents: bigint;
  takesEffectOn: string;
  takesEffectAt: string;
  announcedBy: string | null;
  announcedAt: string;
  state: "scheduled" | "in_force";
}

export interface RuleBookEntry {
  code: string;
  name: string;
  currency: string;
  ruleInForce: { thresholdCents: bigint; since: string } | null;
  changes: RuleChange[];
}

export interface MessageSummary {
  id: string;
  messageId: string;
  type: "transfer" | "answer";
  receivedAt: string;
  sha256: string;
  sizeBytes: number;
  counterparty: { id: string; name: string };
  outcome: string;
}

export interface MessageDetail extends MessageSummary {
  working: Record<string, unknown>;
  nameCheck: { result: "match" | "partial" | "no_match"; customerId: string; customerName: string } | null;
}

export interface MonthBody {
  month: string;
  status: "open" | "ready" | "invoiced";
  messageCount: number;
  totalCents: bigint;
  currency: string;
  invoiceId: string | null;
  closedAt: string | null;
  lines?: { tier: number; label: string; count: number; unitPrice: string; amountCents: bigint }[];
}

export interface PartnerKey {
  id: string;
  label: string;
  startsWith: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface MemberBody {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Jurisdiction {
  code: string;
  name: string;
  region: string;
  currency: string;
  status: "in_force" | "announced" | "no_rule";
  thresholdCents: bigint | null;
  inForceSince: string | null;
  announcedChange: { thresholdCents: bigint; takesEffectOn: string } | null;
}

export interface Exchange {
  slug: string;
  name: string;
  jurisdictionCode: string;
  region: string;
  status: Jurisdiction["status"];
  onNetwork: boolean;
}
