import type { Language } from "../../server/domain/towns.ts";

export type NoteKind = "tear" | "crack" | "stain" | "looseJoint" | "woodworm";

/** The page body from GET /api/client-pages/<token>. */
export interface ClientPageBody {
  language: Language;
  dir: "ltr" | "rtl";
  clientName: string;
  pieceTitle: string;
  dueDate: string;
  endsAt: string;
  estimateId: string | null;
  material: { name: string; code: string; lot: string | null } | null;
  estimate: { material: string; labour: string; subtotal: string; tax: string; total: string; milestones: string[] } | null;
  notes: { kind: NoteKind; note: string }[];
  answer: { seatHeightCm: string; typed: string; answeredAt: string } | null;
  signOff: { at: string; message: string } | null;
}

export interface ClientBoot {
  token: string;
  page: ClientPageBody;
  /** Whether a stored file of each side exists, so no picture is asked for that cannot arrive. */
  photographs: { before: boolean; after: boolean };
}
