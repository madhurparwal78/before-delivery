export const COLOR_NAMES = ['slate', 'blue', 'violet', 'green', 'amber', 'red'] as const
export type ColorName = (typeof COLOR_NAMES)[number]
export const DEFAULT_ENTITY_COLOR: ColorName = 'slate'
export const DEFAULT_GROUP_COLOR: ColorName = 'blue'

export type LinkToken = '>-' | '-<' | '--' | '>-<'
export type Cardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many'
export type DeleteAction = 'cascade' | 'restrict' | 'set null' | 'no action'
export type Dialect = 'postgresql' | 'mysql'
export type Role = 'owner' | 'editor' | 'viewer'
export type ShareAccess = 'view' | 'edit'

export const GRID_PX = 20
export const GRID_MAX = 500
export const CELLS_PER_ROW = 8
export const CELL_DX = 14
export const CELL_DY = 12
export const SHIFT_STEPS = 5

export const GROUP_NAME_MAX = 40
export const NAME_MAX = 64
/** The longest project name and version name, after trimming. */
export const NAME_MAX_LENGTH = 80
/** The longest lifetime a share can be created with. */
export const SHARE_EXPIRY_MAX_SECONDS = 31_536_000

export const CARDINALITY_OF: Record<LinkToken, Cardinality> = {
  '>-': 'many-to-one',
  '-<': 'one-to-many',
  '--': 'one-to-one',
  '>-<': 'many-to-many',
}

export const CARDINALITY_WORDS: Record<Cardinality, string> = {
  'many-to-one': 'many to one',
  'one-to-many': 'one to many',
  'one-to-one': 'one to one',
  'many-to-many': 'many to many',
}

export interface EntityLayout {
  x: number
  y: number
  color: ColorName
}

interface GroupLayout {
  color: ColorName
}

export interface Layout {
  entities: Record<string, EntityLayout>
  groups: Record<string, GroupLayout>
}

export interface Limits {
  textLimitBytes: number
  entityLimit: number
  statementLimit: number
  nestingLimit: number
}

export const DEFAULT_LIMITS: Limits = {
  textLimitBytes: 200000,
  entityLimit: 200,
  statementLimit: 1000,
  nestingLimit: 32,
}

export interface Person {
  userId: string
  displayName: string
}

export type AccessLossReason = 'role_changed' | 'removed' | 'revoked' | 'rotated' | 'expired'

export type ServerMessage =
  | { type: 'hello'; revision: number; text: string; layout: Layout; access: Role; presenceTimeoutSeconds: number }
  | { type: 'revision'; revision: number; text: string; by: Person }
  | { type: 'layout'; layout: Layout; by: Person }
  | { type: 'presence'; people: Person[]; linkViewers: number }
  | { type: 'access'; access: 'editor' | 'viewer' | 'none'; reason: AccessLossReason }


export interface UserJson {
  id: string
  email: string
  displayName: string
}

export interface ProjectJson {
  id: string
  name: string
  role: Role
  revision: number
  text: string
  layout: Layout
  errorCount: number
  owner: { id: string; displayName: string }
  updatedAt: string
  via?: 'link'
}

export interface ProjectSummary {
  id: string
  name: string
  role: Role
  revision: number
  entityCount: number
  updatedAt: string
}

export interface VersionJson {
  number: number
  name: string
  revision: number
  createdAt: string
  createdBy: { id: string; displayName: string }
  restoredFrom: number | null
}

export interface VersionDetail extends VersionJson {
  text: string
  layout: Layout
}

export interface Comparison {
  from: number
  to: number
  added: string[]
  removed: string[]
  changed: string[]
}

export type ShareStatus = 'active' | 'rotated' | 'revoked' | 'expired'
export type InvitationStatus = 'queued' | 'sent' | 'failed'

export interface ShareJson {
  id: string
  access: ShareAccess
  status: ShareStatus
  url: string
  token: string
  email: string | null
  invitation: null | { status: InvitationStatus; sentAt: string | null }
  expiresAt: string
  createdAt: string
  replacedBy: string | null
}

export interface MemberJson {
  userId: string
  displayName: string
  email: string
  role: 'editor' | 'viewer'
  joinedVia: string | null
}

export type ExportStatus = 'requested' | 'stored' | 'failed' | 'expired'

export interface ExportJson {
  id: string
  dialect: Dialect
  status: ExportStatus
  key: string
  bytes: number
  sha256: string
  fileName: string
  revision: number
  downloadUrl: string
  downloadExpiresAt: string
  createdAt: string
}

type ImportItemKind = 'table' | 'type' | 'index' | 'foreign key' | 'statement'
export type ImportItemStatus = 'added' | 'merged' | 'skipped' | 'ambiguous'

export interface ImportReportItem {
  line: number
  kind: ImportItemKind
  name: string
  status: ImportItemStatus
}

export interface ImportJson {
  id: string
  dialect: Dialect
  mode: 'merge' | 'replace'
  revision: number
  changed: boolean
  originalKey: string
  bytes: number
  sha256: string
  report: ImportReportItem[]
  notes: string[]
  counts: { added: number; merged: number; skipped: number; ambiguous: number }
}

export interface ImportRecord {
  id: string
  dialect: Dialect
  mode: 'merge' | 'replace'
  bytes: number
  sha256: string
  createdAt: string
}

export interface ApiErrorBody {
  error: string
  message: string
  fields?: Record<string, string>
  revision?: number
  text?: string
  conflicts?: Array<{ unit: string; by: string }>
  lines?: string[]
}

export interface ServiceStatus {
  storage: 'up' | 'down'
  mail: 'up' | 'down'
  checkedAt: string
}
