import { fromWhole, type Ml } from '../domain/decimal.ts';
import { orderRateMlDay } from '../domain/conversion.ts';
import { elapsedHours } from '../domain/time.ts';
import { type Client, markSchemaReady, transaction } from './db.ts';
import { hashPassword } from './auth.ts';

const DDL = `
create table if not exists users (
  id serial primary key,
  seed_order int not null,
  name text,
  email text unique,
  role text not null,
  operator_code text unique,
  operator_kind text,
  phone text,
  password_hash text,
  erased boolean not null default false,
  allocation_ml bigint,
  debited_ml bigint
);

create table if not exists sessions (
  token text primary key,
  user_id int not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id text primary key,
  name text not null,
  rail_order int not null,
  capacity_revision int not null default 1
);

create table if not exists turnouts (
  code text primary key,
  channel_id text not null references channels(id),
  grower_id int not null references users(id),
  max_rate_ml_day bigint not null
);

create table if not exists windows (
  id text primary key,
  channel_id text not null references channels(id),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  hours int not null,
  table_cap_ml_day bigint not null,
  rostered_operator text not null,
  committed_ml bigint not null default 0,
  delivered_ml bigint not null default 0,
  lapse_processed boolean not null default false
);

create table if not exists restrictions (
  id text primary key,
  window_id text not null unique references windows(id),
  cap_ml_day bigint not null,
  reason text not null,
  effective_at timestamptz not null,
  moved_orders jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  number text primary key,
  grower_id int not null references users(id),
  turnout text not null references turnouts(code),
  window_id text not null references windows(id),
  requested_ml bigint not null,
  volume_ml bigint not null,
  rate_ml_day bigint not null,
  status text not null,
  holder_code text not null,
  standby_code text,
  conflict text,
  rationed boolean not null default false,
  closed_after_flow boolean not null default false,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists gate_cards (
  id text primary key,
  order_number text not null references orders(number),
  kind text not null,
  state text not null,
  holder_code text not null,
  from_ml_day bigint not null,
  to_ml_day bigint not null,
  stroke_key text,
  committed_at timestamptz,
  confirmed_at timestamptz,
  operator_code text,
  created_at timestamptz not null default now(),
  spent_order bigserial
);

create table if not exists capacity_revisions (
  channel_id text not null references channels(id),
  revision int not null,
  saved_at timestamptz not null default now(),
  saved_by text not null,
  restored_from int,
  cells jsonb not null,
  primary key (channel_id, revision)
);

create table if not exists notices (
  id bigserial primary key,
  kind text not null,
  window_id text references windows(id),
  grower_id int not null references users(id),
  to_email text not null,
  subject text not null,
  body text not null,
  state text not null default 'queued',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists packs (
  number text primary key,
  from_date text not null,
  to_date text not null,
  signatory text not null,
  state text not null,
  stalled_on text,
  object_deleted boolean not null default false,
  object_key text not null,
  sha256 text,
  document bytea not null,
  created_by int not null references users(id),
  created_at timestamptz not null default now(),
  mailed_at timestamptz
);

create sequence if not exists order_number_seq start 1;
create sequence if not exists pack_number_seq start 1;
create sequence if not exists gate_card_seq start 1;
create sequence if not exists restriction_seq start 1;

create index if not exists orders_window_idx on orders(window_id);
create index if not exists orders_grower_idx on orders(grower_id);
create index if not exists cards_order_idx on gate_cards(order_number);
create index if not exists cards_state_idx on gate_cards(state);
create index if not exists windows_channel_idx on windows(channel_id);
create index if not exists notices_state_idx on notices(state);
`;

interface SeedPerson {
  name: string;
  email: string;
  role: string;
  operatorCode: string | null;
  operatorKind: string | null;
  phone: string | null;
  allocationMl: Ml | null;
}

const SEED_PASSWORD = 'channel-season-26';

const PEOPLE: readonly SeedPerson[] = [
  { name: 'Mara Ellison', email: 'mara@growers.example', role: 'grower', operatorCode: null, operatorKind: null, phone: null, allocationMl: fromWhole(120) },
  { name: 'Dev Okafor', email: 'dev@growers.example', role: 'grower', operatorCode: null, operatorKind: null, phone: null, allocationMl: fromWhole(80) },
  { name: 'Lin Barrow', email: 'lin@growers.example', role: 'grower', operatorCode: null, operatorKind: null, phone: null, allocationMl: fromWhole(40) },
  { name: 'Rory Kemp', email: 'rory@wirrinbah.example', role: 'operator', operatorCode: 'OP-D-01', operatorKind: 'district', phone: null, allocationMl: null },
  { name: 'Tess Nguyen', email: 'tess@wirrinbah.example', role: 'operator', operatorCode: 'OP-D-02', operatorKind: 'district', phone: null, allocationMl: null },
  { name: 'Jo Calder', email: 'jo@contractors.example', role: 'operator', operatorCode: 'OP-C-07', operatorKind: 'contractor', phone: '0491 570 156', allocationMl: null },
  { name: 'Sam Pirelli', email: 'sam@contractors.example', role: 'operator', operatorCode: 'OP-C-08', operatorKind: 'contractor', phone: '0491 570 159', allocationMl: null },
  { name: 'Hal Whitcombe', email: 'hal@wirrinbah.example', role: 'dispatcher', operatorCode: null, operatorKind: null, phone: null, allocationMl: null },
  { name: 'Bea Lindqvist', email: 'bea@wirrinbah.example', role: 'dispatcher', operatorCode: null, operatorKind: null, phone: null, allocationMl: null },
  { name: 'Priya Anand', email: 'priya@wirrinbah.example', role: 'clerk', operatorCode: null, operatorKind: null, phone: null, allocationMl: null },
  { name: 'Quinn Mabry', email: 'quinn@regulator.example', role: 'reviewer', operatorCode: null, operatorKind: null, phone: null, allocationMl: null },
];

const CHANNELS: readonly { id: string; name: string }[] = [
  { id: 'C-L4', name: 'Lateral 4' },
  { id: 'C-09', name: 'Channel 9' },
  { id: 'C-12', name: 'Channel 12 Spur' },
];

const TURNOUTS: readonly { code: string; channelId: string; growerEmail: string; maxRate: number }[] = [
  { code: 'T4-07', channelId: 'C-L4', growerEmail: 'mara@growers.example', maxRate: 40 },
  { code: 'T4-09', channelId: 'C-L4', growerEmail: 'mara@growers.example', maxRate: 40 },
  { code: 'T4-11', channelId: 'C-L4', growerEmail: 'dev@growers.example', maxRate: 30 },
  { code: 'T4-15', channelId: 'C-L4', growerEmail: 'lin@growers.example', maxRate: 25 },
  { code: 'T9-02', channelId: 'C-09', growerEmail: 'mara@growers.example', maxRate: 60 },
  { code: 'T9-05', channelId: 'C-09', growerEmail: 'dev@growers.example', maxRate: 30 },
  { code: 'T12-03', channelId: 'C-12', growerEmail: 'lin@growers.example', maxRate: 20 },
  { code: 'T12-04', channelId: 'C-12', growerEmail: 'mara@growers.example', maxRate: 20 },
];

const WINDOWS: readonly {
  id: string;
  channelId: string;
  opensOffsetHours: number;
  closesOffsetHours: number;
  cap: number;
  rostered: string;
}[] = [
  { id: 'W-L4-A', channelId: 'C-L4', opensOffsetHours: -2, closesOffsetHours: 22, cap: 60, rostered: 'OP-D-01' },
  { id: 'W-L4-B', channelId: 'C-L4', opensOffsetHours: 22, closesOffsetHours: 46, cap: 60, rostered: 'OP-D-02' },
  { id: 'W-09-A', channelId: 'C-09', opensOffsetHours: -1, closesOffsetHours: 11, cap: 120, rostered: 'OP-D-02' },
  { id: 'W-12-A', channelId: 'C-12', opensOffsetHours: -30, closesOffsetHours: -6, cap: 30, rostered: 'OP-D-01' },
  { id: 'W-12-B', channelId: 'C-12', opensOffsetHours: 264, closesOffsetHours: 288, cap: 30, rostered: 'OP-D-02' },
];

const ORDERS: readonly {
  growerEmail: string;
  turnout: string;
  windowId: string;
  volume: number;
  holder: string;
  standby: string | null;
}[] = [
  { growerEmail: 'mara@growers.example', turnout: 'T4-07', windowId: 'W-L4-A', volume: 20, holder: 'OP-C-07', standby: 'OP-D-02' },
  { growerEmail: 'dev@growers.example', turnout: 'T4-11', windowId: 'W-L4-A', volume: 30, holder: 'OP-D-01', standby: null },
  { growerEmail: 'dev@growers.example', turnout: 'T9-05', windowId: 'W-09-A', volume: 15, holder: 'OP-C-08', standby: null },
];

export async function applySchemaAndSeed(): Promise<void> {
  await transaction(async (client) => {
    await client.query(DDL);
    const seeded = await client.query<{ count: string }>('select count(*)::text as count from users');
    if ((seeded.rows[0]?.count ?? '0') === '0') await seed(client);
  });
  markSchemaReady();
}

async function seed(client: Client): Promise<void> {
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const growerIds = new Map<string, number>();

  for (const [index, person] of PEOPLE.entries()) {
    const inserted = await client.query<{ id: number }>(
      `insert into users (seed_order, name, email, role, operator_code, operator_kind, phone, password_hash, allocation_ml, debited_ml)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        index + 1,
        person.name,
        person.email,
        person.role,
        person.operatorCode,
        person.operatorKind,
        person.phone,
        hashPassword(SEED_PASSWORD),
        person.allocationMl === null ? null : person.allocationMl.toString(),
        person.allocationMl === null ? null : '0',
      ],
    );
    growerIds.set(person.email, (inserted.rows[0] as { id: number }).id);
  }

  for (const [index, channel] of CHANNELS.entries()) {
    await client.query('insert into channels (id, name, rail_order, capacity_revision) values ($1,$2,$3,1)', [
      channel.id,
      channel.name,
      index + 1,
    ]);
  }

  for (const turnout of TURNOUTS) {
    await client.query('insert into turnouts (code, channel_id, grower_id, max_rate_ml_day) values ($1,$2,$3,$4)', [
      turnout.code,
      turnout.channelId,
      growerIds.get(turnout.growerEmail) as number,
      fromWhole(turnout.maxRate).toString(),
    ]);
  }

  const cells = new Map<string, Map<string, string>>();
  for (const window of WINDOWS) {
    const opensAt = new Date(hour + window.opensOffsetHours * 3_600_000);
    const closesAt = new Date(hour + window.closesOffsetHours * 3_600_000);
    const hours = elapsedHours(opensAt, closesAt) as number;
    await client.query(
      `insert into windows (id, channel_id, opens_at, closes_at, hours, table_cap_ml_day, rostered_operator)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [window.id, window.channelId, opensAt, closesAt, hours, fromWhole(window.cap).toString(), window.rostered],
    );
    const channelCells = cells.get(window.channelId) ?? new Map<string, string>();
    channelCells.set(window.id, fromWhole(window.cap).toString());
    cells.set(window.channelId, channelCells);
  }

  for (const channel of CHANNELS) {
    await client.query(
      `insert into capacity_revisions (channel_id, revision, saved_by, restored_from, cells) values ($1,1,$2,null,$3)`,
      [channel.id, 'seed', JSON.stringify(Object.fromEntries(cells.get(channel.id) ?? new Map()))],
    );
  }

  for (const order of ORDERS) {
    const number = await nextOrderNumber(client);
    const window = WINDOWS.find((entry) => entry.id === order.windowId) as (typeof WINDOWS)[number];
    const hours = window.closesOffsetHours - window.opensOffsetHours;
    const volume = fromWhole(order.volume);
    const rate = orderRateMlDay(volume, hours);
    await client.query(
      `insert into orders (number, grower_id, turnout, window_id, requested_ml, volume_ml, rate_ml_day, status,
         holder_code, standby_code, scheduled_at)
       values ($1,$2,$3,$4,$5,$5,$6,'scheduled',$7,$8, now())`,
      [
        number,
        growerIds.get(order.growerEmail) as number,
        order.turnout,
        order.windowId,
        volume.toString(),
        rate.toString(),
        order.holder,
        order.standby,
      ],
    );
    await client.query('update windows set committed_ml = committed_ml + $1 where id = $2', [
      volume.toString(),
      order.windowId,
    ]);
    await client.query('update users set debited_ml = debited_ml + $1 where id = $2', [
      volume.toString(),
      growerIds.get(order.growerEmail) as number,
    ]);
    await client.query(
      `insert into gate_cards (id, order_number, kind, state, holder_code, from_ml_day, to_ml_day)
       values ($1,$2,'start','open',$3,'0',$4)`,
      [await nextCardId(client), number, order.holder, rate.toString()],
    );
  }
}

export async function nextOrderNumber(client: Client): Promise<string> {
  const row = await client.query<{ value: string }>("select nextval('order_number_seq')::text as value");
  return `ORD-${(row.rows[0] as { value: string }).value.padStart(5, '0')}`;
}

export async function nextCardId(client: Client): Promise<string> {
  const row = await client.query<{ value: string }>("select nextval('gate_card_seq')::text as value");
  return `GC-${(row.rows[0] as { value: string }).value.padStart(5, '0')}`;
}

export async function nextRestrictionId(client: Client): Promise<string> {
  const row = await client.query<{ value: string }>("select nextval('restriction_seq')::text as value");
  return `RST-${(row.rows[0] as { value: string }).value.padStart(4, '0')}`;
}

export async function nextPackNumber(client: Client): Promise<string> {
  const row = await client.query<{ value: string }>("select nextval('pack_number_seq')::text as value");
  return `WP-${(row.rows[0] as { value: string }).value.padStart(4, '0')}`;
}
