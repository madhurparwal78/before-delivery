import { pool, query, type Db } from '../db';

export interface TableRow {
  tableId: string;
  roomId: string;
  minSeats: number;
  maxSeats: number;
  position: number;
}

export interface RoomRow {
  roomId: string;
  name: string;
  position: number;
  seats: number;
  tables: TableRow[];
}

export interface PairRow {
  pairId: string;
  roomId: string;
  tableIds: [string, string];
  minSeats: number;
  maxSeats: number;
}

/** A table or a joined pair: the thing a party can be seated at. */
export interface Unit {
  unitId: string;
  roomId: string;
  tableIds: string[];
  minSeats: number;
  maxSeats: number;
  isPair: boolean;
}

export interface Layout {
  rooms: RoomRow[];
  tables: TableRow[];
  pairs: PairRow[];
  units: Unit[];
  tableById: Map<string, TableRow>;
  roomById: Map<string, RoomRow>;
  unitById: Map<string, Unit>;
}

let cached: Layout | null = null;

export async function loadLayout(db: Db = pool): Promise<Layout> {
  if (cached) return cached;
  const roomRows = await query<{
    room_id: string;
    name: string;
    position: number;
  }>(db, 'select room_id, name, position from rooms order by position');
  const tableRows = await query<{
    table_id: string;
    room_id: string;
    min_seats: number;
    max_seats: number;
    position: number;
  }>(
    db,
    `select t.table_id, t.room_id, t.min_seats, t.max_seats, t.position
     from restaurant_tables t join rooms r on r.room_id = t.room_id
     order by r.position, t.position`,
  );
  const pairRows = await query<{
    pair_id: string;
    room_id: string;
    table_a: string;
    table_b: string;
    min_seats: number;
    max_seats: number;
  }>(
    db,
    `select pair_id, room_id, table_a, table_b, min_seats, max_seats
     from joinable_pairs order by position`,
  );

  const tables: TableRow[] = tableRows.rows.map((row) => ({
    tableId: row.table_id,
    roomId: row.room_id,
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    position: row.position,
  }));
  const rooms: RoomRow[] = roomRows.rows.map((row) => {
    const roomTables = tables.filter((table) => table.roomId === row.room_id);
    return {
      roomId: row.room_id,
      name: row.name,
      position: row.position,
      seats: roomTables.reduce((total, table) => total + table.maxSeats, 0),
      tables: roomTables,
    };
  });
  const pairs: PairRow[] = pairRows.rows.map((row) => ({
    pairId: row.pair_id,
    roomId: row.room_id,
    tableIds: [row.table_a, row.table_b],
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
  }));

  const units: Unit[] = [
    ...tables.map((table) => ({
      unitId: table.tableId,
      roomId: table.roomId,
      tableIds: [table.tableId],
      minSeats: table.minSeats,
      maxSeats: table.maxSeats,
      isPair: false,
    })),
    ...pairs.map((pair) => ({
      unitId: pair.pairId,
      roomId: pair.roomId,
      tableIds: [...pair.tableIds],
      minSeats: pair.minSeats,
      maxSeats: pair.maxSeats,
      isPair: true,
    })),
  ];

  cached = {
    rooms,
    tables,
    pairs,
    units,
    tableById: new Map(tables.map((table) => [table.tableId, table])),
    roomById: new Map(rooms.map((room) => [room.roomId, room])),
    unitById: new Map(units.map((unit) => [unit.unitId, unit])),
  };
  return cached;
}

/** A unit fits a party when its seat range covers the party. */
export function fitsBySeatRange(unit: Unit, partySize: number): boolean {
  return partySize >= unit.minSeats && partySize <= unit.maxSeats;
}

/** Of the fitting, free units, the eligible ones have the smallest maximum seats. */
export function eligibleUnits(candidates: Unit[]): Unit[] {
  if (candidates.length === 0) return [];
  const smallest = Math.min(...candidates.map((unit) => unit.maxSeats));
  return candidates.filter((unit) => unit.maxSeats === smallest);
}

export function requireUnit(layout: Layout, unitId: string): Unit {
  const unit = layout.unitById.get(unitId);
  if (!unit) throw new Error(`Unknown unit ${unitId}`);
  return unit;
}

export function requireRoom(layout: Layout, roomId: string): RoomRow {
  const room = layout.roomById.get(roomId);
  if (!room) throw new Error(`Unknown room ${roomId}`);
  return room;
}
