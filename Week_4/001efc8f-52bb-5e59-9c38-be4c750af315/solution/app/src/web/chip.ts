import type { Message } from "./types";

// The delivery-state chip of a stored own message, derived from its counts (brief: Derived counts).
export type DeliveryChip = { state: "sent" } | { state: "delivered" } | { state: "read"; count: number };

export function deliveryChip(message: Pick<Message, "delivered_count" | "read_count">): DeliveryChip {
  if (message.delivered_count === 0) return { state: "sent" };
  if (message.read_count === 0) return { state: "delivered" };
  return { state: "read", count: message.read_count };
}
