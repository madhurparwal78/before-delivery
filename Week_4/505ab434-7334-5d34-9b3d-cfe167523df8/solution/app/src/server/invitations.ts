// Invitations: a one-use activation token that expires on the app clock (brief: Services / Invitations).
import { createHash, randomBytes } from "node:crypto";
import type { Tx } from "./db.ts";
import { ApiError } from "./errors.ts";

export const invitationInvalid = (): ApiError => new ApiError(410, "invitation_invalid", "This invitation link is no longer valid.");

/** Only a hash of the token is stored; the mail carries the token itself. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const newInviteToken = (): string => randomBytes(24).toString("base64url");

interface InvitationRow {
  token: string;
  email: string;
  display_name: string;
  role: "agency" | "press";
  organisation_id: string;
}

/** The invitation for a token when it is unused and not yet expired at the app clock. */
export async function openInvitation(tx: Tx, token: string, lock = false): Promise<InvitationRow> {
  const row = await tx.one<InvitationRow>(
    `SELECT token, email, display_name, role, organisation_id FROM invitations
      WHERE token = $1 AND used_at IS NULL AND expires_at > $2${lock ? " FOR UPDATE" : ""}`,
    [hashToken(token), tx.now],
  );
  if (!row) throw invitationInvalid();
  return row;
}
