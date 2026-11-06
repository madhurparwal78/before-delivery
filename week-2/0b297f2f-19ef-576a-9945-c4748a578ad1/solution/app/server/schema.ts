import type pg from "pg";
import { luxFigures, openHours } from "./domain/lux.js";
import { EVENT_KINDS } from "./events.js";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY, name text NOT NULL, role text NOT NULL CHECK (role IN ('curator','registrar','preparator')),
  position int NOT NULL);
CREATE TABLE IF NOT EXISTS lenders (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS exhibitions (
  id text PRIMARY KEY, title text NOT NULL, museum text NOT NULL, time_zone text NOT NULL,
  run_start date NOT NULL, run_end date NOT NULL, open_hours_per_day int NOT NULL, closed_weekdays int[] NOT NULL);
CREATE TABLE IF NOT EXISTS galleries (
  id text PRIMARY KEY, exhibition_id text NOT NULL REFERENCES exhibitions(id), name text NOT NULL);
CREATE TABLE IF NOT EXISTS walls (
  id text PRIMARY KEY, gallery_id text NOT NULL REFERENCES galleries(id), name text NOT NULL,
  length_mm int NOT NULL, height_mm int NOT NULL, planned_lux int NOT NULL, position int NOT NULL);
CREATE TABLE IF NOT EXISTS objects (
  id text PRIMARY KEY, object_number text NOT NULL UNIQUE, title text NOT NULL, medium text NOT NULL,
  lender_id text REFERENCES lenders(id), width_mm int NOT NULL, height_mm int NOT NULL, lux_limit int NOT NULL,
  lux_hour_budget bigint NOT NULL, insurance_value_gbp bigint NOT NULL, registrar_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY, object_id text NOT NULL REFERENCES objects(id), wall_id text NOT NULL REFERENCES walls(id),
  offset_mm int NOT NULL, centre_height_mm int NOT NULL, height_override boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','claimed','hung','signed_off','removed')),
  claimed_by text REFERENCES staff(id), version int NOT NULL,
  planned_lux int NOT NULL, planned_lux_hours bigint NOT NULL, lux_status text NOT NULL CHECK (lux_status IN ('within','over')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS placements_one_live_per_object ON placements(object_id) WHERE status <> 'removed';
CREATE TABLE IF NOT EXISTS undo_actions (
  id text PRIMARY KEY, placement_id text NOT NULL REFERENCES placements(id), staff_id text NOT NULL REFERENCES staff(id),
  kind text NOT NULL CHECK (kind IN ('remove','move')), previous jsonb NOT NULL, result_version int NOT NULL,
  undo_until timestamptz NOT NULL, undone boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY, object_id text NOT NULL REFERENCES objects(id), key text NOT NULL, bytes int NOT NULL,
  sha256 text NOT NULL, content_type text NOT NULL, attached_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS events (
  seq bigserial PRIMARY KEY, kind text NOT NULL CHECK (kind IN (${EVENT_KINDS.map((k) => `'${k}'`).join(",")})),
  at timestamptz NOT NULL DEFAULT now(), actor_id text REFERENCES staff(id),
  placement_id text, object_id text, wall_id text, preview_id text, title text, wall_name text, offset_mm int,
  planned_lux int, publish_at_display text, recipient_count int);
CREATE TABLE IF NOT EXISTS previews (
  id text PRIMARY KEY, exhibition_id text NOT NULL REFERENCES exhibitions(id),
  status text NOT NULL CHECK (status IN ('draft','scheduled','published','withdrawn')),
  date date, publish_at timestamptz, published_at timestamptz, withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (status <> 'scheduled' OR publish_at IS NOT NULL));
CREATE TABLE IF NOT EXISTS recipients (
  preview_id text NOT NULL REFERENCES previews(id), lender_id text NOT NULL REFERENCES lenders(id),
  lender_name text NOT NULL, email text NOT NULL, token text NOT NULL UNIQUE,
  works jsonb NOT NULL, delivery text NOT NULL CHECK (delivery IN ('queued','sent','cancelled')), sent_at timestamptz,
  notice text NOT NULL DEFAULT 'none' CHECK (notice IN ('none','queued','sent')),
  PRIMARY KEY (preview_id, lender_id));
CREATE TABLE IF NOT EXISTS idempotency_keys (
  staff_id text NOT NULL, route text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  status int NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, route, key));
`;

const STAFF = [
  ["cur-ines", "Ines Calloway", "curator"],
  ["reg-tomasz", "Tomasz Adeyemi", "registrar"],
  ["prep-ruth", "Ruth Okonkwo-Hale", "preparator"],
  ["prep-dev", "Dev Malhotra", "preparator"],
] as const;

const LENDERS = [
  ["lender-harbourside", "Harbourside Historical Society", "loans@harbourside-history.example"],
  ["lender-oduya", "Mirela Oduya", "mirela.oduya@example.net"],
  ["lender-fenwick", "Fenwick Maritime Trust", "registrar@fenwick-trust.example"],
] as const;

const NORTH = ["wall-north", "North wall", 12000, 4000, 50] as const;
const EAST = ["wall-east", "East wall", 6000, 4000, 50] as const;
const SOUTH = ["wall-south", "South wall", 12000, 4000, 150] as const;
const WEST = ["wall-west", "West wall", 6000, 4000, 150] as const;
const WALLS = [NORTH, EAST, SOUTH, WEST] as const;

const HERRING = ["obj-herring", "L-2027-001", "Herring Girls at the Gutting Station", "lender-harbourside", "Watercolour on paper", 560, 380, 50, 50000, 18000, "Slight foxing lower left; glazing replaced 2019."] as const;
const SAMPLER = ["obj-sampler", "L-2027-002", "Net Mending Sampler", "lender-harbourside", "Wool on linen", 450, 600, 50, 30000, 9500, "Loose stitching at upper edge; do not pin."] as const;
const GANSEYS = ["obj-ganseys", "L-2027-003", "Ganseys Drying", "lender-oduya", "Oil on canvas", 762, 610, 200, 150000, 42000, "Lender requires two-person handling."] as const;
const QUILT = ["obj-quilt", "L-2027-004", "Tide Chart Quilt", "lender-oduya", "Cotton patchwork", 1400, 1800, 50, 50000, 26000, "Hang on fabric batten only."] as const;
const SIGNAL = ["obj-signal", "L-2027-005", "Signal Flag Pattern Book", "lender-fenwick", "Ink and watercolour on paper", 280, 360, 50, 50000, 7200, "Open at plate 7 only."] as const;
const LOGBOOK = ["obj-logbook", "AS-1961-14", "Lighthouse Log, Skerrin Point", null, "Ink on paper", 300, 420, 50, 50000, 4000, ""] as const;
const SHORE = ["obj-shore", "AS-1974-02", "Shore Light, Evening", null, "Oil on board", 900, 700, 200, 150000, 31000, ""] as const;
const OBJECTS = [HERRING, SAMPLER, GANSEYS, QUILT, SIGNAL, LOGBOOK, SHORE] as const;

const PLACEMENTS = [
  ["pl-herring", HERRING, NORTH, 2000, "proposed", null],
  ["pl-ganseys", GANSEYS, SOUTH, 3000, "proposed", null],
  ["pl-shore", SHORE, SOUTH, 6000, "claimed", "prep-ruth"],
  ["pl-logbook", LOGBOOK, EAST, 1500, "hung", "prep-dev"],
] as const;

const RUN = { runStart: "2027-03-06", runEnd: "2027-06-27", openHoursPerDay: 7, closedWeekdays: [1] };

/** Seed data (brief: Seed data), inserted once; re-running changes nothing. */
export async function seed(client: pg.PoolClient): Promise<void> {
  const present = await client.query("SELECT 1 FROM exhibitions WHERE id = 'exh-salt'");
  if (present.rowCount) return;
  for (const [i, [id, name, role]] of STAFF.entries()) {
    await client.query("INSERT INTO staff (id, name, role, position) VALUES ($1,$2,$3,$4)", [id, name, role, i]);
  }
  for (const [i, [id, name, email]] of LENDERS.entries()) {
    await client.query("INSERT INTO lenders (id, name, email, position) VALUES ($1,$2,$3,$4)", [id, name, email, i]);
  }
  await client.query(
    `INSERT INTO exhibitions (id, title, museum, time_zone, run_start, run_end, open_hours_per_day, closed_weekdays)
     VALUES ('exh-salt','Salt and Thread','Ashgrove Museum of Art','Europe/London',$1,$2,$3,$4)`,
    [RUN.runStart, RUN.runEnd, RUN.openHoursPerDay, RUN.closedWeekdays],
  );
  await client.query("INSERT INTO galleries (id, exhibition_id, name) VALUES ('gal-east','exh-salt','East Gallery')");
  for (const [i, [id, name, length, height, lux]] of WALLS.entries()) {
    await client.query(
      "INSERT INTO walls (id, gallery_id, name, length_mm, height_mm, planned_lux, position) VALUES ($1,'gal-east',$2,$3,$4,$5,$6)",
      [id, name, length, height, lux, i],
    );
  }
  for (const [i, o] of OBJECTS.entries()) {
    await client.query(
      `INSERT INTO objects (id, object_number, title, lender_id, medium, width_mm, height_mm, lux_limit, lux_hour_budget,
        insurance_value_gbp, registrar_note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + make_interval(secs => $12::double precision))`,
      [...o, i / 1000],
    );
  }
  const hours = openHours(RUN);
  for (const [id, object, wall, offset, status, holder] of PLACEMENTS) {
    const [objectId, , , , , , , luxLimit, luxHourBudget] = object;
    const [wallId, , , , wallLux] = wall;
    const lux = luxFigures(wallLux, hours, luxLimit, luxHourBudget);
    await client.query(
      `INSERT INTO placements (id, object_id, wall_id, offset_mm, centre_height_mm, height_override, status, claimed_by,
        version, planned_lux, planned_lux_hours, lux_status) VALUES ($1,$2,$3,$4,1450,false,$5,$6,1,$7,$8,$9)`,
      [id, objectId, wallId, offset, status, holder, lux.plannedLux, lux.plannedLuxHours, lux.luxStatus],
    );
  }
  await client.query("INSERT INTO previews (id, exhibition_id, status) VALUES ('pv-salt-1','exh-salt','draft')");
}
