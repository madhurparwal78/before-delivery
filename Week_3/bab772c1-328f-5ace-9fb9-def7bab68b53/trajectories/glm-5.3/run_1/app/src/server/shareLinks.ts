// Share-link state. The single share-link state check used by every share
// route.

export type ShareState = "active" | "revoked" | "expired";

export interface ShareLinkRow {
  token: string;
  mission_id: string;
  created_at: string;
  expires_utc: string;
  revoked: boolean;
}

export function shareState(link: ShareLinkRow, nowMs: number): ShareState {
  if (link.revoked) return "revoked";
  if (Date.parse(`${link.expires_utc}`) <= nowMs) return "expired";
  return "active";
}

export const SHARE_ERROR_CODE: Record<ShareState, string | null> = {
  active: null,
  revoked: "link_revoked",
  expired: "link_expired",
};

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";

export function generateShareToken(): string {
  // At least 32 characters drawn from at least 128 random bits.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < bytes.length; i++) {
    token += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  while (token.length < 32) {
    token += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return token;
}

export const DEFAULT_EXPIRY_SECONDS = 2592000; // 30 days
