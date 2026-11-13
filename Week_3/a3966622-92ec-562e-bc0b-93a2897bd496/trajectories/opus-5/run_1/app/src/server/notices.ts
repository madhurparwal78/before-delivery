import { marginFromMm } from '../domain/numerals.ts';
import { formatInstantSeconds } from '../domain/porttime.ts';
import { DEFECT_NAMES } from '../domain/defects.ts';
import type {
  LadderReportRecord,
  MoveRecord,
  NoticeRecord,
  StoreState,
} from './store/types.ts';

export const HARBOUR_AUTHORITY_ADDRESS = 'harbourmaster@port-ansell.example';

function boardingText(move: MoveRecord): string {
  return `${move.boarding_at.replace('T', ' ')} port time`;
}

function vesselName(state: StoreState, move: MoveRecord): string {
  return state.vessels.find((vessel) => vessel.id === move.vessel_id)?.name ?? move.vessel_id;
}

export function agentAddressFor(state: StoreState, agencyCode: string): string[] {
  return state.users
    .filter((user) => user.role === 'agent' && user.agency_code === agencyCode)
    .map((user) => user.email);
}

export function pilotAddressFor(state: StoreState, pilotId: string): string[] {
  const pilot = state.pilots.find((entry) => entry.id === pilotId);
  if (pilot === undefined) return [];
  return state.users.filter((user) => user.id === pilot.user_id).map((user) => user.email);
}

function appendNotice(
  state: StoreState,
  move: MoveRecord,
  notice: Omit<NoticeRecord, 'id' | 'state' | 'created_at' | 'sent_at'>,
  nextId: (counter: string, prefix: string) => string,
  now: number,
): NoticeRecord {
  const record: NoticeRecord = {
    ...notice,
    id: nextId('notice', 'NT'),
    state: 'pending',
    created_at: formatInstantSeconds(now),
    sent_at: null,
  };
  state.notices.push(record);
  move.notice_ids.push(record.id);
  state.steps.push({
    id: `ST-${record.id}`,
    kind: 'notice_send',
    target_id: record.id,
    state: 'pending',
    attempts: 0,
    last_attempt_at: null,
    last_error: null,
  });
  return record;
}

export type NoticeFactory = {
  state: StoreState;
  move: MoveRecord;
  now: number;
  nextId: (counter: string, prefix: string) => string;
};

/** Notices carry no rest figures, override reasons or dispatcher notes. */
export function orderConfirmation(factory: NoticeFactory, pilotName: string): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Order confirmation',
      to: agentAddressFor(state, move.agency_code),
      subject: `Pilot order confirmed: ${vessel}`,
      body: [
        `Vessel: ${vessel}`,
        `Boarding: ${boardingText(move)}`,
        `Pilot: ${pilotName}`,
      ].join('\n'),
      photo_ids: [],
    },
    factory.nextId,
    factory.now,
  );
}

export function assignmentNotice(
  factory: NoticeFactory,
  pilotId: string,
  pinchWaypoint: string,
  marginMm: number,
): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Assignment notice',
      to: pilotAddressFor(state, pilotId),
      subject: `Assignment: ${vessel} ${boardingText(move).replace(' port time', '')}`,
      body: [
        `Vessel: ${vessel}`,
        `Boarding: ${boardingText(move)}`,
        `Pinch: ${pinchWaypoint} ${marginFromMm(marginMm)} m`,
      ].join('\n'),
      photo_ids: [],
    },
    factory.nextId,
    factory.now,
  );
}

export function orderAmended(factory: NoticeFactory): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Order amended',
      to: agentAddressFor(state, move.agency_code),
      subject: `Pilot order amended: ${vessel}`,
      body: [
        `Vessel: ${vessel}`,
        `Boarding: ${boardingText(move)}`,
        `Status: ${move.status}`,
      ].join('\n'),
      photo_ids: [],
    },
    factory.nextId,
    factory.now,
  );
}

export function orderCancelled(factory: NoticeFactory): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Order cancelled',
      to: agentAddressFor(state, move.agency_code),
      subject: `Pilot order cancelled: ${vessel}`,
      body: [
        `Vessel: ${vessel}`,
        `Boarding: ${boardingText(move)}`,
        `Status: ${move.status}`,
      ].join('\n'),
      photo_ids: [],
    },
    factory.nextId,
    factory.now,
  );
}

export function assignmentWithdrawn(factory: NoticeFactory, pilotId: string): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Assignment withdrawn',
      to: pilotAddressFor(state, pilotId),
      subject: `Assignment withdrawn: ${vessel}`,
      body: [`Vessel: ${vessel}`, `Boarding: ${boardingText(move)}`].join('\n'),
      photo_ids: [],
    },
    factory.nextId,
    factory.now,
  );
}

export function ladderNotice(
  factory: NoticeFactory,
  report: LadderReportRecord,
  checksums: readonly string[],
): NoticeRecord {
  const { state, move } = factory;
  const vessel = vesselName(state, move);
  const defects = report.defects.map((code) => DEFECT_NAMES[code] ?? code).join(', ');
  const body = [
    `Move: ${move.ref}`,
    `Vessel: ${vessel}`,
    `Boarding: ${boardingText(move)}`,
    `Report: ${report.id}`,
    `Defects: ${defects}`,
    ...checksums.map((sha256) => `Photo SHA-256: ${sha256}`),
  ].join('\n');
  return appendNotice(
    state,
    move,
    {
      move_ref: move.ref,
      kind: 'Ladder notice',
      to: [...agentAddressFor(state, move.agency_code), HARBOUR_AUTHORITY_ADDRESS],
      subject: `Non-compliant boarding ladder: ${vessel}`,
      body,
      photo_ids: [...report.photo_ids],
    },
    factory.nextId,
    factory.now,
  );
}
