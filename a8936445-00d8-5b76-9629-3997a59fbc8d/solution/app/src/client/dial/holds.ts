// Placing a hold, shared by the drawn arc and the "Place hold" dialog.
import type { Hold } from "../../shared/api";
import { hhmm, kitchenParts } from "../../shared/time";
import { api, type ApiFailure } from "../api";
import { act, type Outcome } from "../feedback";

export interface HoldRequest {
  station_id: string;
  date: string;
  start_local: string;
  end_local: string;
  weeks: number;
  notes: string;
  tenant_id?: string;
}

export const TENANT_NOT_ACTIVE = "Your business can't book right now. Check Documents.";
export const DOCUMENT_EXPIRES = "A required document expires before this booking. Upload a renewal first.";

function clockTime(iso: string): string {
  const parts = kitchenParts(Date.parse(iso));
  return `${hhmm(parts.minute)}:${String(parts.second).padStart(2, "0")}`;
}

export function placeHold(request: HoldRequest, stationName: string): Promise<Outcome<Hold>> {
  return act(
    {
      pending: "Placing hold…",
      success: (hold) => `Hold ${hold.ref} placed. It expires at ${clockTime(hold.expires_at)}.`,
      error: (f: ApiFailure) => {
        if (f.code === "slot_taken") return `${stationName} isn't free for that whole time, including cleaning. Pick another gap.`;
        if (f.code === "tenant_not_active") return TENANT_NOT_ACTIVE;
        if (f.code === "document_expires_before_booking") return DOCUMENT_EXPIRES;
        if (f.code === "validation_failed") return "Check the start and end times.";
        return null;
      },
    },
    () => api<Hold>("POST", "/api/holds", { body: request }),
  );
}
