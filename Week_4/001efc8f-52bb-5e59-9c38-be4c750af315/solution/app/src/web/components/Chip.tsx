import { Ban, CalendarClock, Check, CheckCheck, Eye, Hourglass, Lock, Pencil, Pin, TriangleAlert } from "lucide-react";
import type { DeliveryChip } from "../chip";
import { ROLE_LABEL, type Role } from "../types";

// Stamped tag chips: a Lucide glyph plus a word, square corners, ink outline.
const GLYPH = {
  pending: Hourglass,
  sent: Check,
  delivered: CheckCheck,
  read: Eye,
  failed: TriangleAlert,
  pinned: Pin,
  edited: Pencil,
  private: Lock,
  scheduled: CalendarClock,
  cancelled: Ban,
} as const;

type ChipKind = keyof typeof GLYPH;

export function Chip({ kind, label, active = false, dimmed = false }: { kind: ChipKind; label: string; active?: boolean; dimmed?: boolean }) {
  const Glyph = GLYPH[kind];
  return (
    <span className={`chip chip-${kind}${active ? " chip-active" : ""}${dimmed ? " chip-dimmed" : ""}`}>
      <Glyph aria-hidden="true" focusable="false" size={16} strokeWidth={2} />
      <span>{label}</span>
    </span>
  );
}

export function DeliveryState({ chip }: { chip: DeliveryChip | { state: "pending" } | { state: "failed" } }) {
  switch (chip.state) {
    case "pending":
      return <Chip kind="pending" label="Pending" key="pending" />;
    case "failed":
      return <Chip kind="failed" label="Failed" key="failed" />;
    case "sent":
      return <Chip kind="sent" label="Sent" key="sent" />;
    case "delivered":
      return <Chip kind="delivered" label="Delivered" key="delivered" />;
    case "read":
      return <Chip kind="read" label={`Read · ${chip.count}`} active key={`read-${chip.count}`} />;
  }
}

export function RoleChip({ role }: { role: Role }) {
  return <span className="role-chip">{ROLE_LABEL[role]}</span>;
}
