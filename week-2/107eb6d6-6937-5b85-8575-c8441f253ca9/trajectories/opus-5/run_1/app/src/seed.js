import { hashPassword } from './domain/auth.js';
import { assignedActivityNote, submittedActivityNote } from './domain/labels.js';

const SEED_PASSWORD = 'deku-demo-pw-2026';

const SEED_MEMBERS = [
  { id: 1, name: 'Ada Admin', email: 'admin@example.com', role: 'admin' },
  { id: 2, name: 'Dex Dispatcher', email: 'dispatcher@example.com', role: 'dispatcher' },
  { id: 3, name: 'Maya Manager', email: 'manager@example.com', role: 'tour_manager' },
  { id: 4, name: 'Milo Manager', email: 'milo@example.com', role: 'tour_manager' }
];

const SEED_TRUCKS = [
  { id: 'TR-101', depot: 'north', status: 'available' },
  { id: 'TR-102', depot: 'north', status: 'available' },
  { id: 'TR-103', depot: 'north', status: 'assigned' },
  { id: 'TR-104', depot: 'north', status: 'maintenance' },
  { id: 'TR-105', depot: 'south', status: 'available' },
  { id: 'TR-106', depot: 'south', status: 'assigned' },
  { id: 'TR-107', depot: 'south', status: 'assigned' },
  { id: 'TR-108', depot: 'south', status: 'available' },
  { id: 'TR-109', depot: 'south', status: 'available' },
  { id: 'TR-110', depot: 'north', status: 'available' }
];

const stop = (kind, date, address, city, region, postalCode, country) => ({
  kind,
  date,
  address,
  city,
  region,
  postal_code: postalCode,
  country
});

const SEED_REQUESTS = [
  {
    id: 'LR-0001',
    tour_name: 'Velvet Fuzz winter run',
    requester_id: 3,
    transport_type: 'tour',
    trucks_requested: 3,
    status: 'submitted',
    created_at: '2026-03-02T09:00:00Z',
    stops: [
      stop('pickup', '2026-03-20', '18 Rue des Remparts', 'Quebec City', 'QC', 'G1R 4S9', 'Canada'),
      stop('delivery', '2026-03-21', '55 Harbour Street', 'Boston', 'MA', '02110', 'USA'),
      stop('first_show', '2026-03-22', '55 Harbour Street', 'Boston', 'MA', '02110', 'USA'),
      stop('last_show', '2026-04-05', '700 Lakeside Avenue', 'Cleveland', 'OH', '44114', 'USA')
    ],
    assignments: [{ truck_id: 'TR-103', assigned_by: 2, assigned_at: '2026-03-02T11:00:00Z' }]
  },
  {
    id: 'LR-0002',
    tour_name: 'Harbour Lights festival stage',
    requester_id: 4,
    transport_type: 'show',
    trucks_requested: 2,
    status: 'submitted',
    created_at: '2026-03-03T14:30:00Z',
    stops: [
      stop('pickup', '2026-06-10', '41 Mountain Road', 'Moncton', 'NB', 'E1C 2J9', 'Canada'),
      stop('delivery', '2026-06-11', '12 Pier Lane', 'Halifax', 'NS', 'B3J 1R2', 'Canada'),
      stop('first_show', '2026-06-12', '12 Pier Lane', 'Halifax', 'NS', 'B3J 1R2', 'Canada'),
      stop('last_show', '2026-06-14', '12 Pier Lane', 'Halifax', 'NS', 'B3J 1R2', 'Canada')
    ],
    assignments: []
  },
  {
    id: 'LR-0003',
    tour_name: 'Northern Echo arena run',
    requester_id: 3,
    transport_type: 'tour',
    trucks_requested: 2,
    status: 'confirmed',
    created_at: '2026-02-26T10:15:00Z',
    stops: [
      stop('pickup', '2026-03-01', '220 Stampede Trail', 'Calgary', 'AB', 'T2G 0W4', 'Canada'),
      stop('delivery', '2026-03-02', '88 Pacific Boulevard', 'Vancouver', 'BC', 'V6B 5Z6', 'Canada'),
      stop('first_show', '2026-03-03', '88 Pacific Boulevard', 'Vancouver', 'BC', 'V6B 5Z6', 'Canada'),
      stop('last_show', '2026-03-15', '305 Union Street', 'Seattle', 'WA', '98101', 'USA')
    ],
    assignments: [
      { truck_id: 'TR-106', assigned_by: 2, assigned_at: '2026-02-27T15:30:00Z' },
      { truck_id: 'TR-107', assigned_by: 2, assigned_at: '2026-02-27T15:30:00Z' }
    ],
    decision: {
      kind: 'confirmed',
      decided_by: 2,
      decided_at: '2026-02-27T16:00:00Z',
      note: 'Confirmed with two southern trucks.'
    }
  },
  {
    id: 'LR-0004',
    tour_name: 'Film set lighting rig',
    requester_id: 4,
    transport_type: 'show_freight',
    trucks_requested: 1,
    status: 'declined',
    created_at: '2026-02-24T08:45:00Z',
    stops: [
      stop('pickup', null, '600 Peachtree Street', 'Atlanta', 'GA', '30308', 'USA'),
      stop('delivery', null, '14 River Street', 'Savannah', 'GA', '31401', 'USA'),
      stop('first_show', null, '14 River Street', 'Savannah', 'GA', '31401', 'USA'),
      stop('last_show', null, '14 River Street', 'Savannah', 'GA', '31401', 'USA')
    ],
    assignments: [],
    decision: {
      kind: 'declined',
      decided_by: 2,
      decided_at: '2026-02-24T13:00:00Z',
      note: 'No trucks free on those dates.'
    }
  }
];

async function seedMembers(client) {
  const { rows } = await client.query('SELECT email FROM members');
  const stored = new Set(rows.map((row) => row.email));
  const missing = SEED_MEMBERS.filter((member) => !stored.has(member.email));
  for (const member of missing) {
    await client.query(
      `INSERT INTO members (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING`,
      [member.id, member.name, member.email, await hashPassword(SEED_PASSWORD), member.role]
    );
  }
  if (missing.length > 0) {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('members', 'id'), (SELECT max(id) FROM members))`
    );
  }
}

async function seedTrucks(client) {
  for (const truck of SEED_TRUCKS) {
    await client.query(
      'INSERT INTO trucks (id, depot, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [truck.id, truck.depot, truck.status]
    );
  }
}

async function seedRequest(client, request) {
  const inserted = await client.query(
    `INSERT INTO logistics_requests
       (id, tour_name, transport_type, trucks_requested, requester_id, status,
        decided_by, decided_at, decision_note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      request.id,
      request.tour_name,
      request.transport_type,
      request.trucks_requested,
      request.requester_id,
      request.status,
      request.decision?.decided_by ?? null,
      request.decision?.decided_at ?? null,
      request.decision?.note ?? null,
      request.created_at
    ]
  );
  if (inserted.rowCount === 0) return;

  for (const entry of request.stops) {
    await client.query(
      `INSERT INTO stops (request_id, kind, date, address, city, region, postal_code, country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        request.id,
        entry.kind,
        entry.date,
        entry.address,
        entry.city,
        entry.region,
        entry.postal_code,
        entry.country
      ]
    );
  }

  const activity = [
    {
      kind: 'submitted',
      actor_id: request.requester_id,
      note: submittedActivityNote(request.trucks_requested),
      created_at: request.created_at
    }
  ];

  for (const assignment of request.assignments) {
    await client.query(
      'INSERT INTO assignments (truck_id, request_id, assigned_by, assigned_at) VALUES ($1, $2, $3, $4)',
      [assignment.truck_id, request.id, assignment.assigned_by, assignment.assigned_at]
    );
    activity.push({
      kind: 'truck_assigned',
      actor_id: assignment.assigned_by,
      note: assignedActivityNote(assignment.truck_id),
      created_at: assignment.assigned_at
    });
  }

  if (request.decision) {
    activity.push({
      kind: request.decision.kind,
      actor_id: request.decision.decided_by,
      note: request.decision.note,
      created_at: request.decision.decided_at
    });
  }

  for (const entry of activity) {
    await client.query(
      'INSERT INTO activity (request_id, kind, actor_id, note, created_at) VALUES ($1, $2, $3, $4, $5)',
      [request.id, entry.kind, entry.actor_id, entry.note, entry.created_at]
    );
  }
}

export async function applySeed(client) {
  await seedMembers(client);
  await seedTrucks(client);
  for (const request of SEED_REQUESTS) {
    await seedRequest(client, request);
  }
}
