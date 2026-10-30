import { PoolClient } from 'pg';
import { transaction } from './db';
import { hashPassword } from './secrets';
import { insertOp } from './domain/state';
import { ClientOp } from '../shared/ops';
import { MemberRole } from '../shared/workbook';
import { NumberFormat } from '../shared/values';
import { zonedToUtcCandidates, parseLocalIso } from '../shared/zone';

const SEED_PASSWORD = 'tally-field-2026';

const RIDGEBACK = '11111111-1111-4111-8111-111111111111';
const COLDWATER = '22222222-2222-4222-8222-222222222222';

const MEMBERS: { id: string; name: string; email: string; stationId: string; role: MemberRole }[] = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Priya Raman', email: 'priya@ridgeback.example', stationId: RIDGEBACK, role: 'data_manager' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Tomás Herrera', email: 'tomas@ridgeback.example', stationId: RIDGEBACK, role: 'lead' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Dana Okafor', email: 'dana@ridgeback.example', stationId: RIDGEBACK, role: 'technician' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Lee Vance', email: 'lee@ridgeback.example', stationId: RIDGEBACK, role: 'technician' },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Sam Ito', email: 'sam@ridgeback.example', stationId: RIDGEBACK, role: 'viewer' },
  { id: '20000000-0000-4000-8000-000000000001', name: 'Wren Castillo', email: 'wren@coldwater.example', stationId: COLDWATER, role: 'data_manager' },
  { id: '20000000-0000-4000-8000-000000000002', name: 'Noor Haddad', email: 'noor@coldwater.example', stationId: COLDWATER, role: 'lead' },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Jo Mbeki', email: 'jo@coldwater.example', stationId: COLDWATER, role: 'technician' },
];

const SOY_WORKBOOK = '30000000-0000-4000-8000-000000000001';
const NITROGEN_WORKBOOK = '30000000-0000-4000-8000-000000000002';
const WHEAT_WORKBOOK = '30000000-0000-4000-8000-000000000003';

const SOY_PLOTS = '40000000-0000-4000-8000-000000000001';
const SOY_ANALYSIS = '40000000-0000-4000-8000-000000000002';
const NITROGEN_PLOTS = '40000000-0000-4000-8000-000000000003';
const WHEAT_PLOTS = '40000000-0000-4000-8000-000000000004';
const SOY_CHART = '50000000-0000-4000-8000-000000000001';

const PLOT_ROWS: { plot: number; rep: number; entry: string; moisture: string; yield: string }[] = [
  { plot: 101, rep: 1, entry: 'RB-21', moisture: '14.2', yield: '58.4' },
  { plot: 102, rep: 1, entry: 'RB-34', moisture: '13.8', yield: '61.0' },
  { plot: 103, rep: 1, entry: 'Check AG-30', moisture: '14.6', yield: '55.2' },
  { plot: 201, rep: 2, entry: 'RB-34', moisture: '13.5', yield: '60.2' },
  { plot: 202, rep: 2, entry: 'Check AG-30', moisture: '14.9', yield: '54.1' },
  { plot: 203, rep: 2, entry: 'RB-21', moisture: '14.0', yield: '57.6' },
  { plot: 301, rep: 3, entry: 'Check AG-30', moisture: '14.4', yield: '56.0' },
  { plot: 302, rep: 3, entry: 'RB-21', moisture: '13.9', yield: '59.1' },
  { plot: 303, rep: 3, entry: 'RB-34', moisture: '13.6', yield: '62.3' },
  { plot: 401, rep: 4, entry: 'RB-21', moisture: '14.3', yield: '58.0' },
  { plot: 402, rep: 4, entry: 'RB-34', moisture: '13.7', yield: '60.8' },
  { plot: 403, rep: 4, entry: 'Check AG-30', moisture: '14.8', yield: '54.7' },
];

let opCounter = 0;

function nextOpId(): string {
  opCounter += 1;
  return `seed-op-${opCounter}`;
}

function setCell(sheetId: string, cell: string, input: string): ClientOp {
  return { opId: nextOpId(), type: 'setCell', sheetId, cell, input };
}

function setFormat(sheetId: string, range: string, format: { numberFormat?: NumberFormat; bold?: boolean }): ClientOp {
  return { opId: nextOpId(), type: 'setFormat', sheetId, range, format };
}

function addSheet(sheetId: string, name: string): ClientOp {
  return { opId: nextOpId(), type: 'addSheet', sheetId, name };
}

function soybeanOps(): ClientOp[] {
  const ops: ClientOp[] = [addSheet(SOY_PLOTS, 'Plots'), addSheet(SOY_ANALYSIS, 'Analysis')];
  const headers = ['Plot', 'Rep', 'Entry', 'Planted', 'Moisture %', 'Yield bu/ac', 'Adj. yield 13%', 'DAP'];
  headers.forEach((text, index) => {
    ops.push(setCell(SOY_PLOTS, `${String.fromCharCode(65 + index)}1`, text));
  });
  PLOT_ROWS.forEach((plotRow, index) => {
    const row = index + 2;
    ops.push(setCell(SOY_PLOTS, `A${row}`, String(plotRow.plot)));
    ops.push(setCell(SOY_PLOTS, `B${row}`, String(plotRow.rep)));
    ops.push(setCell(SOY_PLOTS, `C${row}`, plotRow.entry));
    ops.push(setCell(SOY_PLOTS, `D${row}`, '2026-05-12'));
    ops.push(setCell(SOY_PLOTS, `E${row}`, plotRow.moisture));
    ops.push(setCell(SOY_PLOTS, `F${row}`, plotRow.yield));
    ops.push(setCell(SOY_PLOTS, `G${row}`, `=F${row}*(100-E${row})/87`));
    ops.push(setCell(SOY_PLOTS, `H${row}`, `=TODAY()-D${row}`));
  });
  ops.push(setFormat(SOY_PLOTS, 'A1:H1', { bold: true }));
  ops.push(setFormat(SOY_PLOTS, 'E2:G13', { numberFormat: '0.0' }));
  ops.push(setFormat(SOY_PLOTS, 'H2:H13', { numberFormat: '0' }));

  ops.push(setCell(SOY_ANALYSIS, 'A1', 'Entry'));
  ops.push(setCell(SOY_ANALYSIS, 'B1', 'Mean adj. yield'));
  ops.push(setCell(SOY_ANALYSIS, 'C1', 'Delta vs check'));
  ['RB-21', 'RB-34', 'Check AG-30'].forEach((entry, index) => {
    const row = index + 2;
    ops.push(setCell(SOY_ANALYSIS, `A${row}`, entry));
    ops.push(setCell(SOY_ANALYSIS, `B${row}`, `=AVERAGEIF(Plots!$C$2:$C$13,A${row},Plots!$G$2:$G$13)`));
    ops.push(setCell(SOY_ANALYSIS, `C${row}`, `=B${row}-$B$4`));
  });
  ops.push(setFormat(SOY_ANALYSIS, 'A1:C1', { bold: true }));
  ops.push(setFormat(SOY_ANALYSIS, 'B2:C4', { numberFormat: '0.00' }));
  ops.push({
    opId: nextOpId(),
    type: 'addChart',
    chartId: SOY_CHART,
    sheetId: SOY_ANALYSIS,
    chartType: 'bar',
    title: 'Mean adjusted yield by entry',
    range: 'Analysis!A1:B4',
  });
  return ops;
}

function nitrogenOps(): ClientOp[] {
  const ops: ClientOp[] = [addSheet(NITROGEN_PLOTS, 'Plots')];
  ops.push(setCell(NITROGEN_PLOTS, 'A1', 'Plot'));
  ops.push(setCell(NITROGEN_PLOTS, 'B1', 'N rate lb/ac'));
  ops.push(setCell(NITROGEN_PLOTS, 'C1', 'Yield bu/ac'));
  const rows: [string, string, string][] = [
    ['101', '0', '142.3'],
    ['102', '60', '171.8'],
    ['103', '120', '186.4'],
  ];
  rows.forEach((values, index) => {
    const row = index + 2;
    ops.push(setCell(NITROGEN_PLOTS, `A${row}`, values[0]));
    ops.push(setCell(NITROGEN_PLOTS, `B${row}`, values[1]));
    ops.push(setCell(NITROGEN_PLOTS, `C${row}`, values[2]));
  });
  ops.push(setFormat(NITROGEN_PLOTS, 'A1:C1', { bold: true }));
  return ops;
}

function wheatOps(): ClientOp[] {
  const ops: ClientOp[] = [addSheet(WHEAT_PLOTS, 'Plots')];
  ops.push(setCell(WHEAT_PLOTS, 'A1', 'Plot'));
  ops.push(setCell(WHEAT_PLOTS, 'B1', 'Entry'));
  ops.push(setCell(WHEAT_PLOTS, 'C1', 'Heading date'));
  ops.push(setCell(WHEAT_PLOTS, 'A2', '11'));
  ops.push(setCell(WHEAT_PLOTS, 'B2', 'CW-Glen'));
  ops.push(setCell(WHEAT_PLOTS, 'C2', '2026-07-02'));
  ops.push(setFormat(WHEAT_PLOTS, 'A1:C1', { bold: true }));
  return ops;
}

async function seedWorkbook(
  client: PoolClient,
  workbook: {
    id: string;
    stationId: string;
    name: string;
    state: string;
    closesAtLocal: string | null;
    timeZone: string;
    updatedAgoDays: number;
  },
  authorId: string,
  ops: ClientOp[],
): Promise<void> {
  let closesAtUtc: Date | null = null;
  if (workbook.closesAtLocal) {
    const local = parseLocalIso(workbook.closesAtLocal);
    const candidates = local ? zonedToUtcCandidates(local, workbook.timeZone) : [];
    closesAtUtc = candidates.length > 0 ? new Date(candidates[0]) : null;
  }
  await client.query(
    `insert into workbooks (id, station_id, name, state, closes_at_local, closes_at_utc, head_seq, created_by, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 * interval '1 day'), now() - ($9 * interval '1 day'))`,
    [
      workbook.id,
      workbook.stationId,
      workbook.name,
      workbook.state,
      workbook.closesAtLocal,
      closesAtUtc,
      ops.length,
      authorId,
      workbook.updatedAgoDays,
    ],
  );
  let seq = 0;
  for (const op of ops) {
    seq += 1;
    await insertOp(client, workbook.id, seq, authorId, op);
  }
}

export async function applySeed(): Promise<void> {
  await transaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['furrowbook-seed']);
    const existing = await client.query('select id from stations where id = $1', [RIDGEBACK]);
    if (existing.rows.length > 0) return;

    await client.query('insert into stations (id, name, time_zone) values ($1,$2,$3)', [
      RIDGEBACK,
      'Ridgeback Research Station',
      'America/Chicago',
    ]);
    await client.query('insert into stations (id, name, time_zone) values ($1,$2,$3)', [
      COLDWATER,
      'Coldwater Extension Farm',
      'America/Denver',
    ]);

    const passwordHash = await hashPassword(SEED_PASSWORD);
    for (const member of MEMBERS) {
      await client.query(
        `insert into members (id, station_id, name, email, role, status, password_hash)
         values ($1,$2,$3,$4,$5,'active',$6)`,
        [member.id, member.stationId, member.name, member.email, member.role, passwordHash],
      );
    }

    const ridgebackManager = MEMBERS[0].id;
    const coldwaterManager = MEMBERS[5].id;

    await seedWorkbook(
      client,
      {
        id: SOY_WORKBOOK,
        stationId: RIDGEBACK,
        name: '2026 Soybean Variety Trial RB-SOY-26',
        state: 'in_season',
        closesAtLocal: null,
        timeZone: 'America/Chicago',
        updatedAgoDays: 0,
      },
      ridgebackManager,
      soybeanOps(),
    );
    await seedWorkbook(
      client,
      {
        id: NITROGEN_WORKBOOK,
        stationId: RIDGEBACK,
        name: '2025 Nitrogen Rate Trial RB-N-25',
        state: 'locked',
        closesAtLocal: '2025-10-20T17:00',
        timeZone: 'America/Chicago',
        updatedAgoDays: 120,
      },
      ridgebackManager,
      nitrogenOps(),
    );
    await seedWorkbook(
      client,
      {
        id: WHEAT_WORKBOOK,
        stationId: COLDWATER,
        name: '2026 Spring Wheat Trial CW-WHT-26',
        state: 'in_season',
        closesAtLocal: null,
        timeZone: 'America/Denver',
        updatedAgoDays: 0,
      },
      coldwaterManager,
      wheatOps(),
    );
  });
}
