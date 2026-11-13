import { apertureMm } from "../shared/optics";
import { TIME_ZONES } from "../shared/time";
import { newId, pool } from "./db";
import { Fields } from "./errors";
import type { Reply } from "./http";
import { loadKit } from "./views";

const obj = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

const between = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= low && value <= high;

function validName(fields: Fields, value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if ([...name].length < 1 || [...name].length > 60) fields.add("name");
  return name;
}

export async function getKit(accountId: string): Promise<Reply> {
  return { status: 200, body: await loadKit(pool, accountId) };
}

export async function addTelescope(accountId: string, raw: unknown): Promise<Reply> {
  const input = obj(raw);
  const fields = new Fields();
  const name = validName(fields, input.name);
  const unit = input.aperture_unit === "in" ? "in" : input.aperture_unit === "mm" ? "mm" : null;
  if (unit === null) fields.add("aperture_unit");
  const aperture = typeof input.aperture === "number" && unit ? apertureMm(input.aperture, unit) : NaN;
  if (!between(aperture, 25, 1600)) fields.add("aperture");
  if (!between(input.focal_length_mm, 100, 20000)) fields.add("focal_length_mm", "telescope_focal_length_mm");
  fields.check();
  const id = newId();
  await pool.query("INSERT INTO telescopes (id, account_id, name, aperture_mm, focal_length_mm) VALUES ($1,$2,$3,$4,$5)", [
    id,
    accountId,
    name,
    aperture,
    input.focal_length_mm,
  ]);
  return { status: 201, body: { id, name, aperture_mm: aperture, focal_length_mm: input.focal_length_mm } };
}

export async function addEyepiece(accountId: string, raw: unknown): Promise<Reply> {
  const input = obj(raw);
  const fields = new Fields();
  const name = validName(fields, input.name);
  if (!between(input.focal_length_mm, 2, 60)) fields.add("focal_length_mm", "eyepiece_focal_length_mm");
  if (!between(input.apparent_field_deg, 30, 120)) fields.add("apparent_field_deg");
  fields.check();
  const id = newId();
  await pool.query("INSERT INTO eyepieces (id, account_id, name, focal_length_mm, apparent_field_deg) VALUES ($1,$2,$3,$4,$5)", [
    id,
    accountId,
    name,
    input.focal_length_mm,
    input.apparent_field_deg,
  ]);
  return { status: 201, body: { id, name, focal_length_mm: input.focal_length_mm, apparent_field_deg: input.apparent_field_deg } };
}

export async function addBarlow(accountId: string, raw: unknown): Promise<Reply> {
  const input = obj(raw);
  const fields = new Fields();
  const name = validName(fields, input.name);
  if (!between(input.factor, 1.1, 5)) fields.add("factor");
  fields.check();
  const id = newId();
  await pool.query("INSERT INTO barlows (id, account_id, name, factor) VALUES ($1,$2,$3,$4)", [id, accountId, name, input.factor]);
  return { status: 201, body: { id, name, factor: input.factor } };
}

export async function listSites(accountId: string): Promise<Reply> {
  const { rows } = await pool.query("SELECT id, name, latitude, longitude, time_zone FROM sites WHERE account_id = $1 ORDER BY seq", [accountId]);
  return { status: 200, body: { sites: rows } };
}

export async function addSite(accountId: string, raw: unknown): Promise<Reply> {
  const input = obj(raw);
  const fields = new Fields();
  const name = validName(fields, input.name);
  if (!between(input.latitude, -90, 90)) fields.add("latitude");
  if (!between(input.longitude, -180, 180)) fields.add("longitude");
  if (typeof input.time_zone !== "string" || !(TIME_ZONES as readonly string[]).includes(input.time_zone)) fields.add("time_zone");
  fields.check();
  const id = newId();
  await pool.query("INSERT INTO sites (id, account_id, name, latitude, longitude, time_zone) VALUES ($1,$2,$3,$4,$5,$6)", [
    id,
    accountId,
    name,
    input.latitude,
    input.longitude,
    input.time_zone,
  ]);
  return { status: 201, body: { id, name, latitude: input.latitude, longitude: input.longitude, time_zone: input.time_zone } };
}
