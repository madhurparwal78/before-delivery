// API objects exactly as the brief's "Common objects" define them.
import type { DossierState } from "./dossier.ts";

export interface Account {
  id: string;
  email: string;
  display_name: string;
  time_zone: string;
  operator: boolean;
}

export interface Device {
  id: string;
  name: string;
  approved: boolean;
  created_at: string;
}

export type VaultRole = "owner" | "partner";

export interface Vault {
  id: string;
  name: string;
  role: VaultRole;
  created_at: string;
}

export interface KeyEnvelope {
  salt: string;
  iterations: number;
  iv: string;
  wrapped_key: string;
}

export interface VaultDetail {
  vault: Vault;
  key_envelope: KeyEnvelope;
  members: { display_name: string; role: VaultRole }[];
  head: number | null;
}

export interface Revision {
  rev: number;
  note_id: string;
  base_revision: number | null;
  ciphertext_sha256: string;
  byte_length: number;
  device_id: string;
  device_name: string;
  created_at: string;
  restored_from: number | null;
}

export type PreviewLinkState = "active" | "revoked" | "replaced" | "expired";

export interface PreviewLink {
  id: string;
  state: PreviewLinkState;
  created_at: string;
  expires_at: string;
}

export interface Dossier {
  id: string;
  slug: string;
  root_note_id: string;
  state: DossierState;
  radius: number | null;
  public_count: number | null;
  severed_count: number | null;
  published_at: string | null;
  url: string;
  preview_link: PreviewLink | null;
}

export type AddonName = "sync" | "publish";
export type AddonState = "none" | "active" | "ending" | "grace" | "lapsed";

export interface Addon {
  state: AddonState;
  period_end: string | null;
  checked_at: string;
  source: "killbill" | "cache";
}

export interface SyncAddon extends Addon {
  writable_until: string | null;
}

export interface PublishAddon extends Addon {
  warning_at: string | null;
  takedown_at: string | null;
}

export interface Billing {
  sync: SyncAddon;
  publish: PublishAddon;
}

export interface ManifestPreview {
  radius: number;
  public_count: number;
  severed_count: number;
  inside: { note_id: string; hop: number }[];
}

export interface OpsAccountRow {
  account: Account;
  sync: SyncAddon;
  publish: PublishAddon;
  vault_count: number;
  blob_count: number;
  stored_bytes: number;
  live_dossiers: { slug: string; published_at: string }[];
}

export interface SweepResult {
  warnings_sent: number;
  dossiers_taken_down: number;
  objects_removed: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    head_revision?: number | null;
    state?: DossierState;
  };
}
