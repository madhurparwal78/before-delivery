/** The coordinator's actions: floor-band release, price versions, view photographs, withdrawal and conversion. */
import { createHash } from "node:crypto";
import type { ConsoleHold, ConsoleUnit, PriceVersion, PublicHold } from "../shared/api-types.js";
import { PRICE_MAX, PRICE_MIN } from "../shared/figures.js";
import { BANDS, type Band } from "../shared/domain.js";
import { FIELD_MESSAGES } from "../shared/copy.js";
import type { AccountRow } from "./accounts.js";
import type { AppClock } from "./clock.js";
import type { Database } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { isUuid, toPublicHold } from "./holds.js";
import type { Indexer } from "./indexer.js";
import { CONTENT_TYPE, readImage, type ImageKind } from "./images.js";
import { integerLiteral, type ParsedBody } from "./json.js";
import { ObjectStore, StorageUnavailable } from "./s3.js";
import {
  convertHold,
  lapseAndNotify,
  lockUnit,
  recordPhoto,
  releaseBandUnits,
  withActiveHold,
  withdrawUnit,
  writePrice,
  type HoldRow,
} from "./transitions.js";
import { lapseExpired } from "./lapse.js";
import { UNIT_SELECT, statusOf, type UnitRow } from "./units.js";

const MIN_PHOTO_WIDTH = 1024;
const MIN_PHOTO_HEIGHT = 512;
const FLUSH_WAIT_MS = 5_000;

export class ConsoleActions {
  constructor(
    private readonly db: Database,
    private readonly clock: AppClock,
    private readonly indexer: Indexer,
    private readonly store: ObjectStore,
  ) {}

  async units(): Promise<ConsoleUnit[]> {
    await lapseAndNotify(this.db, this.clock, this.indexer);
    const rows = await this.db.query<
      UnitRow & { quoted_price: number | null; hold_created: Date | null; ends_at: Date | null; buyer_email: string | null }
    >(
      `SELECT u.*, h.id AS active_hold_id, h.quoted_price, h.created_at AS hold_created, h.ends_at, a.email AS buyer_email,
              EXISTS (SELECT 1 FROM index_updates i WHERE i.unit_code = u.code AND i.confirmed_at IS NULL) AS syncing
         FROM units u
         LEFT JOIN holds h ON h.unit_code = u.code AND h.status = 'active'
         LEFT JOIN accounts a ON a.id = h.account_id
        ORDER BY u.floor, u.stack`,
    );
    return rows.rows.map((row) => ({
      code: row.code,
      floor: row.floor,
      stack: row.stack,
      band: row.band,
      status: statusOf(row),
      price: row.price,
      priceVersion: row.price_version,
      viewPhotographed: row.view_key !== null,
      viewPhoto:
        row.view_key === null ? null : { key: row.view_key, size: row.view_size as number, checksum: row.view_checksum as string },
      hold:
        row.active_hold_id === null
          ? null
          : {
              id: row.active_hold_id,
              buyerEmail: row.buyer_email as string,
              quotedPrice: row.quoted_price as number,
              createdAt: (row.hold_created as Date).toISOString(),
              endsAt: (row.ends_at as Date).toISOString(),
            },
    }));
  }

  async priceVersions(code: string): Promise<PriceVersion[]> {
    const unit = await this.db.query("SELECT 1 FROM units WHERE code = $1", [code]);
    if (unit.rowCount === 0) throw new ApiError("not_found");
    const rows = await this.db.query<{ version: number; price: number; set_by: string; set_at: Date }>(
      `SELECT v.version, v.price, a.name AS set_by, v.set_at FROM price_versions v JOIN accounts a ON a.id = v.set_by
        WHERE v.unit_code = $1 ORDER BY v.version DESC`,
      [code],
    );
    return rows.rows.map((row) => ({ version: row.version, price: row.price, setBy: row.set_by, setAt: row.set_at.toISOString() }));
  }

  async activeHolds(): Promise<ConsoleHold[]> {
    await lapseAndNotify(this.db, this.clock, this.indexer);
    const rows = await this.db.query<HoldRow & { email: string; name: string }>(
      `SELECT h.*, a.email, a.name FROM holds h JOIN accounts a ON a.id = h.account_id WHERE h.status = 'active' ORDER BY h.created_at`,
    );
    return rows.rows.map((row) => ({
      id: row.id,
      unitCode: row.unit_code,
      buyerEmail: row.email,
      buyerName: row.name,
      quotedPrice: row.quoted_price,
      priceVersion: row.price_version,
      createdAt: row.created_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
    }));
  }

  async releaseBand(band: string): Promise<{ band: string; releasedUnits: number }> {
    if (!(BANDS as readonly string[]).includes(band as Band)) throw new ApiError("not_found");
    const codes = await this.db.tx((tx) => releaseBandUnits(tx, band, this.clock.now()));
    if (codes.length === 0) throw new ApiError("already_released");
    await this.indexer.settle(codes, FLUSH_WAIT_MS);
    return { band, releasedUnits: codes.length };
  }

  private async unitOr404(code: string): Promise<UnitRow> {
    const found = await this.db.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [code]);
    const unit = found.rows[0];
    if (!unit) throw new ApiError("not_found");
    return unit;
  }

  async savePrice(coordinator: AccountRow, code: string, body: ParsedBody | null): Promise<{ code: string; price: number; priceVersion: number }> {
    await this.unitOr404(code);
    const price = integerLiteral(body?.raw.get("price"));
    const expected = integerLiteral(body?.raw.get("expectedVersion"));
    const fields: Record<string, string> = {};
    if (price === null || price < PRICE_MIN || price > PRICE_MAX) fields["price"] = FIELD_MESSAGES.holdPrice;
    if (expected === null || expected < 1) fields["expectedVersion"] = FIELD_MESSAGES.expectedVersion;
    if (price === null || expected === null || Object.keys(fields).length > 0) throw invalid(fields);
    const outcome = await this.db.tx<{ code: string; price: number; priceVersion: number } | ApiError>(async (tx) => {
      await lockUnit(tx, code);
      const now = this.clock.now();
      await lapseExpired(tx, now);
      const unit = (await tx.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [code])).rows[0] as UnitRow;
      if (unit.withdrawn) return new ApiError("unit_withdrawn");
      const version = await writePrice(tx, code, price, expected, coordinator.id, now);
      return version === null ? new ApiError("stale_price") : { code, price, priceVersion: version };
    });
    void this.indexer.tick();
    if (outcome instanceof ApiError) throw outcome;
    return outcome;
  }

  async withdraw(code: string): Promise<{ code: string; status: "withdrawn" }> {
    await this.unitOr404(code);
    const outcome = await this.db.tx<true | ApiError>(async (tx) => {
      await lockUnit(tx, code);
      const now = this.clock.now();
      await lapseExpired(tx, now);
      const unit = (await tx.query<UnitRow>(`${UNIT_SELECT} WHERE u.code = $1`, [code])).rows[0] as UnitRow;
      if (unit.withdrawn) return new ApiError("unit_withdrawn");
      if (!(await withdrawUnit(tx, unit, now))) return new ApiError("not_released");
      return true;
    });
    if (outcome instanceof ApiError) throw outcome;
    await this.indexer.settle([code], FLUSH_WAIT_MS);
    return { code, status: "withdrawn" };
  }

  async convert(id: string): Promise<PublicHold> {
    if (!isUuid(id)) throw new ApiError("not_found");
    return withActiveHold(this.db, this.clock, this.indexer, id, null, async (tx, hold, now) => toPublicHold(await convertHold(tx, hold, now)));
  }

  /** Stores an uploaded photograph as sent and marks the unit photographed only once storage confirms size and checksum. */
  async uploadPhoto(
    code: string,
    bytes: Buffer,
    kind: ImageKind,
  ): Promise<{ code: string; viewPhotographed: true; viewPhoto: { key: string; size: number; checksum: string } }> {
    await this.unitOr404(code);
    const dimensions = readImage(bytes, kind);
    if (dimensions === null) throw invalid({ photo: FIELD_MESSAGES.photoBroken });
    if (dimensions.width < MIN_PHOTO_WIDTH || dimensions.height < MIN_PHOTO_HEIGHT) throw invalid({ photo: FIELD_MESSAGES.photoSmall });
    if ((await this.unitOr404(code)).withdrawn) throw new ApiError("unit_withdrawn");

    const lockClient = await this.db.pool.connect();
    try {
      const lock = await lockClient.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok", [`upload:${code}`]);
      if (!lock.rows[0]?.ok) throw new ApiError("upload_in_progress");
      try {
        const checksum = createHash("md5").update(bytes).digest("hex");
        const key = `views/units/${code}/${checksum}.${kind}`;
        try {
          await this.store.put(key, bytes, CONTENT_TYPE[kind]);
          const head = await this.store.head(key);
          if (head === null || head.size !== bytes.length || head.etag !== checksum) throw new ApiError("upload_unconfirmed");
        } catch (error) {
          if (error instanceof StorageUnavailable) throw new ApiError("storage_unavailable");
          throw error;
        }
        const recorded = await this.db.tx(async (tx) => {
          await lockUnit(tx, code);
          return recordPhoto(tx, code, key, bytes.length, checksum, this.clock.now());
        });
        if (!recorded) throw new ApiError("unit_withdrawn");
        void this.indexer.tick();
        return { code, viewPhotographed: true, viewPhoto: { key, size: bytes.length, checksum } };
      } finally {
        await lockClient.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`upload:${code}`]).catch(() => undefined);
      }
    } finally {
      lockClient.release();
    }
  }
}
