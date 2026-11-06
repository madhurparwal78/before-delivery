import type { SystemKindId, ZoneKindId } from './types';

export interface SystemKind {
  id: SystemKindId;
  name: string;
}

export interface ZoneKind {
  id: ZoneKindId;
  name: string;
  defaultZoneName: string;
}

export const SYSTEM_KINDS: readonly SystemKind[] = [
  { id: 'server', name: 'Server' },
  { id: 'database', name: 'Database' },
  { id: 'firewall', name: 'Firewall' },
  { id: 'router', name: 'Router' },
  { id: 'load_balancer', name: 'Load balancer' },
  { id: 'web_app', name: 'Web application' },
  { id: 'api_service', name: 'API service' },
  { id: 'payment_terminal', name: 'Payment terminal' },
  { id: 'workstation', name: 'Workstation' },
  { id: 'cloud_service', name: 'Cloud service' },
  { id: 'third_party', name: 'Third party' },
  { id: 'backup_storage', name: 'Backup storage' },
];

export const ZONE_KINDS: readonly ZoneKind[] = [
  { id: 'cde', name: 'Cardholder data environment', defaultZoneName: 'Cardholder Data Environment' },
  { id: 'connected', name: 'Connected-to', defaultZoneName: 'Connected-to systems' },
  { id: 'out_of_scope', name: 'Out of scope', defaultZoneName: 'Out of scope' },
];

const systemKindById = new Map<string, SystemKind>(SYSTEM_KINDS.map((k) => [k.id, k]));
const zoneKindById = new Map<string, ZoneKind>(ZONE_KINDS.map((k) => [k.id, k]));

export function isSystemKindId(value: unknown): value is SystemKindId {
  return typeof value === 'string' && systemKindById.has(value);
}

export function isZoneKindId(value: unknown): value is ZoneKindId {
  return typeof value === 'string' && zoneKindById.has(value);
}

export function systemKindName(id: SystemKindId): string {
  const kind = systemKindById.get(id);
  if (!kind) throw new Error(`unknown system kind ${id}`);
  return kind.name;
}

export function zoneKindName(id: ZoneKindId): string {
  const kind = zoneKindById.get(id);
  if (!kind) throw new Error(`unknown zone kind ${id}`);
  return kind.name;
}

export function zoneKindDefaultName(id: ZoneKindId): string {
  const kind = zoneKindById.get(id);
  if (!kind) throw new Error(`unknown zone kind ${id}`);
  return kind.defaultZoneName;
}

export const NEW_SHAPE_WIDTH = 144;
export const NEW_SHAPE_HEIGHT = 72;
export const NEW_ZONE_WIDTH = 480;
export const NEW_ZONE_HEIGHT = 336;
export const GRID = 24;
