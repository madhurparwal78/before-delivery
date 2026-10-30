'use strict';
// The seed the brief pins. It is written once into an empty database, so a restart
// never duplicates a row or undoes a change made since.
const { tx } = require('./db');
const { hashPassword } = require('./auth');
const { requestedNote } = require('./desk');

const SEEDED_PASSWORD = 'deku-demo-pw-2026';

const MEMBERS = [
  [1, 'Ada Admin', 'admin@example.com', 'admin'],
  [2, 'Dex Dispatcher', 'dispatcher@example.com', 'dispatcher'],
  [3, 'Maya Manager', 'manager@example.com', 'tour_manager'],
  [4, 'Milo Manager', 'milo@example.com', 'tour_manager'],
];

const TRUCKS = [
  ['TR-101', 'north', 'available'], ['TR-102', 'north', 'available'],
  ['TR-103', 'north', 'assigned'], ['TR-104', 'north', 'maintenance'],
  ['TR-105', 'south', 'available'], ['TR-106', 'south', 'assigned'],
  ['TR-107', 'south', 'assigned'], ['TR-108', 'south', 'available'],
  ['TR-109', 'south', 'available'], ['TR-110', 'north', 'available'],
];

const DEX = 2;

const REQUESTS = [
  {
    id: 'LR-0001', tour: 'Velvet Fuzz winter run', requester: 3, type: 'tour', trucks: 3,
    status: 'submitted', created: '2026-03-02T09:00:00Z',
    stops: [
      ['pickup', '2026-03-20', '18 Rue des Tréteaux', 'Quebec City', 'QC', 'G1K 4X2', 'Canada'],
      ['delivery', '2026-03-21', '27 Spotlight Row', 'Boston', 'MA', '02118', 'USA'],
      ['first_show', '2026-03-22', '27 Spotlight Row', 'Boston', 'MA', '02118', 'USA'],
      ['last_show', '2026-04-05', '350 Rigging Street', 'Cleveland', 'OH', '44113', 'USA'],
    ],
    assignments: [['TR-103', '2026-03-02T11:00:00Z']],
  },
  {
    id: 'LR-0002', tour: 'Harbour Lights festival stage', requester: 4, type: 'show', trucks: 2,
    status: 'submitted', created: '2026-03-03T14:30:00Z',
    stops: [
      ['pickup', '2026-06-10', '61 Foghorn Road', 'Moncton', 'NB', 'E1C 4T5', 'Canada'],
      ['delivery', '2026-06-11', '9 Lantern Quay', 'Halifax', 'NS', 'B3J 2K7', 'Canada'],
      ['first_show', '2026-06-12', '9 Lantern Quay', 'Halifax', 'NS', 'B3J 2K7', 'Canada'],
      ['last_show', '2026-06-14', '9 Lantern Quay', 'Halifax', 'NS', 'B3J 2K7', 'Canada'],
    ],
    assignments: [],
  },
  {
    id: 'LR-0003', tour: 'Northern Echo arena run', requester: 3, type: 'tour', trucks: 2,
    status: 'confirmed', created: '2026-02-26T10:15:00Z',
    stops: [
      ['pickup', '2026-03-01', '44 Stampede Loop', 'Calgary', 'AB', 'T2G 0P6', 'Canada'],
      ['delivery', '2026-03-02', '120 Encore Avenue', 'Vancouver', 'BC', 'V6B 3K9', 'Canada'],
      ['first_show', '2026-03-03', '120 Encore Avenue', 'Vancouver', 'BC', 'V6B 3K9', 'Canada'],
      ['last_show', '2026-03-15', '77 Bandstand Place', 'Seattle', 'WA', '98121', 'USA'],
    ],
    assignments: [['TR-106', '2026-02-27T15:30:00Z'], ['TR-107', '2026-02-27T15:30:00Z']],
    decision: { at: '2026-02-27T16:00:00Z', note: 'Confirmed with two southern trucks.' },
  },
  {
    id: 'LR-0004', tour: 'Film set lighting rig', requester: 4, type: 'show_freight', trucks: 1,
    status: 'declined', created: '2026-02-24T08:45:00Z',
    stops: [
      ['pickup', null, '230 Cable Run', 'Atlanta', 'GA', '30308', 'USA'],
      ['delivery', null, '15 Backlot Lane', 'Savannah', 'GA', '31405', 'USA'],
      ['first_show', null, '15 Backlot Lane', 'Savannah', 'GA', '31405', 'USA'],
      ['last_show', null, '15 Backlot Lane', 'Savannah', 'GA', '31405', 'USA'],
    ],
    assignments: [],
    decision: { at: '2026-02-24T13:00:00Z', note: 'No trucks free on those dates.' },
  },
];

// The whole seed is one transaction, written only into an empty desk.
async function seed() {
  await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(4173003)');
    if ((await c.query('SELECT 1 FROM members LIMIT 1')).rowCount) return;
    for (const [id, name, email, role] of MEMBERS) {
      await c.query(
        `INSERT INTO members (id, name, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, $5, '2026-02-01T00:00:00Z')`,
        [id, name, email, await hashPassword(SEEDED_PASSWORD), role]);
    }
    for (const [id, depot, status] of TRUCKS) {
      await c.query("INSERT INTO trucks (id, depot, status, updated_at) VALUES ($1, $2, $3, '2026-02-01T00:00:00Z')",
        [id, depot, status]);
    }
    for (const r of REQUESTS) {
      const d = r.decision;
      await c.query(
        `INSERT INTO logistics_requests (id, tour_name, transport_type, trucks_requested, requester_id, status,
           decided_by, decided_at, decision_note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [r.id, r.tour, r.type, r.trucks, r.requester, r.status, d ? DEX : null, d ? d.at : null, d ? d.note : null,
          r.created]);
      for (const [kind, date, address, city, region, postal, country] of r.stops) {
        await c.query(
          `INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [r.id, kind, date, address, city, region, postal, country]);
      }
      await c.query("INSERT INTO activity (request_id, kind, actor_id, note, created_at) VALUES ($1, 'submitted', $2, $3, $4)",
        [r.id, r.requester, requestedNote(r.trucks), r.created]);
      for (const [truck, at] of r.assignments) {
        await c.query('INSERT INTO assignments (request_id, truck_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)',
          [r.id, truck, DEX, at]);
        await c.query(
          "INSERT INTO activity (request_id, kind, actor_id, note, created_at) VALUES ($1, 'truck_assigned', $2, $3, $4)",
          [r.id, DEX, `${truck} assigned`, at]);
      }
      if (d) {
        await c.query('INSERT INTO activity (request_id, kind, actor_id, note, created_at) VALUES ($1, $2, $3, $4, $5)',
          [r.id, r.status, DEX, d.note, d.at]);
      }
    }
  });
}

module.exports = { seed };
