import type { Database } from '../db/pool';
import type { TravelClass } from '../domain/berths';
import type { CoachRow, StopRow, TrainRow } from '../domain/schedule';

export interface StationRecord {
  readonly code: string;
  readonly name: string;
}

interface StopRecord {
  readonly train_number: string;
  readonly seq: number;
  readonly station_code: string;
  readonly name: string;
  readonly km: number;
  readonly stop_time: string;
  readonly day_offset: number;
  readonly remote: boolean;
}

interface CoachRecord {
  readonly train_number: string;
  readonly code: string;
  readonly travel_class: TravelClass;
  readonly seq: number;
}

export async function listStations(database: Database): Promise<StationRecord[]> {
  return database.query<StationRecord>('select code, name from stations order by seq');
}

export async function stationExists(database: Database, code: string): Promise<boolean> {
  const rows = await database.query<{ code: string }>(
    'select code from stations where code = $1',
    [code],
  );
  return rows.length > 0;
}

function toStop(record: StopRecord): StopRow {
  return {
    seq: record.seq,
    code: record.station_code,
    name: record.name,
    km: record.km,
    time: record.stop_time,
    dayOffset: record.day_offset,
    remote: record.remote,
  };
}

function toCoach(record: CoachRecord): CoachRow {
  return { code: record.code, travelClass: record.travel_class, seq: record.seq };
}

export async function loadTrains(database: Database): Promise<TrainRow[]> {
  const trains = await database.query<{ number: string; name: string }>(
    'select number, name from trains order by seq',
  );
  const stops = await database.query<StopRecord>(
    `select s.train_number, s.seq, s.station_code, st.name, s.km, s.stop_time, s.day_offset, s.remote
     from train_stops s join stations st on st.code = s.station_code
     order by s.train_number, s.seq`,
  );
  const coaches = await database.query<CoachRecord>(
    'select train_number, code, travel_class, seq from coaches order by train_number, seq',
  );
  return trains.map((train) => ({
    number: train.number,
    name: train.name,
    stops: stops.filter((stop) => stop.train_number === train.number).map(toStop),
    coaches: coaches.filter((coach) => coach.train_number === train.number).map(toCoach),
  }));
}

export async function loadTrain(database: Database, number: string): Promise<TrainRow | null> {
  const trains = await loadTrains(database);
  return trains.find((train) => train.number === number) ?? null;
}
