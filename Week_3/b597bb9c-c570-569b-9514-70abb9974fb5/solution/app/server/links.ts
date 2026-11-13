import { one } from "./db";

export interface LinkRow {
  id: string;
  project_id: string;
  cut_id: string;
  token: string;
  expires_at: Date;
  revoked: boolean;
  created_at: Date;
}

type LinkState = "active" | "expired" | "revoked";

export function linkState(link: LinkRow): LinkState {
  if (link.revoked) return "revoked";
  return Date.now() >= link.expires_at.getTime() ? "expired" : "active";
}

export function linkByToken(token: string): Promise<LinkRow | undefined> {
  return one<LinkRow>("SELECT * FROM review_links WHERE token = $1", [token]);
}
