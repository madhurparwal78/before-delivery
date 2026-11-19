/** Unit rows, the one place a unit's status is derived, and the explicit public projections built from them. */
import type { PublicUnit, SharedUnit, TowerCell } from "../shared/api-types.js";
import type { CellStatus, LiveStatus } from "../shared/domain.js";
import { areaSqftOf, pricePerM2Of, pricePerSqftOf } from "../shared/figures.js";
import type { MediaSigner } from "./media.js";

export interface UnitRow {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  area_m2: number;
  bearing: number;
  facing: string;
  view_tag: string;
  price: number;
  price_version: number;
  released: boolean;
  withdrawn: boolean;
  reserved: boolean;
  view_key: string | null;
  view_size: number | null;
  view_checksum: string | null;
  active_hold_id: string | null;
  syncing: boolean;
}

/** Every unit column plus the live hold and unconfirmed-index flags; callers append WHERE and ORDER BY. */
export const UNIT_SELECT = `
  SELECT u.*,
         h.id AS active_hold_id,
         EXISTS (SELECT 1 FROM index_updates i WHERE i.unit_code = u.code AND i.confirmed_at IS NULL) AS syncing
    FROM units u
    LEFT JOIN holds h ON h.unit_code = u.code AND h.status = 'active'`;

/** The only derivation of a unit's status from released, withdrawn, reserved and its active hold. */
export const statusOf = (row: UnitRow): CellStatus => {
  if (row.withdrawn) return "withdrawn";
  if (!row.released) return "unreleased";
  if (row.reserved) return "reserved";
  return row.active_hold_id === null ? "available" : "held";
};

export const isVisible = (row: UnitRow): boolean => row.released && !row.withdrawn;

const viewLink = (row: UnitRow, media: MediaSigner): string | null =>
  row.view_key === null ? null : media.link(row.view_key, row.code);

export const toPublicUnit = (row: UnitRow, media: MediaSigner): PublicUnit => ({
  code: row.code,
  floor: row.floor,
  stack: row.stack,
  band: row.band,
  bedrooms: row.bedrooms,
  areaM2: row.area_m2,
  areaSqft: areaSqftOf(row.area_m2),
  bearing: row.bearing,
  facing: row.facing,
  viewTag: row.view_tag,
  price: row.price,
  pricePerM2: pricePerM2Of(row.price, row.area_m2),
  pricePerSqft: pricePerSqftOf(row.price, row.area_m2),
  priceVersion: row.price_version,
  status: statusOf(row) as LiveStatus,
  syncing: row.syncing,
  viewPhotographed: row.view_key !== null,
  viewUrl: viewLink(row, media),
});

export const toSharedUnit = (row: UnitRow, media: MediaSigner): SharedUnit => ({
  code: row.code,
  floor: row.floor,
  stack: row.stack,
  band: row.band,
  bedrooms: row.bedrooms,
  areaM2: row.area_m2,
  areaSqft: areaSqftOf(row.area_m2),
  bearing: row.bearing,
  facing: row.facing,
  viewTag: row.view_tag,
  viewPhotographed: row.view_key !== null,
  viewUrl: viewLink(row, media),
});

export const toTowerCell = (row: UnitRow): TowerCell => ({
  code: row.code,
  floor: row.floor,
  stack: row.stack,
  status: statusOf(row),
  syncing: row.syncing,
});

/** The search document: exactly the public keys except `syncing` and `viewUrl`. */
export const toSearchDocument = (row: UnitRow): Record<string, unknown> => ({
  code: row.code,
  floor: row.floor,
  stack: row.stack,
  band: row.band,
  bedrooms: row.bedrooms,
  areaM2: row.area_m2,
  areaSqft: areaSqftOf(row.area_m2),
  bearing: row.bearing,
  facing: row.facing,
  viewTag: row.view_tag,
  price: row.price,
  pricePerM2: pricePerM2Of(row.price, row.area_m2),
  pricePerSqft: pricePerSqftOf(row.price, row.area_m2),
  priceVersion: row.price_version,
  status: statusOf(row),
  viewPhotographed: row.view_key !== null,
});
