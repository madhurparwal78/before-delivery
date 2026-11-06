export type FieldKind = 'text' | 'number' | 'date' | 'url' | 'select' | 'relation';

export type FieldDto = {
  name: string;
  kind: FieldKind;
  required: boolean;
  options: string[] | null;
  target_type_id: string | null;
};

export type TypeDto = { id: string; name: string; builtin: boolean; fields: FieldDto[] };

export type BlockDto = {
  id: string;
  object_id: string;
  kind: 'text' | 'quote' | 'attachment';
  position: number;
  body: string | null;
  version: number;
  origin: null | { block_id: string; object_id: string; object_title: string; backlinks: number };
  attachment: null | { id: string; filename: string; content_type: string; size_bytes: number };
};

export type ObjectDto = {
  id: string;
  type_id: string;
  type_name: string;
  title: string;
  daily_date: string | null;
  properties: Record<string, unknown>;
  share_visibility: 'follow' | 'never';
  collection_ids: string[];
  backlinks: number;
  created_at: string;
  updated_at: string;
  blocks?: BlockDto[];
};

export type BacklinkDto = {
  edge_id: string;
  from_object_id: string;
  from_title: string;
  kind: 'quote' | 'relation';
  field_name: string | null;
  block_id: string | null;
};

export type CollectionDto = { id: string; name: string; object_count: number };

export type ShareLinkDto = {
  id: string;
  collection_id: string;
  url: string;
  status: 'active' | 'expired' | 'revoked';
  expires_at: string;
  expires_at_display: string;
  expires_at_utc: string;
  time_zone: string;
  created_at: string;
  revoked_at: string | null;
};

export type SavedQueryDto = {
  id: string;
  name: string;
  type_id: string;
  text: string;
  group_by: string | null;
  sort: { key: string; dir: 'asc' | 'desc' }[];
};

export type QueryRowDto = {
  id: string;
  title: string;
  type_name: string;
  backlinks: number;
  updated_at: string;
};

export type QueryResultsDto = {
  results: QueryRowDto[];
  groups: null | { key: unknown; label: string; count: number; results: QueryRowDto[] }[];
};

export type GraphDto = {
  nodes: {
    id: string;
    title: string;
    type_id: string;
    type_name: string;
    collection_ids: string[];
    backlinks: number;
    in_scope?: boolean;
  }[];
  edges: { id: string; from: string; to: string; kind: 'quote' | 'relation' }[];
};

export type BoardDto = {
  collection_id: string;
  cards: { object_id: string; title: string; x: number; y: number; stored: boolean }[];
  edges: { id: string; from: string; to: string }[];
};

export type TimelineDto = {
  today: string;
  days: {
    date: string;
    object_id: string | null;
    block_count: number;
    blocks: { id: string; kind: string; excerpt: string; movable: boolean }[];
  }[];
};

export type RevisionDto = {
  version: number;
  body: string;
  plain: string;
  label: string;
  created_at: string;
};

export type DeviceSessionDto = {
  id: string;
  label: string;
  created_at: string;
  last_seen_at: string;
  current: boolean;
};

export type SearchResultDto = {
  object_id: string;
  title: string;
  type_name: string;
  score: number;
  snippet: { text: string; match: boolean }[];
};

export type BlockSearchResultDto = {
  block_id: string;
  object_id: string;
  object_title: string;
  excerpt: string;
};
