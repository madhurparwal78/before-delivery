export type Role = 'owner' | 'editor' | 'viewer';
export type PageKind = 'page' | 'reference';
export type PageState = 'draft' | 'in_preview' | 'published' | 'removed';
export type RedirectKind = 'auto' | 'manual';
export type PublishStatus = 'idle' | 'validating' | 'blocked' | 'uploading' | 'published' | 'failed';
export type InviteStatus = 'held' | 'sent' | 'accepted' | 'expired';

export type GateCode =
  | 'broken_link'
  | 'broken_anchor'
  | 'unknown_component'
  | 'invalid_component'
  | 'invalid_image'
  | 'duplicate_slug';

export interface UserRef {
  id: string;
  name: string;
}

export interface PageJson {
  id: string;
  versionId: string;
  path: string;
  title: string;
  kind: PageKind;
  operationId: string | null;
  source: string;
  revision: number;
  state: PageState;
  hasDraftChanges: boolean;
  updatedAt: string;
  updatedBy: UserRef;
}

interface NavGroup {
  id: string;
  title: string;
  pages: string[];
}

export interface NavTab {
  id: string;
  title: string;
  groups: NavGroup[];
}

export interface RedirectJson {
  from: string;
  to: string;
  kind: RedirectKind;
}

export interface NavigationJson {
  versionId: string;
  tabs: NavTab[];
  redirects: RedirectJson[];
}

export interface GateError {
  file: string;
  line: number;
  code: GateCode;
  message: string;
}

export interface PublishReport {
  versionId: string;
  status: PublishStatus;
  publishedAt: string | null;
  snapshotId: string | null;
  errors: GateError[];
}

export interface CheckResult {
  pages: number;
  changedPages: number;
  errors: GateError[];
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface MeJson {
  user: SessionUser;
  team: { id: string; name: string };
  role: Role;
}

export interface VersionJson {
  id: string;
  slug: string;
  title: string;
  default: boolean;
  publishedAt: string | null;
}

export interface SiteJson {
  id: string;
  slug: string;
  title: string;
  versions: VersionJson[];
}

export interface MemberJson {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface InviteJson {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  status: InviteStatus;
  createdAt: string;
  sentAt: string | null;
}

export interface TeamJson {
  id: string;
  name: string;
  members: MemberJson[];
  invites: InviteJson[];
}

export interface RenameResult {
  page: PageJson;
  navigation: NavigationJson;
  linksRewritten: number;
  redirectAdded: { from: string; to: string } | null;
  redirectRemoved: { from: string; to: string } | null;
}

export interface PreviewLinkJson {
  id: string;
  url: string;
  expiresAt: string;
  revoked?: boolean;
}

export interface OpenApiMeta {
  importId: string;
  fileName: string;
  bytes: number;
  sha256: string;
  importedAt: string;
}

export interface ImportResult {
  importId: string;
  groupId: string;
  pages: { id: string; path: string; title: string; operationId: string }[];
}

export interface AnalyticsJson {
  pageRatings: { pageId: string; title: string; versionSlug: string; yes: number; no: number; helpful: string }[];
  searchTerms: { term: string; searches: number; results: number }[];
}

export interface SearchResult {
  pageId: string;
  title: string;
  group: string;
  heading: string | null;
  url: string;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: SearchResult[];
}

/** An entry of the page index the editor boots with: everything the Pages tree shows. */
export interface PageSummary {
  id: string;
  path: string;
  title: string;
  kind: PageKind;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    cycle?: string[];
    savedBy?: UserRef;
    report?: PublishReport;
  };
}

/** What the server embeds in the editor shell so the first paint needs no extra request: one shape per screen. */
interface TeamBoot {
  me: MeJson;
  sites: SiteJson[];
}

interface SiteBoot extends TeamBoot {
  site: SiteJson;
}

interface VersionBoot {
  me: MeJson;
  site: SiteJson;
  version: VersionJson;
  pages: PageSummary[];
  navigation: NavigationJson;
  pagePath: string | null;
}

export type EditorBoot =
  | { route: 'signin'; next: string | null }
  | { route: 'invite'; invite: { teamName: string; valid: boolean; token: string } }
  | ({ route: 'home' } & TeamBoot)
  | ({ route: 'team'; team: TeamJson } & TeamBoot)
  | ({ route: 'analytics'; analytics: AnalyticsJson } & SiteBoot)
  | ({ route: 'editor' } & VersionBoot)
  | ({ route: 'redirects' } & VersionBoot);

export type BootOf<Route extends EditorBoot['route']> = Extract<EditorBoot, { route: Route }>;

/** Data the server embeds in every reader page. */
export interface ReaderBoot {
  mode: 'public' | 'draft' | 'shared';
  siteSlug: string;
  versionSlug: string;
  pageId: string | null;
  pageTitle: string;
  vote: 'yes' | 'no' | null;
  /** Published versions: where each leads from this page, and whether this page is missing from it. */
  versions: { slug: string; title: string; current: boolean; href: string; fallback: boolean }[];
  operationId: string | null;
}
