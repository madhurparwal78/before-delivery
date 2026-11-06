import type { DossierState } from '../shared/lifecycle';
import { toIso } from '../shared/time';
import type { AccountRow, DeviceRow } from './auth';

export interface VaultRow {
  id: string;
  name: string;
  role: 'owner' | 'partner';
  created_at: Date;
}

export interface RevisionRow {
  rev: number;
  note_id: string;
  base_revision: number | null;
  ciphertext_sha256: string;
  byte_length: number;
  device_id: string;
  device_name: string;
  created_at: Date;
  restored_from: number | null;
}

export interface DossierRow {
  id: string;
  account_id: string;
  slug: string;
  root_note_id: string;
  state: DossierState;
  radius: number | null;
  public_count: number | null;
  severed_count: number | null;
  published_at: Date | null;
  live_publish_id: string | null;
}

export interface PreviewLinkRow {
  id: string;
  dossier_id: string;
  state: 'active' | 'revoked' | 'replaced' | 'expired';
  created_at: Date;
  expires_at: Date;
}

export function accountJson(account: AccountRow): Record<string, unknown> {
  return {
    id: account.id,
    email: account.email,
    display_name: account.display_name,
    time_zone: account.time_zone,
    operator: account.operator,
  };
}

export function deviceJson(device: DeviceRow): Record<string, unknown> {
  return {
    id: device.id,
    name: device.name,
    approved: device.approved,
    created_at: toIso(device.created_at),
  };
}

export function vaultJson(vault: VaultRow): Record<string, unknown> {
  return {
    id: vault.id,
    name: vault.name,
    role: vault.role,
    created_at: toIso(vault.created_at),
  };
}

export function revisionJson(revision: RevisionRow): Record<string, unknown> {
  return {
    rev: revision.rev,
    note_id: revision.note_id,
    base_revision: revision.base_revision,
    ciphertext_sha256: revision.ciphertext_sha256,
    byte_length: revision.byte_length,
    device_id: revision.device_id,
    device_name: revision.device_name,
    created_at: toIso(revision.created_at),
    restored_from: revision.restored_from,
  };
}

/** A link counts as expired from its expiry moment onward. */
export function previewLinkState(link: PreviewLinkRow, now: Date): PreviewLinkRow['state'] {
  if (link.state === 'active' && link.expires_at.getTime() <= now.getTime()) return 'expired';
  return link.state;
}

export function previewLinkJson(link: PreviewLinkRow, now: Date): Record<string, unknown> {
  return {
    id: link.id,
    state: previewLinkState(link, now),
    created_at: toIso(link.created_at),
    expires_at: toIso(link.expires_at),
  };
}

/** An in_review dossier falls back to draft once its link is no longer active. */
export function dossierState(dossier: DossierRow, newestLink: PreviewLinkRow | null, now: Date): DossierState {
  if (dossier.state !== 'in_review') return dossier.state;
  if (newestLink && previewLinkState(newestLink, now) === 'active') return 'in_review';
  return 'draft';
}

export function dossierJson(
  dossier: DossierRow,
  newestLink: PreviewLinkRow | null,
  now: Date,
): Record<string, unknown> {
  return {
    id: dossier.id,
    slug: dossier.slug,
    root_note_id: dossier.root_note_id,
    state: dossierState(dossier, newestLink, now),
    radius: dossier.radius,
    public_count: dossier.public_count,
    severed_count: dossier.severed_count,
    published_at: dossier.published_at ? toIso(dossier.published_at) : null,
    url: `/d/${dossier.slug}/`,
    preview_link: newestLink ? previewLinkJson(newestLink, now) : null,
  };
}
