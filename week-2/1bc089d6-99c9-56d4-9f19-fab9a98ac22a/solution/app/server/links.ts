import type { Db } from "./db";
import { hashToken, newToken } from "./tokens";

/** Confirmation and sign-in tokens carry their purpose as a prefix, so the sign-in page can word its result. */
const PREFIX = { confirm: "c-", sign_in: "s-" } as const;

/** Records a one-time link for `email`; only the token's hash is stored. */
export async function issueLink(db: Db, email: string, purpose: "confirm" | "sign_in", draftId: string | null = null) {
  const token = PREFIX[purpose] + newToken();
  const hash = hashToken(token);
  await db.query("INSERT INTO links (token_hash, email, purpose, draft_id) VALUES ($1, $2, $3, $4)", [hash, email, purpose, draftId]);
  return { token, hash };
}
