// Every piece and firing status: its label in words beside the cone glyph, never colour alone.
import type { FiringStatus, PieceStatus } from "../../shared/api";
import { ConeGlyph } from "./ConeGlyph";

const BENT = new Set<string>(["firing", "cooling", "unloadable", "ready", "collected", "uncollected", "unloaded"]);
const DONE = new Set<string>(["ready", "collected", "unloaded", "unloadable"]);

export function Status({ status, label }: { status: PieceStatus | FiringStatus | null; label: string }) {
  const tone = status === "uncollected" ? " lapsed" : status && DONE.has(status) ? " done" : "";
  return (
    <span className={`status${tone}`}>
      <ConeGlyph bent={status !== null && BENT.has(status)} />
      <span>{label}</span>
    </span>
  );
}
