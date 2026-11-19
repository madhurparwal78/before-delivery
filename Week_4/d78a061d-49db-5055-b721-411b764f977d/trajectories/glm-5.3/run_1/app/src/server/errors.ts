import { tr, type Dict } from '../shared/i18n.js';
import type { Locale } from '../shared/domain.js';

/** Maps an API error code to the copy table entry from the brief. */
const codeToKey: Record<string, string> = {
  unauthenticated: 'sign-in-required',
  not_found: 'generic-error',
  forbidden: 'generic-error',
  not_leader: 'not-leader',
  email_unverified: 'email-unverified',
  cross_origin: 'generic-error',
  rate_limited: 'chat-cooldown',
  email_taken: 'email-taken',
  display_name_taken: 'display-name-taken',
  invalid_credentials: 'wrong-credentials',
  already_verified: 'generic-error',
  mail_unavailable: 'generic-error',
  link_used: 'link-used',
  link_replaced: 'link-replaced',
  link_expired: 'link-expired',
  stale_revision: 'stale-slot',
  model_not_accepted: 'model-not-accepted',
  wrong_story_mode: 'generic-error',
  chapter_locked: 'chapter-locked',
  already_friends: 'already-friends',
  request_pending: 'request-pending',
  idempotency_conflict: 'generic-error',
  request_closed: 'generic-error',
  already_in_party: 'already-in-party',
  party_full: 'party-full',
  wrong_state: 'generic-error',
  invite_closed: 'invite-closed',
  not_enough_members: 'too-few-members',
  no_ready_check: 'generic-error',
  already_answered: 'generic-error',
  storage_unavailable: 'generic-error',
  unsupported_type: 'not-gltf',
  not_gltf: 'not-gltf',
  too_large: 'upload-too-large',
  quota_exceeded: 'upload-quota',
  body_too_large: 'generic-error',
  session_ended: 'session-ended',
  session_complete: 'generic-error',
  not_a_member: 'seat-released',
  invalid_email: 'email-malformed',
  display_name_limit: 'display-name-limit',
  display_name_missing: 'display-name-limit',
  hero_name_limit: 'hero-name-limit',
  password_limit: 'password-limit',
  locale_invalid: 'generic-error',
  story_invalid: 'generic-error',
  account_id_invalid: 'not-a-friend',
  hero_invalid: 'hero-invalid',
  stroke_shape: 'stroke-shape',
  stroke_thickness: 'stroke-thickness',
  stroke_count: 'stroke-count',
  vertex_limit: 'vertex-limit',
  invalid_field: 'generic-error',
};

/** Field-specific error codes for 422 responses. */
const fieldCodeToKey: Record<string, string> = {
  email: 'email-malformed',
  password: 'password-limit',
  display_name: 'display-name-limit',
  locale: 'generic-error',
  name: 'hero-name-limit',
  proportions: 'hero-invalid',
  pose: 'hero-invalid',
  parts: 'hero-invalid',
  material: 'hero-invalid',
  accessories: 'hero-invalid',
  body: 'chat-limit',
  strokes: 'stroke-shape',
  thickness: 'stroke-thickness',
  vertices: 'vertex-limit',
  after_seq: 'generic-error',
  story_id: 'generic-error',
  chapter: 'chapter-invalid',
  account_id: 'not-a-friend',
  slot: 'generic-error',
  revision: 'generic-error',
};

export function messageForCode(code: string, locale: Locale, params: Record<string, string | number> = {}): string {
  const key = codeToKey[code] ?? 'generic-error';
  return tr(locale, 'copy', key, params);
}

export function messageForField(field: string, locale: Locale): string {
  const key = fieldCodeToKey[field] ?? 'generic-error';
  return tr(locale, 'copy', key);
}

export type { Dict };
