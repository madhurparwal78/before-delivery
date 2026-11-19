import { STATUS_LABELS } from "../shared/copy.js";
import type { DrawingStatus } from "../shared/types.js";

export const statusLabel = (status: DrawingStatus): string => STATUS_LABELS[status];

/** `YYYY-MM-DD HH:MM` in UTC from an API instant. */
export const instantText = (iso: string | null): string => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "");

export const clockText = (iso: string): string => iso.slice(11, 16);

export const sailLabel = (sail: string): string => (sail === "mainsail" ? "Mainsail" : "Headsail");

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export const minutesSeconds = (total: number): string => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
