import type { Actor } from './auth.js';
import { notFound } from './http/errors.js';
import { query, queryOne } from './db.js';
import type { BaseKey } from '../shared/format.js';
import { metresFromCentimetres } from '../shared/format.js';

export interface YachtRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly slug: string;
  readonly name: string;
  readonly base: BaseKey;
  readonly status: 'on_sale' | 'withdrawn';
  readonly cabins: number;
  readonly length_cm: number;
  readonly beam_cm: number;
  readonly draft_cm: number;
  readonly battery_kwh: string;
  readonly hotel_kw: string;
  readonly solar_kw: string;
  readonly drag_kw_per_kn_cubed: string;
  readonly shore_power_kw: string;
  readonly rate_low_minor: string;
  readonly rate_shoulder_minor: string;
  readonly rate_high_minor: string;
  readonly currency: string;
  readonly seed_order: number;
}

export interface CrewRow {
  readonly id: string;
  readonly yacht_id: string;
  readonly name: string;
  readonly position: string;
  readonly seed_order: number;
}

export async function findYacht(workspaceId: string, slug: string): Promise<YachtRow | null> {
  return queryOne<YachtRow>('SELECT * FROM yachts WHERE workspace_id = $1 AND slug = $2', [
    workspaceId,
    slug,
  ]);
}

export async function listYachts(workspaceId: string): Promise<YachtRow[]> {
  return query<YachtRow>('SELECT * FROM yachts WHERE workspace_id = $1 ORDER BY name', [workspaceId]);
}

export function assertVisibleToActor(actor: Actor, yacht: YachtRow): void {
  if (actor.role === 'crew_member' && actor.yachtId !== yacht.id) throw notFound();
}

export async function requireYacht(actor: Actor, slug: string): Promise<YachtRow> {
  const yacht = await findYacht(actor.workspaceId, slug);
  if (yacht === null) throw notFound();
  assertVisibleToActor(actor, yacht);
  return yacht;
}


export async function crewOf(yachtId: string): Promise<CrewRow[]> {
  return query<CrewRow>('SELECT * FROM crew WHERE yacht_id = $1 ORDER BY seed_order', [yachtId]);
}


export function yachtRates(yacht: YachtRow): {
  lowMinor: bigint;
  shoulderMinor: bigint;
  highMinor: bigint;
} {
  return {
    lowMinor: BigInt(yacht.rate_low_minor),
    shoulderMinor: BigInt(yacht.rate_shoulder_minor),
    highMinor: BigInt(yacht.rate_high_minor),
  };
}

export function yachtEnergy(yacht: YachtRow): {
  batteryKwh: number;
  hotelKw: number;
  solarKw: number;
  dragKwPerKnCubed: number;
} {
  return {
    batteryKwh: Number(yacht.battery_kwh),
    hotelKw: Number(yacht.hotel_kw),
    solarKw: Number(yacht.solar_kw),
    dragKwPerKnCubed: Number(yacht.drag_kw_per_kn_cubed),
  };
}

export function yachtSize(yacht: YachtRow): {
  lengthCm: number;
  beamCm: number;
  draftCm: number;
} {
  return { lengthCm: yacht.length_cm, beamCm: yacht.beam_cm, draftCm: yacht.draft_cm };
}

export function metres(centimetres: number): number {
  return Number(metresFromCentimetres(centimetres));
}

export function yachtProfileJson(yacht: YachtRow, crew: readonly CrewRow[]): Record<string, unknown> {
  return {
    slug: yacht.slug,
    name: yacht.name,
    base: yacht.base,
    status: yacht.status,
    cabins: yacht.cabins,
    lengthM: metres(yacht.length_cm),
    beamM: metres(yacht.beam_cm),
    draftM: metres(yacht.draft_cm),
    batteryKwh: Number(yacht.battery_kwh),
    hotelKw: Number(yacht.hotel_kw),
    solarKw: Number(yacht.solar_kw),
    dragKwPerKnCubed: Number(yacht.drag_kw_per_kn_cubed),
    shorePowerKw: Number(yacht.shore_power_kw),
    rates: {
      lowMinor: Number(yacht.rate_low_minor),
      shoulderMinor: Number(yacht.rate_shoulder_minor),
      highMinor: Number(yacht.rate_high_minor),
    },
    currency: yacht.currency,
    crew: crew.map((member) => ({ id: member.id, name: member.name, position: member.position })),
  };
}

export function publicYachtJson(yacht: YachtRow): Record<string, unknown> {
  return {
    slug: yacht.slug,
    name: yacht.name,
    base: yacht.base,
    cabins: yacht.cabins,
    lengthM: metres(yacht.length_cm),
    beamM: metres(yacht.beam_cm),
    draftM: metres(yacht.draft_cm),
    rates: {
      lowMinor: Number(yacht.rate_low_minor),
      shoulderMinor: Number(yacht.rate_shoulder_minor),
      highMinor: Number(yacht.rate_high_minor),
    },
    currency: yacht.currency,
  };
}

export interface WorkspaceRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export async function findWorkspace(slug: string): Promise<WorkspaceRow | null> {
  return queryOne<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
}
