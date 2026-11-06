import {
  COLLECTIONS,
  listRecords,
  type ContentKind,
  type ContentRecord,
} from '../services/pocketbase.js';

export interface SessionItem {
  readonly id: string;
  readonly number: number;
  readonly day: number;
  readonly title: string;
  readonly format: 'lecture' | 'hands-on';
  readonly minutes: number;
  readonly outcomes: string;
}

export interface HospitalityItem {
  readonly id: string;
  readonly title: string;
  readonly day: number;
  readonly starts_at: string;
  readonly venue: string;
  readonly tier: 'all' | 'atelier';
  readonly description: string;
}

export interface HotelItem {
  readonly id: string;
  readonly name: string;
  readonly distance: string;
  readonly rate: string;
  readonly map_url: string;
}

export interface FaqItem {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly sort: number;
}

function text(record: ContentRecord, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

function integer(record: ContentRecord, field: string): number {
  const value = record[field];
  return typeof value === 'number' ? value : 0;
}

export function toSession(record: ContentRecord): SessionItem {
  return {
    id: record.id,
    number: integer(record, 'number'),
    day: integer(record, 'day'),
    title: text(record, 'title'),
    format: text(record, 'format') === 'hands-on' ? 'hands-on' : 'lecture',
    minutes: integer(record, 'minutes'),
    outcomes: text(record, 'outcomes'),
  };
}

export function toHospitality(record: ContentRecord): HospitalityItem {
  return {
    id: record.id,
    title: text(record, 'title'),
    day: integer(record, 'day'),
    starts_at: text(record, 'starts_at'),
    venue: text(record, 'venue'),
    tier: text(record, 'tier') === 'atelier' ? 'atelier' : 'all',
    description: text(record, 'description'),
  };
}

export function toHotel(record: ContentRecord): HotelItem {
  return {
    id: record.id,
    name: text(record, 'name'),
    distance: text(record, 'distance'),
    rate: text(record, 'rate'),
    map_url: text(record, 'map_url'),
  };
}

export function toFaq(record: ContentRecord): FaqItem {
  return {
    id: record.id,
    question: text(record, 'question'),
    answer: text(record, 'answer'),
    sort: integer(record, 'sort'),
  };
}

export async function readSessions(): Promise<SessionItem[]> {
  const records = await listRecords(COLLECTIONS.sessions, 'day,number');
  return records.map(toSession);
}

export async function readHospitality(): Promise<HospitalityItem[]> {
  const records = await listRecords(COLLECTIONS.hospitality, 'day,starts_at');
  return records.map(toHospitality);
}

export async function readHotels(): Promise<HotelItem[]> {
  const records = await listRecords(COLLECTIONS.hotels, 'created');
  return records.map(toHotel);
}

export async function readFaq(): Promise<FaqItem[]> {
  const records = await listRecords(COLLECTIONS.faq, 'sort');
  return records.map(toFaq);
}

export function collectionOf(kind: ContentKind): string {
  return COLLECTIONS[kind];
}

export function gatedHospitality(item: HospitalityItem): Record<string, unknown> {
  return { id: item.id, title: item.title, day: item.day, tier: 'atelier', gated: true };
}
