import type { ItemStatus, PartState } from "../api";

type OutlineWord = "missing" | "pending photo" | "out" | "reserved" | "held" | "on the wall";

/** The state word (and shape) of a part outline, from the part's state and its tool's status; first match wins. */
export function outlineWord(state: PartState, itemStatus: ItemStatus): OutlineWord {
  if (state === "missing") return "missing";
  if (state === "out") return itemStatus === "pending-photo" ? "pending photo" : "out";
  if (itemStatus === "reserved") return "reserved";
  if (itemStatus === "held") return "held";
  return "on the wall";
}

export const ITEM_WORD: Record<ItemStatus, string> = {
  "on-wall": "on the wall",
  reserved: "reserved",
  out: "out",
  "pending-photo": "pending photo",
  incomplete: "incomplete",
  held: "held",
};

export const LOAN_WORD: Record<string, string> = {
  reserved: "reserved",
  out: "out",
  "pending-photo": "pending photo",
  "returned-partial": "incomplete",
  "returned-complete": "returned",
};
