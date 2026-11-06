export type PortSide = "n" | "e" | "s" | "w";
export type Point = [number, number];

export const SYSTEM_KINDS = {
  server: "Server",
  database: "Database",
  firewall: "Firewall",
  router: "Router",
  load_balancer: "Load balancer",
  web_app: "Web application",
  api_service: "API service",
  payment_terminal: "Payment terminal",
  workstation: "Workstation",
  cloud_service: "Cloud service",
  third_party: "Third party",
  backup_storage: "Backup storage",
} as const;

export const ZONE_KINDS = {
  cde: { name: "Cardholder data environment", defaultName: "Cardholder Data Environment" },
  connected: { name: "Connected-to", defaultName: "Connected-to systems" },
  out_of_scope: { name: "Out of scope", defaultName: "Out of scope" },
} as const;

export type SystemKind = keyof typeof SYSTEM_KINDS;
export type ZoneKind = keyof typeof ZONE_KINDS;

export const SYSTEM_KIND_IDS = Object.keys(SYSTEM_KINDS) as SystemKind[];
export const ZONE_KIND_IDS = Object.keys(ZONE_KINDS) as ZoneKind[];

export function isSystemKind(value: unknown): value is SystemKind {
  return typeof value === "string" && Object.hasOwn(SYSTEM_KINDS, value);
}

export function isZoneKind(value: unknown): value is ZoneKind {
  return typeof value === "string" && Object.hasOwn(ZONE_KINDS, value);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Zone extends Rect {
  id: string;
  kind: ZoneKind;
  name: string;
  note: string;
}

export interface Shape extends Rect {
  id: string;
  kind: SystemKind;
  label: string;
  z: number;
  groupId: string | null;
}

export interface ConnectorEnd {
  shapeId: string;
  port: PortSide;
}

export interface Connector {
  id: string;
  label: string;
  from: ConnectorEnd;
  to: ConnectorEnd;
  points: Point[];
}

export interface PageDoc {
  id: string;
  name: string;
  version: number;
  zones: Zone[];
  shapes: Shape[];
  connectors: Connector[];
}

export type Direction = "in" | "out";

export interface CrossingPoint {
  zoneId: string;
  connectorId: string;
  x: number;
  y: number;
  direction: Direction;
}

export interface ZoneDerived {
  id: string;
  systems: number;
  crossings: number;
  members: string[];
}

export interface Derived {
  zones: ZoneDerived[];
  crossings: CrossingPoint[];
}

export const NEW_SHAPE_SIZE = { width: 144, height: 72 } as const;
export const NEW_ZONE_SIZE = { width: 480, height: 336 } as const;
export const GRID = 24;

export const LIMITS = {
  coordinate: 100000,
  shapeSize: { min: 16, max: 4000 },
  zoneSize: { min: 80, max: 20000 },
  label: 200,
  note: 2000,
  shapes: 500,
  connectors: 1000,
  zones: 20,
  pages: 20,
} as const;
