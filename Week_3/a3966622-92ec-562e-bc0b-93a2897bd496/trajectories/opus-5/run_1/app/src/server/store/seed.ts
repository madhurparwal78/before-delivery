import {
  dateKeyAt,
  formatInstantMinutes,
  formatInstantSeconds,
  instantToWall,
  parsePortDate,
  parsePortDateTime,
  shiftDate,
  wallToInstant,
} from '../../domain/porttime.ts';
import { computePlan } from '../../domain/plan.ts';
import { ROUTE } from '../../domain/route.ts';
import { billingEventLines, linesTotal, type TariffRevision } from '../../domain/tariff.ts';
import { tideTableFrom } from '../../domain/tide.ts';
import type { LicenceClass } from '../../domain/rest.ts';
import type { InvoiceRecord, MoveRecord, StepRecord, StoreState } from './types.ts';
import type { MoveStatus } from '../../domain/moves.ts';

const PASSWORD = 'Slackwater-2026';

type PilotSeed = { id: string; name: string; licence_class: LicenceClass };

const PILOTS: PilotSeed[] = [
  { id: 'P-01', name: 'Maren Holt', licence_class: 'A' },
  { id: 'P-02', name: 'Tobias Reyne', licence_class: 'B' },
  { id: 'P-03', name: 'Anneke Dwyer', licence_class: 'C' },
  { id: 'P-04', name: 'Ruairi Banks', licence_class: 'A' },
  { id: 'P-05', name: 'Owen Castellane', licence_class: 'B' },
  { id: 'P-06', name: 'Nadia Ferreira', licence_class: 'B' },
  { id: 'P-07', name: 'Idris Mallory', licence_class: 'B' },
  { id: 'P-08', name: 'Keziah Tran', licence_class: 'C' },
  { id: 'P-09', name: 'Lucan Ward', licence_class: 'A' },
  { id: 'P-10', name: 'Petra Solis', licence_class: 'C' },
];

const VESSELS = [
  {
    id: 'V-01',
    name: 'Tern Arrow',
    imo: '9700011',
    agency_code: 'CORV',
    length_m: 229,
    gross_tonnage: 43500,
    block_coefficient: 0.8,
    speed_kn: 10,
    draught_mm: 11200,
  },
  {
    id: 'V-02',
    name: 'Kestrel Bay',
    imo: '9700023',
    agency_code: 'CORV',
    length_m: 148,
    gross_tonnage: 12400,
    block_coefficient: 0.72,
    speed_kn: 9,
    draught_mm: 7600,
  },
  {
    id: 'V-03',
    name: 'Halcyon Reef',
    imo: '9700035',
    agency_code: 'TIDE',
    length_m: 190,
    gross_tonnage: 28900,
    block_coefficient: 0.78,
    speed_kn: 10,
    draught_mm: 9800,
  },
  {
    id: 'V-04',
    name: 'Marram Light',
    imo: '9700047',
    agency_code: 'TIDE',
    length_m: 289,
    gross_tonnage: 71200,
    block_coefficient: 0.82,
    speed_kn: 9,
    draught_mm: 12900,
  },
  {
    id: 'V-05',
    name: 'Sable Quay',
    imo: '9700059',
    agency_code: 'TIDE',
    length_m: 262,
    gross_tonnage: 64800,
    block_coefficient: 0.76,
    speed_kn: 8,
    draught_mm: 11400,
  },
] as const;

const TARIFF: TariffRevision = {
  id: 'TR-1',
  label: 'T-2026-A',
  effective_at: '2026-01-01T00:00',
  draft_foot_cents: 4250,
  minimum_cents: 200000,
  tonnage_bands: [
    { from_gt: 0, to_gt: 9999, cents: 48000 },
    { from_gt: 10000, to_gt: 29999, cents: 86000 },
    { from_gt: 30000, to_gt: 59999, cents: 134000 },
    { from_gt: 60000, to_gt: null, cents: 192500 },
  ],
  night_percent: 25,
  detention_half_hour_cents: 16500,
  detention_allowance_half_hours: 1,
  cancellation_cents: 38000,
};

type MoveSeed = {
  ref: string;
  vessel_id: string;
  status: MoveStatus;
  boarding: number;
  pilot_id: string | null;
  duty_minutes: number;
};

function portInstant(text: string): number {
  const wall = parsePortDateTime(text);
  if (wall === null) throw new Error(`seed wall time ${text} is not a port time`);
  const instant = wallToInstant(wall);
  if (instant === null) throw new Error(`seed wall time ${text} does not exist in port time`);
  return instant;
}

function dateOffset(storeDate: string, days: number): string {
  const date = parsePortDate(storeDate);
  if (date === null) throw new Error('store date is not a port date');
  const shifted = shiftDate(date, days);
  return `${shifted.year}-${String(shifted.month).padStart(2, '0')}-${String(shifted.day).padStart(2, '0')}`;
}

function statusHistory(status: MoveStatus, boarding: number, created: number): MoveRecord['history'] {
  const chain: MoveStatus[] = ['Ordered'];
  if (status !== 'Ordered') {
    const ladder: MoveStatus[] = [
      'Window committed',
      'Pilot assigned',
      'Pilot away',
      'On board',
      'Completed',
    ];
    for (const step of ladder) {
      chain.push(step);
      if (step === status) break;
    }
  }
  const stamps: Record<string, number> = {
    Ordered: created,
    'Window committed': created,
    'Pilot assigned': created,
    'Pilot away': boarding,
    'On board': boarding + 20 * 60_000,
  };
  return chain.map((entry) => ({
    at: formatInstantSeconds(stamps[entry] ?? boarding),
    status: entry,
    by: 'Hana Lindqvist',
  }));
}

export function buildSeedState(createdAt: number): StoreState {
  const storeDate = dateKeyAt(createdAt);
  const table = tideTableFrom(new Map());
  const users: StoreState['users'] = [
    {
      id: 'U-01',
      email: 'dispatch1@ebbstone.example',
      password: PASSWORD,
      name: 'Hana Lindqvist',
      role: 'dispatcher',
      agency_code: null,
      pilot_id: null,
    },
    {
      id: 'U-02',
      email: 'dispatch2@ebbstone.example',
      password: PASSWORD,
      name: 'Callum Adeyemi',
      role: 'dispatcher',
      agency_code: null,
      pilot_id: null,
    },
    {
      id: 'U-03',
      email: 'accounts@ebbstone.example',
      password: PASSWORD,
      name: 'Rosalind Pike',
      role: 'clerk',
      agency_code: null,
      pilot_id: null,
    },
    {
      id: 'U-04',
      email: 'agent@corvane.example',
      password: PASSWORD,
      name: 'Dario Veitch',
      role: 'agent',
      agency_code: 'CORV',
      pilot_id: null,
    },
    {
      id: 'U-05',
      email: 'agent@tidewell.example',
      password: PASSWORD,
      name: 'Mina Sorrell',
      role: 'agent',
      agency_code: 'TIDE',
      pilot_id: null,
    },
  ];
  PILOTS.forEach((pilot, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    users.push({
      id: `U-${index + 6}`,
      email: `p${ordinal}@ebbstone.example`,
      password: PASSWORD,
      name: pilot.name,
      role: 'pilot',
      agency_code: null,
      pilot_id: pilot.id,
    });
  });

  const seededDuties: StoreState['seeded_duties'] = [];
  for (let day = -14; day <= 0; day += 1) {
    seededDuties.push({
      id: `SD-05-${day + 14}`,
      pilot_id: 'P-05',
      start_at: `${dateOffset(storeDate, day)}T09:00`,
      minutes: 60,
    });
  }
  for (const day of [1, 2, 3]) {
    seededDuties.push({
      id: `SD-06-${day}`,
      pilot_id: 'P-06',
      start_at: `${dateOffset(storeDate, day)}T23:00`,
      minutes: 300,
    });
  }
  seededDuties.push({
    id: 'SD-07-1',
    pilot_id: 'P-07',
    start_at: `${dateOffset(storeDate, 2)}T08:00`,
    minutes: 480,
  });

  const onBoardBoarding = Math.floor(createdAt / 300_000) * 300_000 - 60 * 60_000;
  const moveSeeds: MoveSeed[] = [
    {
      ref: 'MV-1001',
      vessel_id: 'V-01',
      status: 'Ordered',
      boarding: portInstant(`${dateOffset(storeDate, 2)}T06:00`),
      pilot_id: null,
      duty_minutes: 360,
    },
    {
      ref: 'MV-1002',
      vessel_id: 'V-02',
      status: 'Ordered',
      boarding: portInstant(`${dateOffset(storeDate, 2)}T12:00`),
      pilot_id: null,
      duty_minutes: 240,
    },
    {
      ref: 'MV-1003',
      vessel_id: 'V-03',
      status: 'Window committed',
      boarding: portInstant(`${dateOffset(storeDate, 2)}T05:30`),
      pilot_id: null,
      duty_minutes: 300,
    },
    {
      ref: 'MV-1004',
      vessel_id: 'V-05',
      status: 'Pilot assigned',
      boarding: portInstant(`${dateOffset(storeDate, 2)}T05:00`),
      pilot_id: 'P-04',
      duty_minutes: 300,
    },
    {
      ref: 'MV-1005',
      vessel_id: 'V-02',
      status: 'Pilot away',
      boarding: portInstant(`${dateOffset(storeDate, 1)}T08:00`),
      pilot_id: 'P-10',
      duty_minutes: 240,
    },
    {
      ref: 'MV-1006',
      vessel_id: 'V-03',
      status: 'On board',
      boarding: onBoardBoarding,
      pilot_id: 'P-02',
      duty_minutes: 300,
    },
    {
      ref: 'MV-1007',
      vessel_id: 'V-01',
      status: 'On board',
      boarding: onBoardBoarding,
      pilot_id: 'P-09',
      duty_minutes: 300,
    },
    {
      ref: 'MV-1008',
      vessel_id: 'V-02',
      status: 'On board',
      boarding: onBoardBoarding,
      pilot_id: 'P-08',
      duty_minutes: 240,
    },
    {
      ref: 'MV-1009',
      vessel_id: 'V-01',
      status: 'Completed',
      boarding: portInstant(`${dateOffset(storeDate, -1)}T05:30`),
      pilot_id: 'P-09',
      duty_minutes: 300,
    },
    {
      ref: 'MV-1010',
      vessel_id: 'V-03',
      status: 'Completed',
      boarding: portInstant(`${dateOffset(storeDate, -1)}T14:00`),
      pilot_id: 'P-02',
      duty_minutes: 300,
    },
  ];

  const invoices: InvoiceRecord[] = [];
  const steps: StepRecord[] = [];
  const moves: MoveRecord[] = moveSeeds.map((seed) => {
    const vessel = VESSELS.find((entry) => entry.id === seed.vessel_id);
    if (vessel === undefined) throw new Error(`seed vessel ${seed.vessel_id} is missing`);
    const plan = computePlan(
      table,
      {
        draught_mm: vessel.draught_mm,
        speed_kn: vessel.speed_kn,
        block_coefficient: vessel.block_coefficient,
      },
      seed.boarding,
    );
    const pinch = plan.waypoints.find((waypoint) => waypoint.id === plan.pinch.waypoint_id);
    const committedStatuses: MoveStatus[] = [
      'Window committed',
      'Pilot assigned',
      'Pilot away',
      'On board',
      'Completed',
    ];
    const committed = committedStatuses.includes(seed.status)
      ? {
          boarding_at: formatInstantMinutes(seed.boarding),
          pinch_waypoint: pinch?.name ?? (ROUTE[0] as { name: string }).name,
          margin_mm: plan.pinch.margin_mm,
          tide_version: 1,
        }
      : null;
    const dutyEnd = seed.boarding + seed.duty_minutes * 60_000;
    const move: MoveRecord = {
      ref: seed.ref,
      version: 1,
      status: seed.status,
      agency_code: vessel.agency_code,
      vessel_id: vessel.id,
      length_m: vessel.length_m,
      gross_tonnage: vessel.gross_tonnage,
      block_coefficient: vessel.block_coefficient,
      draught_mm: vessel.draught_mm,
      speed_kn: vessel.speed_kn,
      duty_minutes: seed.duty_minutes,
      boarding_at: formatInstantMinutes(seed.boarding),
      committed,
      pilot_id: seed.pilot_id,
      pilot_history: seed.pilot_id === null ? [] : [seed.pilot_id],
      duty:
        seed.pilot_id === null
          ? null
          : {
              pilot_id: seed.pilot_id,
              start_at: formatInstantSeconds(seed.boarding),
              end_at: formatInstantSeconds(dutyEnd),
            },
      late_amendments: 0,
      detention_open_since: null,
      detention_seconds: 0,
      notice_ids: [],
      billing_events: [],
      ladder_report_ids: [],
      history: statusHistory(seed.status, seed.boarding, createdAt),
      corrections: [],
      dispatcher_notes: [],
      rest_override_id: null,
      created_at: formatInstantSeconds(createdAt),
    };

    if (seed.status === 'Completed') {
      const lines = billingEventLines('Completed', TARIFF, {
        draught_mm: move.draught_mm,
        gross_tonnage: move.gross_tonnage,
        boarding: instantToWall(seed.boarding),
        detention_half_hours: 0,
        late_amendments: 0,
      });
      const invoiceId = `INV-${seed.ref.slice(3)}`;
      invoices.push({
        id: invoiceId,
        move_ref: move.ref,
        agency_code: move.agency_code,
        event_kind: 'Completed',
        state: 'pending',
        number: null,
        balance_cents: null,
        balance_confirmed_at: null,
        lines,
        total_cents: linesTotal(lines),
        charge_state: 'pending',
        killbill_invoice_id: null,
        issue_requested: false,
        created_at: formatInstantSeconds(createdAt),
      });
      steps.push({
        id: `ST-${invoiceId}`,
        kind: 'charge_post',
        target_id: invoiceId,
        state: 'pending',
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
      });
      move.billing_events.push({
        kind: 'Completed',
        at: formatInstantSeconds(dutyEnd),
        invoice_id: invoiceId,
      });
    }
    return move;
  });

  return {
    schema: 1,
    created_at: formatInstantSeconds(createdAt),
    store_date: storeDate,
    tide_version: 1,
    counters: {
      move: 1010,
      report: 1000,
      invoice: 1010,
      photo: 1000,
      card: 1000,
      notice: 1000,
      override: 1000,
      revision: 1,
    },
    users,
    agencies: [
      { code: 'CORV', name: 'Corvane Shipping Agency', killbill_account_id: null },
      { code: 'TIDE', name: 'Tidewell Agencies', killbill_account_id: null },
    ],
    vessels: VESSELS.map((vessel) => ({ ...vessel })),
    pilots: PILOTS.map((pilot, index) => ({ ...pilot, user_id: `U-${index + 6}` })),
    turn_order: PILOTS.map((pilot) => pilot.id),
    seeded_duties: seededDuties,
    moves,
    photos: [],
    pilot_cards: [],
    ladder_reports: [],
    invoices,
    notices: [],
    steps,
    tide_revisions: [],
    tariff_revisions: [TARIFF],
    skips: [],
    rest_overrides: [],
    idempotency: [],
    sessions: [],
  };
}

export const SEED_PASSWORD = PASSWORD;
