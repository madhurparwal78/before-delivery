export type Port = 'n' | 'e' | 's' | 'w';

export const PORTS: readonly Port[] = ['n', 'e', 's', 'w'];

export interface Zone {
  id: string;
  kind: ZoneKindId;
  name: string;
  note: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Shape {
  id: string;
  kind: SystemKindId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  groupId: string | null;
}

export interface ConnectorEnd {
  shapeId: string;
  port: Port;
}

export type PointTuple = [number, number];

export interface Connector {
  id: string;
  label: string;
  from: ConnectorEnd;
  to: ConnectorEnd;
  points: PointTuple[];
}

export interface PageDocument {
  id: string;
  name: string;
  version: number;
  zones: Zone[];
  shapes: Shape[];
  connectors: Connector[];
}

export type CrossingDirection = 'in' | 'out';

export interface DerivedZone {
  id: string;
  systems: number;
  crossings: number;
  members: string[];
}

export interface DerivedCrossing {
  zoneId: string;
  connectorId: string;
  x: number;
  y: number;
  direction: CrossingDirection;
}

export interface Derived {
  zones: DerivedZone[];
  crossings: DerivedCrossing[];
}

export type Role = 'owner' | 'editor' | 'viewer';

export type SystemKindId =
  | 'server'
  | 'database'
  | 'firewall'
  | 'router'
  | 'load_balancer'
  | 'web_app'
  | 'api_service'
  | 'payment_terminal'
  | 'workstation'
  | 'cloud_service'
  | 'third_party'
  | 'backup_storage';

export type ZoneKindId = 'cde' | 'connected' | 'out_of_scope';

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface SessionBody {
  user: { id: string; email: string; displayName: string };
  csrfToken: string;
}

export interface DiagramListItem {
  id: string;
  title: string;
  role: Role;
  updatedAt: string;
}

export interface DiagramPageRef {
  id: string;
  name: string;
  version: number;
}

export interface DiagramDetail {
  id: string;
  title: string;
  role: Role;
  ownerName: string;
  pages: DiagramPageRef[];
  updatedAt: string;
}

export type ShareStatus = 'invited' | 'expired' | 'active' | 'revoked' | 'withdrawn';

export interface ShareRow {
  id: string;
  email: string;
  displayName: string | null;
  role: 'editor' | 'viewer';
  status: 'invited' | 'expired' | 'active';
  delivery: 'sent' | 'queued';
  expiresAt: string | null;
}

export interface ExportFileRecord {
  format: 'png' | 'svg' | 'json';
  sizeBytes: number;
  sha256: string;
}

export interface ExportRecord {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  createdAt: string;
  createdBy: string;
  pageIds: string[];
  files: ExportFileRecord[];
}

export interface ImportRecord {
  id: string;
  pageId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface AuditEventRecord {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export interface InviteView {
  diagramTitle: string;
  inviterName: string;
  role: 'editor' | 'viewer';
  email: string;
  accountExists: boolean;
}

export interface PlatformStatus {
  storage: 'up' | 'down';
  mail: 'up' | 'down';
}
