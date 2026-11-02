export interface Ref {
  id: string;
  name: string;
}

export interface AssetSummary {
  id: string;
  kind: string;
  description: string;
  owner: Ref;
  state: "draft" | "verified" | "deprecated";
  terms: Ref[];
  tagged_column_count: number;
  pii_column_count: number;
  confidential_column_count: number;
  deprecated_upstream: string | null;
}

export interface Column {
  id: string;
  name: string;
  data_type: string;
  direct_tags: string[];
  effective_tags: string[];
  suppressed_tags: string[];
  tag_sources: Record<string, string[]>;
  samples: string[];
  masked: boolean;
}

export interface AssetDetail extends AssetSummary {
  verified_at: string | null;
  evidence: {
    filename: string;
    content_type: string;
    size_bytes: number;
    sha256: string;
    uploaded_at: string;
    uploaded_by: Ref;
  } | null;
  deprecation: { reason: string; at: string; by: Ref } | null;
  columns: Column[];
}

export interface ColumnRead extends Column {
  asset: { id: string; state: string };
}

export interface FacetEntry {
  value: string;
  label: string;
  count: number;
}

export interface SearchBody {
  results: AssetSummary[];
  total: number;
  facets: { tag: FacetEntry[]; owner: FacetEntry[]; state: FacetEntry[]; term: FacetEntry[] };
  as_of_seq?: number;
  as_of_at?: string | null;
}

export interface Reached {
  column: string;
  asset: string;
  hop: number;
  carried_tags: string[];
  sealed_tags: string[];
  tag_sources: Record<string, string[]>;
}

export interface LineageEdge {
  from: string;
  to: string;
  transform: string;
  kind: "flow" | "seal" | "cycle";
}

export interface LineageBody {
  focus: string;
  direction: "downstream" | "upstream";
  focus_tags: string[];
  focus_tag_sources: Record<string, string[]>;
  reached: Reached[];
  edges: LineageEdge[];
  cycles: { from: string; to: string }[];
  assets: Record<string, { state: string; deprecated_upstream: string | null }>;
  totals: { columns: number; hops: number; cycles: number };
  truncated: boolean;
  summary: string;
}

export type FacetGroup = "tag" | "owner" | "state" | "term";
export const FACETS: { group: FacetGroup; label: string }[] = [
  { group: "tag", label: "Tag" },
  { group: "owner", label: "Owner" },
  { group: "state", label: "State" },
  { group: "term", label: "Term" },
];

/** Search state and the open asset and column, as held in the catalog URL (DP-17). */
export interface UrlState {
  q: string;
  tag: string;
  owner: string;
  state: string;
  term: string;
  asset: string;
  column: string;
  asOf: string;
}

export function readUrl(): UrlState {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get("q") ?? "",
    tag: p.get("tag") ?? "",
    owner: p.get("owner") ?? "",
    state: p.get("state") ?? "",
    term: p.get("term") ?? "",
    asset: p.get("asset") ?? "",
    column: p.get("column") ?? "",
    asOf: p.get("as_of") ?? "",
  };
}

export function urlFor(s: UrlState): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string) => v && p.set(k, v);
  put("q", s.q);
  put("tag", s.tag);
  put("owner", s.owner);
  put("state", s.state);
  put("term", s.term);
  put("asset", s.asset);
  put("column", s.column);
  put("as_of", s.asOf);
  const text = p.toString();
  return `/catalog${text ? `?${text}` : ""}`;
}
