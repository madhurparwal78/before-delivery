// JSON shapes of the API, as the browser reads them.
import type { Op } from '../shared/ot.ts';

export type FieldKind = 'text' | 'number' | 'date' | 'url' | 'select' | 'relation';
export interface FieldJson { name: string; kind: FieldKind; required: boolean; options: string[] | null; target_type_id: string | null }
export interface TypeJson { id: string; name: string; builtin: boolean; fields: FieldJson[] }

export type PropertyValue = string | number | null;

export interface BlockJson {
  id: string; object_id: string; kind: 'text' | 'quote' | 'attachment'; position: number; body: string | null; version: number | null;
  origin: null | { block_id: string; object_id: string; object_title: string; backlinks: number };
  attachment: null | { id: string; filename: string; content_type: string; size_bytes: number };
}

export interface ObjectJson {
  id: string; type_id: string; type_name: string; title: string; daily_date: string | null;
  properties: Record<string, PropertyValue>; share_visibility: 'follow' | 'never'; collection_ids: string[]; backlinks: number;
  created_at: string; updated_at: string; blocks?: BlockJson[];
}

export interface BacklinkJson { edge_id: string; from_object_id: string; from_title: string; kind: 'quote' | 'relation'; field_name: string | null; block_id: string | null }

export interface SessionJson {
  user: { email: string; display_name: string }; csrf_token: string; session_id: string; home_time_zone: string; theme: 'paper' | 'lamplight';
}

export interface DeviceSessionJson { id: string; label: string; created_at: string; last_seen_at: string; current: boolean }

export interface CollectionJson { id: string; name: string; object_count: number }

export interface ShareLinkJson {
  id: string; collection_id: string; url: string; status: 'active' | 'expired' | 'revoked'; expires_at: string; expires_at_display: string;
  expires_at_utc: string; time_zone: string; created_at: string; revoked_at: string | null;
}

export interface BoardJson {
  collection_id: string; cards: Array<{ object_id: string; title: string; x: number; y: number; stored: boolean }>;
  edges: Array<{ id: string; from: string; to: string }>;
}

export interface GraphNodeJson { id: string; title: string; type_id: string; type_name: string; collection_ids: string[]; backlinks: number; in_scope?: boolean }
export interface GraphJson { nodes: GraphNodeJson[]; edges: Array<{ id: string; from: string; to: string; kind: 'quote' | 'relation' }> }

export interface QueryJson { id: string; name: string; type_id: string; text: string; group_by: string | null; sort: Array<{ key: string; dir: 'asc' | 'desc' }> }
export interface QueryRowJson { id: string; title: string; type_name: string; backlinks: number; updated_at: string }
export interface QueryResultsJson { results: QueryRowJson[]; groups: null | Array<{ key: string | null; label: string; count: number; results: QueryRowJson[] }> }

export interface RevisionJson { version: number; body: string; plain: string; label: string; created_at: string }

export interface TimelineJson {
  today: string;
  days: Array<{ date: string; object_id: string | null; block_count: number; blocks: Array<{ id: string; kind: string; excerpt: string; movable: boolean }> }>;
}


// Live sync event payloads.
export interface BlockSavedEvent { object_id: string; block: BlockJson; ops: Op[] | null; base_version: number; label: string; edit_id: string | null }
export interface PresenceEvent { block_id: string; session_id: string; label: string; anchor: number | null; head: number | null }
