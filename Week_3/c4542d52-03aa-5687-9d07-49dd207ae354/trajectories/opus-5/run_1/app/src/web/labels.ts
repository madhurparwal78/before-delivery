import type { GrantState, OrderState, Role } from "../shared/types.js";

export const ROLE_LABELS: Record<Role, string> = {
  founder_admin: "Founder admin",
  board_member: "Board member",
  option_holder: "Option holder",
  leaver: "Leaver",
  investor: "Investor",
};

export const GRANT_STATE_WORDS: Record<GrantState, string> = {
  draft: "Draft",
  board_queue: "With the board",
  approved: "Approved",
  offered: "Offered",
  accepted: "Accepted",
  expired: "Expired",
};

export const ORDER_STATE_WORDS: Record<OrderState, string> = {
  pending: "Pending",
  held: "Held",
  issued: "Issued",
  cancelled: "Cancelled",
};
