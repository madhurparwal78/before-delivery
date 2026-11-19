// The published floor and rules, read back from Postgres once at boot.
import type { Rules } from "../shared/api.js";
import { pool, rows } from "./db.js";

export interface Table {
  tableId: string;
  roomId: string;
  minSeats: number;
  maxSeats: number;
}

export interface Room {
  roomId: string;
  name: string;
  seats: number;
  tables: Table[];
}

/** Something a party can be seated at: one table, or a joinable pair of tables. */
export interface Target {
  targetId: string;
  roomId: string;
  tableIds: string[];
  minSeats: number;
  maxSeats: number;
}

type PublishedRules = Omit<Rules, "hold_seconds" | "offer_seconds">;

interface Catalog {
  rooms: Room[];
  tables: Table[];
  targets: Target[];
  rules: PublishedRules;
}

let loaded: Catalog | undefined;

export function catalog(): Catalog {
  if (loaded === undefined) throw new Error("the catalog is read before boot has loaded it");
  return loaded;
}

export async function loadCatalog(): Promise<void> {
  const roomRows = await rows<{ room_id: string; name: string }>(
    pool,
    "SELECT room_id, name FROM rooms ORDER BY position",
  );
  const tableRows = await rows<{ table_id: string; room_id: string; min_seats: number; max_seats: number }>(
    pool,
    "SELECT table_id, room_id, min_seats, max_seats FROM tables ORDER BY position",
  );
  const pairRows = await rows<{ pair_id: string; table_a: string; table_b: string; min_seats: number; max_seats: number }>(
    pool,
    "SELECT pair_id, table_a, table_b, min_seats, max_seats FROM joinable_pairs ORDER BY pair_id",
  );
  const ruleRows = await rows<{ body: PublishedRules }>(pool, "SELECT body FROM published_rules WHERE id = 1");
  const tables: Table[] = tableRows.map((row) => ({
    tableId: row.table_id,
    roomId: row.room_id,
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
  }));
  const roomList: Room[] = roomRows.map((row) => {
    const own = tables.filter((table) => table.roomId === row.room_id);
    return {
      roomId: row.room_id,
      name: row.name,
      tables: own,
      seats: own.reduce((total, table) => total + table.maxSeats, 0),
    };
  });
  const singles: Target[] = tables.map((table) => ({
    targetId: table.tableId,
    roomId: table.roomId,
    tableIds: [table.tableId],
    minSeats: table.minSeats,
    maxSeats: table.maxSeats,
  }));
  const pairs: Target[] = pairRows.map((row) => ({
    targetId: row.pair_id,
    roomId: tables.find((table) => table.tableId === row.table_a)?.roomId ?? "",
    tableIds: [row.table_a, row.table_b],
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
  }));
  const [rulesRow] = ruleRows;
  if (rulesRow === undefined) throw new Error("the published rules are missing from the database");
  loaded = { rooms: roomList, tables, targets: [...singles, ...pairs], rules: rulesRow.body };
}

export function roomOfTable(tableId: string): Room {
  const room = catalog().rooms.find((candidate) => candidate.tables.some((table) => table.tableId === tableId));
  if (room === undefined) throw new Error(`table ${tableId} has no room`);
  return room;
}

export function targetById(targetId: string): Target | undefined {
  return catalog().targets.find((target) => target.targetId === targetId);
}
