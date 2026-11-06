// Shared domain types for pages, diagrams and derived values.

export type SystemKindId =
  | 'server' | 'database' | 'firewall' | 'router' | 'load_balancer'
  | 'web_app' | 'api_service' | 'payment_terminal' | 'workstation'
  | 'cloud_service' | 'third_party' | 'backup_storage';

export type ZoneKindId = 'cde' | 'connected' | 'out_of_scope';

export type PortName = 'n' | 'e' | 's' | 'w';

export interface PortRef {
  shapeId: string;
  port: PortName;
}

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

export interface Connector {
  id: string;
  label: string;
  from: PortRef;
  to: PortRef;
  points: [number, number][];
}

export interface PageDocument {
  id: string;
  name: string;
  version: number;
  zones: Zone[];
  shapes: Shape[];
  connectors: Connector[];
}

export interface DerivedZone {
  id: string;
  systems: number;
  crossings: number;
  members: string[];
}

export interface CrossingPoint {
  zoneId: string;
  connectorId: string;
  x: number;
  y: number;
  direction: 'in' | 'out';
}

export interface Derived {
  zones: DerivedZone[];
  crossings: CrossingPoint[];
}

export const SYSTEM_KINDS: Readonly<Record<SystemKindId, string>> = {
  server: 'Server',
  database: 'Database',
  firewall: 'Firewall',
  router: 'Router',
  load_balancer: 'Load balancer',
  web_app: 'Web application',
  api_service: 'API service',
  payment_terminal: 'Payment terminal',
  workstation: 'Workstation',
  cloud_service: 'Cloud service',
  third_party: 'Third party',
  backup_storage: 'Backup storage',
};

export const ZONE_KINDS: Readonly<Record<ZoneKindId, { name: string; defaultName: string }>> = {
  cde: { name: 'Cardholder data environment', defaultName: 'Cardholder Data Environment' },
  connected: { name: 'Connected-to', defaultName: 'Connected-to systems' },
  out_of_scope: { name: 'Out of scope', defaultName: 'Out of scope' },
};

export const SYSTEM_KIND_IDS = Object.keys(SYSTEM_KINDS) as SystemKindId[];
export const ZONE_KIND_IDS = Object.keys(ZONE_KINDS) as ZoneKindId[];

export const GRID = 24;
export const NEW_SHAPE_WIDTH = 144;
export const NEW_SHAPE_HEIGHT = 72;
export const NEW_ZONE_WIDTH = 480;
export const NEW_ZONE_HEIGHT = 336;
export const MAX_ZONES_PER_PAGE = 20;
export const MAX_SHAPES = 500;
export const MAX_CONNECTORS = 1000;
export const MIN_SHAPE_SIZE = 16;
export const MAX_SHAPE_SIZE = 4000;
export const MIN_ZONE_SIZE = 80;
export const MAX_ZONE_SIZE = 20000;
export const MAX_LABEL_LENGTH = 200;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_PAGE_NAME = 80;
export const MAX_ZONE_NAME = 80;
export const MAX_TITLE = 120;
export const MAX_PAGES = 20;

export type Role = 'owner' | 'editor' | 'viewer';
