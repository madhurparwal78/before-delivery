export type Zone = string;

export interface AccountRow {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  verified: boolean;
  confirmed_date_key: string | null;
  time_zone: string;
}

export interface SessionInfo {
  kind: "session";
  account: AccountRow;
}

export interface LinkInfo {
  kind: "link";
  shareId: string;
  token: string;
  access: "view" | "markup" | "edit";
  recipientName: string;
  recipientEmail: string;
  status: "active" | "expired" | "revoked";
}

export type Caller = { session: SessionInfo; link?: undefined } | { link: LinkInfo; session?: undefined } | { session: SessionInfo; link: LinkInfo };
