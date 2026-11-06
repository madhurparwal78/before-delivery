import type { EditableField, ItemAction, ItemStatus, PhotoKind, Role, Trade } from "./domain";

// The item lifecycle table from the brief, in one place. The server decides every
// online action and sync item_action with it; the browser uses the same table to
// show which buttons apply and to show an offline check-off before it syncs.

type Refusal = "awaiting_trade";

interface Rule {
  action: ItemAction;
  from: readonly ItemStatus[];
  to: ItemStatus;
  by: readonly Role[];
  /** Only for items without a trade; an item with a trade is refused with this code. */
  crewItemsOnly?: Refusal;
  /** An item with a trade needs a stored completion photo first. */
  needsCompletionPhoto?: true;
  /** Every blocker must be verified first. */
  needsBlockersVerified?: true;
  /** Requires a reason, stored as sent_back_reason. */
  needsReason?: true;
  clearsSentBackReason?: true;
}

const LIFECYCLE: readonly Rule[] = [
  { action: "start", from: ["open"], to: "in_progress", by: ["trade", "lead", "owner"] },
  {
    action: "mark_done",
    from: ["in_progress"],
    to: "ready_for_check",
    by: ["trade", "lead", "owner"],
    needsBlockersVerified: true,
    needsCompletionPhoto: true,
    clearsSentBackReason: true,
  },
  { action: "verify", from: ["ready_for_check"], to: "verified", by: ["lead", "owner"], needsBlockersVerified: true },
  {
    action: "verify",
    from: ["open", "in_progress"],
    to: "verified",
    by: ["lead", "owner"],
    needsBlockersVerified: true,
    crewItemsOnly: "awaiting_trade",
  },
  { action: "send_back", from: ["ready_for_check"], to: "in_progress", by: ["lead", "owner"], needsReason: true },
  { action: "reopen", from: ["verified"], to: "open", by: ["owner"] },
];

interface LifecycleItem {
  status: ItemStatus;
  trade: Trade | null;
}

type ActionDecision =
  | { ok: true; to: ItemStatus; needsReason: boolean; clearsSentBackReason: boolean }
  | { ok: false; error: "forbidden" | "invalid_transition" | "awaiting_trade" | "completion_photo_required" }
  | { ok: false; error: "blocked"; waitingOn: number[] };

/** What the server knows about an item beyond its status and trade when deciding an action. */
interface ActionFacts {
  hasCompletionPhoto: boolean;
  /** The numbers of the item's blockers that are not verified, ascending. */
  unverifiedBlockers: readonly number[];
}

/**
 * Decides an item action for a role. Role refusals come before state refusals, as the API's
 * error precedence puts 403 before 409; the 409s go invalid_transition, blocked,
 * awaiting_trade, completion_photo_required.
 */
export function decideAction(action: ItemAction, item: LifecycleItem, role: Role, facts: ActionFacts): ActionDecision {
  const rules = LIFECYCLE.filter((rule) => rule.action === action);
  if (!roleMayAct(action, role)) return { ok: false, error: "forbidden" };
  const rule = rules.find((candidate) => candidate.from.includes(item.status));
  if (!rule) return { ok: false, error: "invalid_transition" };
  if (rule.needsBlockersVerified && facts.unverifiedBlockers.length > 0) {
    return { ok: false, error: "blocked", waitingOn: [...facts.unverifiedBlockers] };
  }
  if (rule.crewItemsOnly && item.trade !== null) return { ok: false, error: rule.crewItemsOnly };
  if (rule.needsCompletionPhoto && item.trade !== null && !facts.hasCompletionPhoto) {
    return { ok: false, error: "completion_photo_required" };
  }
  return {
    ok: true,
    to: rule.to,
    needsReason: rule.needsReason === true,
    clearsSentBackReason: rule.clearsSentBackReason === true,
  };
}

/** Whether the lifecycle table lets a role take an action at all. */
export function roleMayAct(action: ItemAction, role: Role): boolean {
  return LIFECYCLE.some((rule) => rule.action === action && rule.by.includes(role));
}

/** Who may delete: the owner any unverified item, the lead carpenter an open item they created. */
export function deletion(role: Role, status: ItemStatus, isCreator: boolean): "allowed" | "forbidden" | "invalid_transition" {
  if (role === "owner") return status === "verified" ? "invalid_transition" : "allowed";
  return role === "lead" && status === "open" && isCreator ? "allowed" : "forbidden";
}

/** Who may edit which fields: the owner and lead any, a homeowner only the pin of an item they created. */
export function mayEditFields(role: Role, isCreator: boolean, fields: readonly EditableField[]): boolean {
  if (role === "owner" || role === "lead") return true;
  return role === "homeowner" && isCreator && fields.length > 0 && fields.every((field) => field === "pin");
}

/** Who uploads which photos: defect photos the crew, completion photos the crew and the assigned trade. */
export const PHOTO_UPLOADERS: Record<PhotoKind, readonly Role[]> = {
  defect: ["owner", "lead"],
  completion: ["owner", "lead", "trade"],
};

/** A trade can change only while the item is open or in progress. */
export function tradeChangeAllowed(status: ItemStatus): boolean {
  return status === "open" || status === "in_progress";
}

/**
 * The status an action leads to from a status, ignoring who acts and the photo and
 * trade rules: what a phone shows for an action made offline until the server decides.
 */
export function provisionalStatus(action: ItemAction, status: ItemStatus): ItemStatus | null {
  return LIFECYCLE.find((rule) => rule.action === action && rule.from.includes(status))?.to ?? null;
}

/**
 * The actions the table offers a role from a status, before the server's photo and trade
 * checks: the buttons a row shows. A refused check-off still shows, and is answered by the server.
 */
export function actionsFrom(status: ItemStatus, role: Role): ItemAction[] {
  return [...new Set(LIFECYCLE.filter((rule) => rule.from.includes(status) && rule.by.includes(role)).map((rule) => rule.action))];
}
