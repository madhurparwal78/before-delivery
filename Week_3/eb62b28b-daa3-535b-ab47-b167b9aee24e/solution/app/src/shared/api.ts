// The published API shapes. The server builds these types and the browser checks every answer against them.

import { z } from "zod";
import { TIME_ZONES } from "./time";

export const Cadence = z.enum(["sixMonths", "yearly"]);
export type Cadence = z.infer<typeof Cadence>;

export const Role = z.enum(["owner", "specialist", "coordinator", "billingLead", "member"]);
export type Role = z.infer<typeof Role>;

export const Sex = z.enum(["female", "male"]);
export type Sex = z.infer<typeof Sex>;

const TimeZoneName = z.enum(TIME_ZONES);

export const AgeBand = z.enum(["age18To39", "age40To59", "age60Plus"]);
export type AgeBand = z.infer<typeof AgeBand>;

export const Flag = z.enum(["belowRange", "inRange", "optimal", "aboveRange"]);
export type Flag = z.infer<typeof Flag>;

export const DrawState = z.enum(["booked", "collected", "ready", "released", "cancelled"]);
export type DrawState = z.infer<typeof DrawState>;

export const AccountState = z.enum(["active", "closing", "erasing", "erased"]);
export type AccountState = z.infer<typeof AccountState>;

export const Packet = z.enum(["morning", "evening", "split"]);
export type Packet = z.infer<typeof Packet>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const SessionUser = z.object({ id: z.string(), name: z.string(), role: Role });
export type SessionUser = z.infer<typeof SessionUser>;
export const SessionView = z.object({ user: SessionUser, home: z.string(), expiresAt: z.string() });
export type SessionView = z.infer<typeof SessionView>;
export const SignedIn = z.object({ user: SessionUser, home: z.string() });

const PlanPrice = z.object({
  cadence: Cadence,
  months: z.number(),
  amountCents: z.number(),
  perMonthCents: z.number(),
});
export const PlansAnswer = z.object({
  plans: z.array(z.object({ id: z.string(), name: z.string(), prices: z.array(PlanPrice) })),
});
export type PlansAnswer = z.infer<typeof PlansAnswer>;

export const StatesAnswer = z.object({
  states: z.array(z.object({ state: z.string(), name: z.string(), served: z.boolean() })),
});
export const StateCheck = z.object({
  state: z.string(),
  name: z.string(),
  served: z.boolean(),
  message: z.string(),
});

const MarkerInfo = z.object({ id: z.string(), name: z.string(), unit: z.string(), decimals: z.number() });
export const MarkersAnswer = z.object({
  categories: z.array(z.object({ id: z.string(), name: z.string(), markers: z.array(MarkerInfo) })),
});
export type MarkersAnswer = z.infer<typeof MarkersAnswer>;

const Address = z.object({
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  postalCode: z.string(),
});

export const Membership = z.object({
  state: z.enum(["free", "pending", "active", "cancelled"]),
  cadence: Cadence.nullable(),
  renewalDate: z.string().nullable(),
  plusUntil: z.string().nullable(),
  pendingCadence: Cadence.nullable(),
  pendingFrom: z.string().nullable(),
});
export type Membership = z.infer<typeof Membership>;

export const MemberView = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: Sex.nullable(),
  state: z.string().nullable(),
  timeZone: TimeZoneName.nullable(),
  address: Address.nullable(),
  gateNotes: z.string().nullable(),
  accountState: AccountState,
  erasesAt: z.string().nullable(),
  membership: Membership,
});
export type MemberView = z.infer<typeof MemberView>;

export const BillingProjection = MemberView.pick({
  id: true,
  name: true,
  email: true,
  accountState: true,
  membership: true,
});
export type BillingProjection = z.infer<typeof BillingProjection>;

// A billing lead's answer has only the projection's keys, so the fuller fields are optional when read back.
export const MemberAnyView = BillingProjection.extend(
  MemberView.pick({
    phone: true,
    dateOfBirth: true,
    sex: true,
    state: true,
    timeZone: true,
    address: true,
    gateNotes: true,
    erasesAt: true,
  }).partial().shape,
);
export type MemberAnyView = z.infer<typeof MemberAnyView>;

export const MemberAnswer = z.object({ member: MemberAnyView });
export const MembersAnswer = z.object({ members: z.array(MemberAnyView) });
export const MemberSelfAnswer = z.object({ member: MemberView });
export const MembershipAnswer = z.object({ membership: Membership });

export const StaffView = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: Role,
});
export type StaffView = z.infer<typeof StaffView>;
export const StaffListAnswer = z.object({ staff: z.array(StaffView) });

export const Phlebotomist = z.object({ id: z.string(), name: z.string(), states: z.array(z.string()) });
export type Phlebotomist = z.infer<typeof Phlebotomist>;
export const PhlebotomistsAnswer = z.object({ phlebotomists: z.array(Phlebotomist) });

export const Slot = z.object({
  phlebotomistId: z.string(),
  phlebotomistName: z.string(),
  localTime: z.string(),
  startsAt: z.string(),
  free: z.boolean(),
});
export type Slot = z.infer<typeof Slot>;
export const SlotsAnswer = z.object({ slots: z.array(Slot) });

export const VisitPageView = z.object({
  state: z.enum(["live", "ended", "none"]),
  endsAt: z.string().nullable(),
});
export type VisitPageView = z.infer<typeof VisitPageView>;

export const DrawView = z.object({
  id: z.string(),
  memberId: z.string(),
  memberName: z.string().optional(),
  phlebotomistId: z.string(),
  phlebotomistName: z.string(),
  state: DrawState,
  startsAt: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  timeZone: TimeZoneName,
  collectedAt: z.string().nullable(),
  kitCodes: z.array(z.string()),
  hasResults: z.boolean(),
  changesCloseAt: z.string(),
  visitPage: VisitPageView,
});
export type DrawView = z.infer<typeof DrawView>;
export const DrawAnswer = z.object({ draw: DrawView });
export const DrawsAnswer = z.object({ draws: z.array(DrawView) });

export const VisitView = z.object({
  memberName: z.string(),
  startsAt: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  timeZone: TimeZoneName,
  isDrawDay: z.boolean(),
  address: Address.extend({ state: z.string() }).nullable(),
  gateNotes: z.string().nullable(),
  kitCodes: z.array(z.string()),
  state: z.enum(["booked", "collected"]),
  collectedAt: z.string().nullable(),
  endsAt: z.string(),
});
export type VisitView = z.infer<typeof VisitView>;
export const KitCodesAnswer = z.object({ kitCodes: z.array(z.string()) });
export const CollectAnswer = z.object({ state: z.literal("collected"), collectedAt: z.string() });

export const PreviewRow = z.object({
  row: z.number(),
  status: z.enum(["matched", "unknown", "refused"]),
  kitCode: z.string().optional(),
  marker: z.string().optional(),
  value: z.string().optional(),
  unit: z.string().optional(),
  source: z.object({ marker: z.string(), value: z.string(), unit: z.string() }).optional(),
  reason: z.string().optional(),
});
export type PreviewRow = z.infer<typeof PreviewRow>;
export const PreviewAnswer = z.object({ rows: z.array(PreviewRow) });
export const ResultsFileAnswer = z.object({ draw: DrawView, saved: z.number(), unchanged: z.number() });

export const RangeInForce = z.object({
  low: z.string(),
  high: z.string(),
  optimalLow: z.string(),
  optimalHigh: z.string(),
  effectiveFrom: z.string(),
});
export type RangeInForce = z.infer<typeof RangeInForce>;

export const ResultEntry = z.object({
  drawId: z.string(),
  collectedAt: z.string(),
  resultId: z.string(),
  value: z.string(),
  flag: Flag,
  ageBand: AgeBand,
  range: RangeInForce,
  note: z.string().nullable(),
  correctedBy: z.string().nullable(),
  correctedAt: z.string().nullable(),
});
export type ResultEntry = z.infer<typeof ResultEntry>;

export const MarkerResults = z.object({
  marker: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  decimals: z.number(),
  scale: z.object({ min: z.string(), max: z.string() }),
  draws: z.array(ResultEntry),
});
export type MarkerResults = z.infer<typeof MarkerResults>;
export const ResultsAnswer = z.object({ markers: z.array(MarkerResults) });
export const RangeRow = z.object({
  sex: Sex,
  ageBand: AgeBand,
  low: z.string(),
  high: z.string(),
  optimalLow: z.string(),
  optimalHigh: z.string(),
});
export type RangeRow = z.infer<typeof RangeRow>;
export const RangesAnswer = z.object({ marker: z.string(), effectiveFrom: z.string(), ranges: z.array(RangeRow) });
export const RangeChange = z.object({
  id: z.string(),
  marker: z.string(),
  effectiveFrom: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type RangeChange = z.infer<typeof RangeChange>;
export const RangeChangesAnswer = z.object({ changes: z.array(RangeChange) });

export const IngredientView = z.object({
  id: z.string(),
  name: z.string(),
  strength: z.object({ amount: z.string(), unit: z.string(), mcg: z.string().optional() }),
  time: Packet,
  priceCentsPerCapsule: z.number(),
});
export type IngredientView = z.infer<typeof IngredientView>;
export const IngredientsAnswer = z.object({ ingredients: z.array(IngredientView) });

export const PackedBlend = z.object({
  items: z.array(
    z.object({
      ingredient: z.string(),
      capsulesPerDay: z.number(),
      morning: z.number(),
      evening: z.number(),
    }),
  ),
  morningCapsules: z.number(),
  eveningCapsules: z.number(),
  listPriceCents: z.number(),
  memberPriceCents: z.number(),
});
export type PackedBlend = z.infer<typeof PackedBlend>;
export const BlendView = PackedBlend.extend({
  id: z.string(),
  memberId: z.string(),
  savedBy: z.string(),
  savedAt: z.string(),
});
export type BlendView = z.infer<typeof BlendView>;
export const BlendAnswer = z.object({ blend: BlendView });
export const NoBlendOrBlendAnswer = z.object({ blend: BlendView.nullable() });
export const BlendsAnswer = z.object({ blends: z.array(BlendView) });
export const PreviewBlendAnswer = z.object({ blend: PackedBlend });

export const PlanSections = z.object({
  nutrition: z.string(),
  movement: z.string(),
  sleep: z.string(),
  supplements: z.string(),
});
export type PlanSections = z.infer<typeof PlanSections>;
export const PlanView = z.object({
  id: z.string(),
  memberId: z.string(),
  state: z.enum(["draft", "published"]),
  basedOnPlanId: z.string().nullable(),
  sections: PlanSections,
  publishedAt: z.string().nullable(),
  publishedBy: z.string().nullable(),
  blend: BlendView.nullable(),
  updatedAt: z.string(),
});
export type PlanView = z.infer<typeof PlanView>;
export const PlanAnswer = z.object({ plan: PlanView });
export const MaybePlanAnswer = z.object({ plan: PlanView.nullable() });
export const PlansListAnswer = z.object({ plans: z.array(PlanView) });

export const MessageView = z.object({
  id: z.string(),
  from: z.object({ role: Role, name: z.string() }),
  body: z.string(),
  attachment: z.object({ id: z.string(), kind: z.enum(["pdf", "jpeg", "png"]), bytes: z.number() }).nullable(),
  sentAt: z.string(),
});
export type MessageView = z.infer<typeof MessageView>;
export const MessageAnswer = z.object({ message: MessageView });
export const MessagesAnswer = z.object({ messages: z.array(MessageView) });
export const ThreadView = z.object({
  memberId: z.string(),
  memberName: z.string(),
  state: z.enum(["open", "handled"]),
  lastMessageAt: z.string(),
});
export type ThreadView = z.infer<typeof ThreadView>;
export const ThreadsAnswer = z.object({ threads: z.array(ThreadView) });

export const ReceiptItem = z.object({
  id: z.string(),
  number: z.string(),
  memberName: z.string(),
  paidAt: z.string(),
  paidDate: z.string(),
  amountCents: z.number(),
  currency: z.string(),
});
export type ReceiptItem = z.infer<typeof ReceiptItem>;
export const ReceiptView = ReceiptItem.extend({
  invoiceId: z.string(),
  items: z.array(
    z.object({
      description: z.string(),
      periodStart: z.string().nullable(),
      periodEnd: z.string().nullable(),
      amountCents: z.number(),
    }),
  ),
  practice: z.object({ name: z.string(), address: z.string(), taxNumber: z.string() }),
});
export type ReceiptView = z.infer<typeof ReceiptView>;
export const ReceiptAnswer = z.object({ receipt: ReceiptView });
export const ReceiptListAnswer = z.object({ receipts: z.array(ReceiptItem) });
export const ReceiptPageAnswer = ReceiptListAnswer.extend({ nextCursor: z.string().nullable() });
export type ReceiptPage = z.infer<typeof ReceiptPageAnswer>;
