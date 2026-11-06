import type { Member } from "../auth";
import { one, rows, type Db } from "../db";
import { notFound, type Json } from "../http";
import { centimetresToMetres } from "../../shared/money";
import type { Base } from "../../shared/zones";

export interface YachtRow {
  id: string;
  workspace_slug: string;
  slug: string;
  name: string;
  base: Base;
  status: "on_sale" | "withdrawn";
  cabins: number;
  length_cm: number;
  beam_cm: number;
  draft_cm: number;
  battery_kwh: string;
  hotel_kw: string;
  solar_kw: string;
  drag_kw_per_kn_cubed: string;
  shore_power_kw: number;
  rate_low_minor: number;
  rate_shoulder_minor: number;
  rate_high_minor: number;
}

export type Season = "low" | "shoulder" | "high";

export function seasonRate(yacht: YachtRow, season: Season): number {
  return { low: yacht.rate_low_minor, shoulder: yacht.rate_shoulder_minor, high: yacht.rate_high_minor }[season];
}

export function ratesJson(yacht: YachtRow): Json {
  return { lowMinor: yacht.rate_low_minor, shoulderMinor: yacht.rate_shoulder_minor, highMinor: yacht.rate_high_minor };
}

export async function crewOf(db: Db, yachtId: string): Promise<{ id: string; name: string; position: string }[]> {
  return rows(db, "SELECT id, name, position FROM crew WHERE yacht_id = $1 ORDER BY sort", [yachtId]);
}

export async function profileJson(db: Db, yacht: YachtRow): Promise<Json> {
  return {
    slug: yacht.slug,
    name: yacht.name,
    base: yacht.base,
    status: yacht.status,
    cabins: yacht.cabins,
    lengthM: centimetresToMetres(yacht.length_cm),
    beamM: centimetresToMetres(yacht.beam_cm),
    draftM: centimetresToMetres(yacht.draft_cm),
    batteryKwh: Number(yacht.battery_kwh),
    hotelKw: Number(yacht.hotel_kw),
    solarKw: Number(yacht.solar_kw),
    dragKwPerKnCubed: Number(yacht.drag_kw_per_kn_cubed),
    shorePowerKw: yacht.shore_power_kw,
    rates: ratesJson(yacht),
    currency: "EUR",
    crew: await crewOf(db, yacht.id),
  };
}

export async function yachtBySlug(db: Db, workspace: string, slug: string, lock = false): Promise<YachtRow | undefined> {
  return one<YachtRow>(db, `SELECT * FROM yachts WHERE workspace_slug = $1 AND slug = $2${lock ? " FOR UPDATE" : ""}`, [workspace, slug]);
}

/** A yacht the member may see: another workspace's or, for a crew member, another yacht answers 404. */
export async function visibleYacht(db: Db, member: Member, slug: string, lock = false): Promise<YachtRow> {
  const yacht = await yachtBySlug(db, member.workspaceSlug, slug, lock);
  if (!yacht || (member.role === "crew_member" && yacht.id !== member.yachtId)) throw notFound();
  return yacht;
}

export async function visibleYachts(db: Db, member: Member): Promise<YachtRow[]> {
  const all = await rows<YachtRow>(db, "SELECT * FROM yachts WHERE workspace_slug = $1 ORDER BY name", [member.workspaceSlug]);
  return member.role === "crew_member" ? all.filter((y) => y.id === member.yachtId) : all;
}

export function energyProfile(yacht: YachtRow) {
  return {
    batteryKwh: Number(yacht.battery_kwh),
    hotelKw: Number(yacht.hotel_kw),
    solarKw: Number(yacht.solar_kw),
    dragKwPerKnCubed: Number(yacht.drag_kw_per_kn_cubed),
  };
}
