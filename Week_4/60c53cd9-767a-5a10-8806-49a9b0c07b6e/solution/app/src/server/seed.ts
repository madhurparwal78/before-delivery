/** First-start seeding: accounts, units, price versions, the seeded holds, and the tower assets in the bucket. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_UNITS, BANDS, STACKS, bandOf, facingOf, seedPrice, type Band } from "../shared/domain.js";
import type { AppClock } from "./clock.js";
import type { Config } from "./config.js";
import type { Database, Tx } from "./db.js";
import { hashPassword } from "./accounts.js";
import { bearingsFromPlate } from "./glb.js";
import { CONTENT_TYPE } from "./images.js";
import type { ObjectStore } from "./s3.js";

const SEED_DIR = fileURLToPath(new URL("../../assets/seed/", import.meta.url));

const SEED_ACCOUNTS = [
  { name: "Mira Castell", email: "mira.castell@orrinvale.example", password: "Highwater-Console-26", role: "coordinator" },
  { name: "Ana Ferreira", email: "ana.ferreira@example.com", password: "Window-Seat-2026", role: "buyer" },
  { name: "Tom Okafor", email: "tom.okafor@example.com", password: "Harbour-Line-2026", role: "buyer" },
] as const;

const RELEASED_BANDS: readonly Band[] = ["03-09", "10-19", "20-29", "30-35"];

const listFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });

const plateBearings = (band: Band) => bearingsFromPlate(readFileSync(join(SEED_DIR, "models", "plates", `${band}.glb`)));

/** Seeds an empty database inside the schema transaction; running it again changes nothing. */
export const seedDatabase = async (tx: Tx, clock: AppClock, config: Config): Promise<void> => {
  const existing = await tx.query("SELECT 1 FROM units LIMIT 1");
  if (existing.rowCount !== 0) return;
  const now = clock.now();
  const ids = new Map<string, string>();
  for (const account of SEED_ACCOUNTS) {
    const inserted = await tx.query<{ id: string }>(
      "INSERT INTO accounts (email, name, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [account.email, account.name, await hashPassword(account.password), account.role, now],
    );
    ids.set(account.email, (inserted.rows[0] as { id: string }).id);
  }
  const mira = ids.get("mira.castell@orrinvale.example") as string;
  const bearings = new Map(BANDS.map((band) => [band, plateBearings(band)]));
  for (const unit of ALL_UNITS) {
    const spec = STACKS[unit.stack];
    const band = bandOf(unit.floor);
    const bearing = (bearings.get(band) as Record<string, number>)[unit.stack] as number;
    const price = seedPrice(unit.stack, unit.floor);
    await tx.query(
      `INSERT INTO units (code, floor, stack, band, bedrooms, area_m2, bearing, facing, view_tag, price, price_version, released, withdrawn)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12)`,
      [
        unit.code,
        unit.floor,
        unit.stack,
        band,
        spec.bedrooms,
        spec.areaM2,
        bearing,
        facingOf(bearing),
        spec.view(unit.floor),
        price,
        RELEASED_BANDS.includes(band),
        unit.code === "5D",
      ],
    );
    await tx.query("INSERT INTO price_versions (unit_code, version, price, set_by, set_at) VALUES ($1, 1, $2, $3, $4)", [unit.code, price, mira, now]);
  }
  const reservedPrice = seedPrice("C", 12);
  await tx.query("UPDATE units SET reserved = true WHERE code = '12C'");
  await tx.query(
    `INSERT INTO holds (unit_code, account_id, status, ended_by, quoted_price, price_version, created_at, ends_at, ended_at)
     VALUES ('12C', $1, 'converted', 'conversion', $2, 1, $3, $4, $3)`,
    [ids.get("ana.ferreira@example.com"), reservedPrice, now, clock.plusSeconds(now, config.holdSeconds)],
  );
  await tx.query(
    `INSERT INTO holds (unit_code, account_id, status, quoted_price, price_version, created_at, ends_at)
     VALUES ('31F', $1, 'active', $2, 1, $3, $4)`,
    [ids.get("tom.okafor@example.com"), seedPrice("F", 31), now, clock.plusSeconds(now, config.holdSeconds)],
  );
  await tx.query(
    `INSERT INTO index_updates (unit_code, created_at)
     SELECT code, $1 FROM units WHERE released AND NOT withdrawn`,
    [now],
  );
};

interface SeedObject {
  readonly key: string;
  readonly body: Buffer;
  readonly md5: string;
}

const readSeedObjects = (): SeedObject[] =>
  listFiles(SEED_DIR)
    .map((file) => relative(SEED_DIR, file).split(sep).join("/"))
    .filter((key) => /^(models|textures|views)\//.test(key))
    .sort()
    .map((key) => {
      const body = readFileSync(join(SEED_DIR, key));
      return { key, body, md5: createHash("md5").update(body).digest("hex") };
    });

const contentTypeOf = (key: string): string => {
  if (key.endsWith(".glb")) return "model/gltf-binary";
  return CONTENT_TYPE.png;
};

/** Uploads any missing tower asset (never overwriting) and confirms the seeded view photographs, retrying until storage answers. */
export class AssetSeeder {
  private done = false;

  constructor(
    private readonly db: Database,
    private readonly store: ObjectStore,
    private readonly clock: AppClock,
  ) {}

  start(): void {
    const attempt = (): void => {
      void this.pass()
        .then((finished) => {
          this.done = finished;
        })
        .catch(() => undefined)
        .finally(() => {
          if (!this.done) setTimeout(attempt, 2_000);
        });
    };
    attempt();
  }

  private async pass(): Promise<boolean> {
    if (!this.db.ready) return false;
    await this.store.ensureBucket();
    for (const object of readSeedObjects()) {
      let head = await this.store.head(object.key);
      if (head === null) {
        await this.store.put(object.key, object.body, contentTypeOf(object.key));
        head = await this.store.head(object.key);
      }
      const confirmed = head !== null && head.size === object.body.length && head.etag === object.md5;
      const view = /^views\/bands\/([^/]+)\/([A-H])\.png$/.exec(object.key);
      if (confirmed && view) {
        const now = this.clock.now();
        await this.db.query(
          `WITH marked AS (
             UPDATE units SET view_key = $1, view_size = $2, view_checksum = $3
              WHERE band = $4 AND stack = $5 AND view_key IS NULL RETURNING code)
           INSERT INTO index_updates (unit_code, created_at) SELECT code, $6 FROM marked`,
          [object.key, object.body.length, object.md5, view[1], view[2], now],
        );
      }
    }
    return true;
  }
}
