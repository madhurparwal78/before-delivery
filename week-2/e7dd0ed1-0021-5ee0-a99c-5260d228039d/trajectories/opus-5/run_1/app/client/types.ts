export interface Identity {
  user: { id: string; name: string; email: string; operator: boolean };
  memberships: { workspace: { slug: string; name: string }; role: 'owner' | 'developer' | 'viewer' }[];
}

export interface Bucket {
  name: string;
  placement: string[];
  created_at: string;
  object_count: number;
  stored_bytes: number;
}

export interface RegionRecord {
  id: string;
  name: string;
  continent: string;
  lon: number;
  lat: number;
}

export interface ObjectRow {
  key: string;
  version_id: string;
  size: number;
  etag: string;
  content_type: string;
  last_modified: string;
  tags: Record<string, string>;
  replicas_settled: number;
  replicas_total: number;
}

export interface ObjectPage {
  items: ObjectRow[];
  common_prefixes: string[];
  next_cursor: string | null;
  truncated: boolean;
}

export interface VersionRow {
  version_id: string;
  etag: string;
  size: number;
  created_at: string;
  current: boolean;
  noncurrent_since: string | null;
  retain_until: string | null;
  legal_hold: boolean;
}

export interface ConsoleContext {
  identity: Identity;
  slug: string;
  workspaceName: string;
  role: 'owner' | 'developer' | 'viewer';
  buckets: Bucket[];
  regions: RegionRecord[];
  suspended: boolean;
  navigate: (url: string, options?: { replace?: boolean; focusKey?: string }) => void;
  refresh: () => Promise<void>;
}
