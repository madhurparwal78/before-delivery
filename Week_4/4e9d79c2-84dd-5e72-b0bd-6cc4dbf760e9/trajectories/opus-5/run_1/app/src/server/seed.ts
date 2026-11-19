import { PoolClient } from 'pg';
import { inTransaction, makeId, makeToken, query } from './db.js';
import { hashPassword } from './session.js';
import { DEFAULT_RATES } from './data/rates.js';
import { Language } from '../domain/strings.js';
import { Size, depositFor, vehicleMoney } from '../domain/vehicles.js';
import { foldEmail, foldTelephone } from '../domain/text.js';
import { LocalDateTime, addDays, readWall, ukDateOf, ukHoursInDay } from '../domain/time.js';
import { Block } from '../domain/hours.js';
import { DirectoryOperator } from './providers/wiremock.js';
import { writeMovement } from './data/ledger.js';

const MARIA_DESK = 'DK-MERROWFIELD';
const TOMASZ_DESK = 'DK-ZIELINSKI';

const DIRECTORY: DirectoryOperator[] = [
  { id: 'OP-1001', name: 'Hanley Motor Services', town: 'Coventry', email: 'desk@op-1001.example', telephone: '01632 960200', sizes: [16, 49, 70] },
  { id: 'OP-1002', name: 'Arden Vale Coaches', town: 'Solihull', email: 'desk@op-1002.example', telephone: '01632 960201', sizes: [31, 49] },
  { id: 'OP-1003', name: 'Nuneaton Road Travel', town: 'Nuneaton', email: 'desk@op-1003.example', telephone: '01632 960202', sizes: [8, 12, 16] },
  { id: 'OP-1004', name: 'Rugby Town Minibuses', town: 'Rugby', email: 'desk@op-1004.example', telephone: '01632 960203', sizes: [8, 12] },
  { id: 'OP-1005', name: 'Leam Valley Executive Travel', town: 'Leamington Spa', email: 'desk@op-1005.example', telephone: '01632 960204', sizes: [49, 56] },
  { id: 'OP-1006', name: 'Tame Bridge Coachworks', town: 'Tamworth', email: 'desk@op-1006.example', telephone: '01632 960205', sizes: [31, 49, 70] },
  { id: 'OP-1007', name: 'Walsall Lock Coaches', town: 'Walsall', email: 'desk@op-1007.example', telephone: '01632 960206', sizes: [16, 49] },
  { id: 'OP-1008', name: 'Dudley Castle Travel', town: 'Dudley', email: 'desk@op-1008.example', telephone: '01632 960207', sizes: [12, 16, 31] },
  { id: 'OP-1009', name: 'Redditch Needle Coaches', town: 'Redditch', email: 'desk@op-1009.example', telephone: '01632 960208', sizes: [49, 56, 70] },
  { id: 'OP-1010', name: 'Stafford Shire Passenger Services', town: 'Stafford', email: 'desk@op-1010.example', telephone: '01632 960209', sizes: [31, 56] },
  { id: 'OP-1011', name: 'Hinckley Boot Travel', town: 'Hinckley', email: 'desk@op-1011.example', telephone: '01632 960210', sizes: [8, 16] },
  { id: 'OP-1012', name: 'Kenilworth Keep Coaches', town: 'Kenilworth', email: 'desk@op-1012.example', telephone: '01632 960211', sizes: [49, 70] },
  { id: 'OP-1013', name: 'Warwick Bear Minibuses', town: 'Warwick', email: 'desk@op-1013.example', telephone: '01632 960212', sizes: [8, 12, 16] },
  { id: 'OP-1014', name: 'Lichfield Spire Coaches', town: 'Lichfield', email: 'desk@op-1014.example', telephone: '01632 960213', sizes: [31, 49] },
  { id: 'OP-1015', name: 'Telford Gorge Travel', town: 'Telford', email: 'desk@op-1015.example', telephone: '01632 960214', sizes: [16, 49, 56] },
  { id: 'OP-1016', name: 'Worcester Sauce Bottle Tours', town: 'Worcester', email: 'desk@op-1016.example', telephone: '01632 960215', sizes: [12, 31] },
  { id: 'OP-1017', name: 'Burton Brewery Coaches', town: 'Burton upon Trent', email: 'desk@op-1017.example', telephone: '01632 960216', sizes: [49, 70] },
  { id: 'OP-1018', name: 'Stourbridge Glass Travel', town: 'Stourbridge', email: 'desk@op-1018.example', telephone: '01632 960217', sizes: [8, 12] },
  { id: 'OP-1019', name: 'Sutton Park Coachlines', town: 'Sutton Coldfield', email: 'desk@op-1019.example', telephone: '01632 960218', sizes: [31, 49, 56] },
  { id: 'OP-1020', name: 'Bromsgrove Nail Works Minibuses', town: 'Bromsgrove', email: 'desk@op-1020.example', telephone: '01632 960219', sizes: [16] },
  { id: 'OP-1021', name: 'Atherstone Ball Game Coaches', town: 'Atherstone', email: 'desk@op-1021.example', telephone: '01632 960220', sizes: [49] },
  { id: 'OP-1022', name: 'Daventry Mast Travel', town: 'Daventry', email: 'desk@op-1022.example', telephone: '01632 960221', sizes: [12, 31] },
  { id: 'OP-1023', name: 'Kidderminster Carpet Coaches', town: 'Kidderminster', email: 'desk@op-1023.example', telephone: '01632 960222', sizes: [16, 49] },
  { id: 'OP-1024', name: 'Hereford Cider Mill Travel', town: 'Hereford', email: 'desk@op-1024.example', telephone: '01632 960223', sizes: [56, 70] },
];

const STOPS = ['Coventry station, Coventry CV1 2GT', 'NEC, Birmingham B40 1NT'];

type SeedCustomer = { id: string; name: string; email: string; telephone: string; language: Language };

const MARIA_CUSTOMERS: SeedCustomer[] = [
  {
    id: 'CU-1001',
    name: 'CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS',
    email: 'office@chelmsleywood-federation.example',
    telephone: '01632 960101',
    language: 'en',
  },
  { id: 'CU-1002', name: 'Agnieszka Wiśniewska', email: 'agnieszka@wisniewska.example', telephone: '01632 960102', language: 'pl' },
  { id: 'CU-1003', name: 'شازیہ ملک', email: 'shazia@malik.example', telephone: '01632 960103', language: 'ur' },
  { id: 'CU-1004', name: "Jack O'Rourke", email: 'jack@orourke.example', telephone: '01632 960155', language: 'en' },
  { id: 'CU-1005', name: 'Foleshill Tool Makers', email: 'office@foleshill-tools.example', telephone: '01632 960105', language: 'en' },
  { id: 'CU-1006', name: 'Stoke Aldermoor Bowls Club', email: 'secretary@aldermoor-bowls.example', telephone: '01632 960106', language: 'en' },
];

type SeedEnquiry = {
  reference: string;
  customerId: string;
  occasion: 'school' | 'weddings' | 'company' | 'festivals';
  state: 'new' | 'priced' | 'quoted' | 'won' | 'lost';
  departDate: string;
  departTime: string;
  people: number;
  vehicles: { seats: Size; operatorId: string; boughtPrice: number }[];
  plan?: Size[];
  quote?: 'openNow' | 'sentTenDaysAgo' | 'accepted';
  payments?: number[];
};

/** The UK date of the next clock change after a date. */
function nextClockChange(from: string): string {
  for (let step = 1; step <= 400; step += 1) {
    const date = addDays(from, step);
    if (ukHoursInDay(date) !== 24) return date;
  }
  return addDays(from, 30);
}

function instantOf(local: LocalDateTime): number {
  const reading = readWall(local);
  if (reading) return reading.instant;
  return readWall({ date: local.date, time: '12:00' })?.instant ?? Date.now();
}

async function makeCustomer(
  client: PoolClient,
  deskId: string,
  customer: SeedCustomer,
  createdAt: number,
): Promise<void> {
  await client.query(
    `insert into customers (desk_id, id, name, email, email_folded, telephone, telephone_folded, language, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      deskId,
      customer.id,
      customer.name,
      customer.email,
      foldEmail(customer.email),
      customer.telephone,
      foldTelephone(customer.telephone),
      customer.language,
      createdAt,
    ],
  );
}

async function makeEnquiry(
  client: PoolClient,
  deskId: string,
  enquiry: SeedEnquiry,
  createdAt: number,
  rates: typeof DEFAULT_RATES,
  now: number,
): Promise<void> {
  const departAt = { date: enquiry.departDate, time: enquiry.departTime };
  const departInstant = instantOf(departAt);
  const stage = enquiry.quote === 'accepted' ? 'accepted' : enquiry.quote ? 'quoted' : 'enquiry';
  const language = MARIA_CUSTOMERS.find((customer) => customer.id === enquiry.customerId)?.language ?? 'en';
  await client.query(
    `insert into enquiries (desk_id, id, customer_id, occasion, state, journey_type, depart_date, depart_time,
       depart_instant, people, details, language, created_at)
     values ($1,$2,$3,$4,$5,'oneWay',$6,$7,$8,$9,null,$10,$11)`,
    [
      deskId,
      enquiry.reference,
      enquiry.customerId,
      enquiry.occasion,
      enquiry.state,
      departAt.date,
      departAt.time,
      departInstant,
      enquiry.people,
      language,
      createdAt,
    ],
  );
  for (let index = 0; index < STOPS.length; index += 1) {
    await client.query(
      'insert into stops (desk_id, id, enquiry_id, position, text, checked) values ($1,$2,$3,$4,$5,true)',
      [deskId, makeId('ST'), enquiry.reference, index, STOPS[index]],
    );
  }
  const plan = enquiry.plan ?? (enquiry.vehicles.length > 0 ? enquiry.vehicles.map((vehicle) => vehicle.seats) : null);
  await client.query('insert into trips (desk_id, enquiry_id, plan_sizes) values ($1,$2,$3)', [
    deskId,
    enquiry.reference,
    plan ? JSON.stringify(plan) : null,
  ]);
  const awarded = enquiry.vehicles[0]?.operatorId ?? null;
  await client.query(
    'insert into hires (desk_id, id, stage, rate_table_id, awarded_operator_id, awarded_at) values ($1,$2,$3,$4,$5,$6)',
    [deskId, enquiry.reference, stage, null, awarded, awarded ? createdAt : null],
  );

  const vehicleIds: string[] = [];
  for (let index = 0; index < enquiry.vehicles.length; index += 1) {
    const vehicle = enquiry.vehicles[index];
    const money = vehicleMoney(vehicle.boughtPrice, rates.defaultMarginTenths, vehicle.seats, rates);
    const vehicleId = makeId('VH');
    vehicleIds.push(vehicleId);
    await client.query(
      `insert into vehicles (desk_id, id, hire_id, position, seats, operator_id, bought_price, margin_tenths, deposit)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        deskId,
        vehicleId,
        enquiry.reference,
        index,
        vehicle.seats,
        vehicle.operatorId,
        vehicle.boughtPrice,
        rates.defaultMarginTenths,
        depositFor(money.total, vehicle.seats, rates),
      ],
    );
  }

  if (enquiry.quote) {
    const sentAt = enquiry.quote === 'sentTenDaysAgo' ? instantOf({ date: addDays(ukDateOf(now), -10), time: '10:00' }) : now;
    const validUntil = addDays(ukDateOf(sentAt), 5);
    const endsAt = instantOf({ date: addDays(validUntil, 1), time: '00:00' }) - 1000;
    const pageId = makeId('QP');
    await client.query(
      `insert into quote_pages (desk_id, id, hire_id, token, version, sent_at, valid_until, ends_at, accepted_at, mailed)
       values ($1,$2,$3,$4,1,$5,$6,$7,$8,true)`,
      [
        deskId,
        pageId,
        enquiry.reference,
        makeToken(),
        sentAt,
        validUntil,
        endsAt,
        enquiry.quote === 'accepted' ? sentAt : null,
      ],
    );
  }

  for (const amount of enquiry.payments ?? []) {
    await takeSeedPayment(client, deskId, enquiry, vehicleIds, amount, rates, createdAt);
  }
}

async function takeSeedPayment(
  client: PoolClient,
  deskId: string,
  enquiry: SeedEnquiry,
  vehicleIds: string[],
  amount: number,
  rates: typeof DEFAULT_RATES,
  at: number,
): Promise<void> {
  let left = amount;
  const vehicles = enquiry.vehicles.map((vehicle, index) => {
    const money = vehicleMoney(vehicle.boughtPrice, rates.defaultMarginTenths, vehicle.seats, rates);
    return {
      id: vehicleIds[index],
      deposit: depositFor(money.total, vehicle.seats, rates),
      total: money.total,
    };
  });
  const paidOf = await client.query<{ vehicle_id: string; kind: string; sum: string }>(
    'select vehicle_id, kind, sum(amount)::text as sum from allocations where desk_id = $1 and hire_id = $2 group by vehicle_id, kind',
    [deskId, enquiry.reference],
  );
  const held = (vehicleId: string, kind: string): number =>
    Number(paidOf.rows.find((row) => row.vehicle_id === vehicleId && row.kind === kind)?.sum ?? 0);
  const parts: { vehicleId: string; kind: string; amount: number }[] = [];
  for (const vehicle of vehicles) {
    if (left <= 0) break;
    const owed = Math.max(0, vehicle.deposit - held(vehicle.id, 'deposit'));
    const taken = Math.min(owed, left);
    if (taken > 0) {
      parts.push({ vehicleId: vehicle.id, kind: 'deposit', amount: taken });
      left -= taken;
    }
  }
  for (const vehicle of vehicles) {
    if (left <= 0) break;
    const owed = Math.max(0, vehicle.total - vehicle.deposit - held(vehicle.id, 'balance'));
    const taken = Math.min(owed, left);
    if (taken > 0) {
      parts.push({ vehicleId: vehicle.id, kind: 'balance', amount: taken });
      left -= taken;
    }
  }
  for (const part of parts) {
    await client.query(
      'insert into allocations (desk_id, id, hire_id, vehicle_id, kind, amount, at) values ($1,$2,$3,$4,$5,$6,$7)',
      [deskId, makeId('AL'), enquiry.reference, part.vehicleId, part.kind, part.amount, at],
    );
    await writeMovement(
      client,
      deskId,
      enquiry.reference,
      [
        { account: 'clientMoney', amount: part.amount, vehicleId: part.vehicleId, description: 'Bank transfer' },
        { account: 'hireIncome', amount: -part.amount, vehicleId: part.vehicleId, description: 'Bank transfer' },
      ],
      at,
    );
  }
}

type SeedRun = { id: string; hireId: string; driverName: string; driverTelephone: string; blocks: Block[] };

export async function applySeed(): Promise<void> {
  const held = await query<{ id: string }>('select id from desks limit 1');
  if (held.length > 0) return;
  const now = Date.now();
  const boot = ukDateOf(now);
  const change = nextClockChange(boot);

  await inTransaction(async (client) => {
    await client.query(
      'insert into desks (id, name, email, email_folded, password_hash, created_at) values ($1,$2,$3,$4,$5,$6)',
      [
        MARIA_DESK,
        'Merrowfield Coach Hire',
        'maria@merrowfield.example',
        foldEmail('maria@merrowfield.example'),
        await hashPassword('Merrowfield-Desk-2027'),
        now,
      ],
    );
    await client.query(
      'insert into desks (id, name, email, email_folded, password_hash, created_at) values ($1,$2,$3,$4,$5,$6)',
      [
        TOMASZ_DESK,
        'Zieliński Hire',
        'tomasz@zielinski-hire.example',
        foldEmail('tomasz@zielinski-hire.example'),
        await hashPassword('Zielinski-Desk-2027'),
        now,
      ],
    );
    for (const deskId of [MARIA_DESK, TOMASZ_DESK]) {
      await client.query(
        `insert into rate_tables (desk_id, id, effective_from, default_margin_tenths, waiting_rate,
           second_driver_charge, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          deskId,
          `RT-${deskId}`,
          DEFAULT_RATES.effectiveFrom,
          DEFAULT_RATES.defaultMarginTenths,
          DEFAULT_RATES.waitingRatePerHour,
          DEFAULT_RATES.secondDriverCharge,
          DEFAULT_RATES.depositMinibus,
          DEFAULT_RATES.depositMinibusHigher,
          DEFAULT_RATES.depositCoach,
          DEFAULT_RATES.depositCoachHigher,
        ],
      );
    }

    for (let index = 0; index < MARIA_CUSTOMERS.length; index += 1) {
      await makeCustomer(client, MARIA_DESK, MARIA_CUSTOMERS[index], now + index);
    }
    await makeCustomer(
      client,
      TOMASZ_DESK,
      { id: 'CU-2001', name: 'Halina Nowak', email: 'halina@nowak.example', telephone: '01632 960180', language: 'pl' },
      now,
    );

    for (let index = 0; index < DIRECTORY.length; index += 1) {
      const operator = DIRECTORY[index];
      await client.query(
        `insert into operators (desk_id, id, name, town, email, telephone, sizes, listed, dbs_checked_on)
         values ($1,$2,$3,$4,$5,$6,$7,true,$8)`,
        [
          MARIA_DESK,
          operator.id,
          operator.name,
          operator.town,
          operator.email,
          operator.telephone,
          JSON.stringify(operator.sizes),
          index < 12 ? '2026-01-15' : null,
        ],
      );
      if (index < 12) {
        for (const kind of ['operatorLicence', 'publicLiabilityCover'] as const) {
          const endsOn = operator.id === 'OP-1012' && kind === 'publicLiabilityCover' ? '2027-06-30' : '2028-12-31';
          await client.query(
            `insert into papers (desk_id, id, operator_id, kind, ends_on, stored) values ($1,$2,$3,$4,$5,false)`,
            [MARIA_DESK, makeId('PP'), operator.id, kind, endsOn],
          );
        }
      }
    }

    const enquiries: SeedEnquiry[] = [
      {
        reference: 'CV-C6M9T',
        customerId: 'CU-1002',
        occasion: 'weddings',
        state: 'won',
        departDate: addDays(change, -8),
        departTime: '07:30',
        people: 8,
        vehicles: [{ seats: 8, operatorId: 'OP-1003', boughtPrice: 52175 }],
        quote: 'accepted',
        payments: [5000, 67001],
      },
      {
        reference: 'CV-B8H3K',
        customerId: 'CU-1001',
        occasion: 'school',
        state: 'won',
        departDate: addDays(change, 7),
        departTime: '09:15',
        people: 47,
        vehicles: [{ seats: 49, operatorId: 'OP-1005', boughtPrice: 86956 }],
        quote: 'accepted',
        payments: [10000],
      },
      {
        reference: 'CV-A4F6C',
        customerId: 'CU-1006',
        occasion: 'festivals',
        state: 'won',
        departDate: change,
        departTime: '08:00',
        people: 12,
        vehicles: [{ seats: 12, operatorId: 'OP-1004', boughtPrice: 65217 }],
        quote: 'accepted',
        payments: [2500],
      },
      {
        reference: 'CV-2P7GB',
        customerId: 'CU-1005',
        occasion: 'company',
        state: 'won',
        departDate: addDays(change, -1),
        departTime: '08:00',
        people: 47,
        vehicles: [{ seats: 49, operatorId: 'OP-1001', boughtPrice: 100630 }],
        quote: 'accepted',
      },
      {
        reference: 'CV-9D3JS',
        customerId: 'CU-1006',
        occasion: 'festivals',
        state: 'lost',
        departDate: addDays(boot, 30),
        departTime: '10:00',
        people: 47,
        vehicles: [],
      },
      {
        reference: 'CV-5N6WZ',
        customerId: 'CU-1003',
        occasion: 'weddings',
        state: 'quoted',
        departDate: addDays(boot, 40),
        departTime: '12:00',
        people: 8,
        vehicles: [{ seats: 8, operatorId: 'OP-1003', boughtPrice: 52175 }],
        quote: 'sentTenDaysAgo',
      },
      {
        reference: 'CV-8T4VX',
        customerId: 'CU-1002',
        occasion: 'weddings',
        state: 'quoted',
        departDate: addDays(boot, 50),
        departTime: '13:00',
        people: 47,
        vehicles: [{ seats: 49, operatorId: 'OP-1002', boughtPrice: 86957 }],
        quote: 'openNow',
      },
      {
        reference: 'CV-3H9QR',
        customerId: 'CU-1001',
        occasion: 'school',
        state: 'priced',
        departDate: addDays(boot, 45),
        departTime: '08:30',
        people: 47,
        vehicles: [],
        plan: [49],
      },
      {
        reference: 'CV-D2Q5Y',
        customerId: 'CU-1001',
        occasion: 'school',
        state: 'new',
        departDate: addDays(boot, 70),
        departTime: '09:00',
        people: 47,
        vehicles: [],
      },
      {
        reference: 'CV-7K2M4',
        customerId: 'CU-1004',
        occasion: 'company',
        state: 'new',
        departDate: addDays(boot, 60),
        departTime: '08:00',
        people: 47,
        vehicles: [],
      },
    ];
    for (let index = 0; index < enquiries.length; index += 1) {
      await makeEnquiry(client, MARIA_DESK, enquiries[index], now + index, DEFAULT_RATES, now);
    }

    await client.query(
      `insert into enquiries (desk_id, id, customer_id, occasion, state, journey_type, depart_date, depart_time,
         depart_instant, people, language, created_at)
       values ($1,'CV-T0MA5','CU-2001','company','new','oneWay',$2,'09:00',$3,47,'pl',$4)`,
      [TOMASZ_DESK, addDays(boot, 35), instantOf({ date: addDays(boot, 35), time: '09:00' }), now],
    );
    for (let index = 0; index < STOPS.length; index += 1) {
      await client.query(
        'insert into stops (desk_id, id, enquiry_id, position, text, checked) values ($1,$2,$3,$4,$5,true)',
        [TOMASZ_DESK, makeId('ST'), 'CV-T0MA5', index, STOPS[index]],
      );
    }
    await client.query('insert into trips (desk_id, enquiry_id) values ($1, $2)', [TOMASZ_DESK, 'CV-T0MA5']);
    await client.query("insert into hires (desk_id, id, stage) values ($1, 'CV-T0MA5', 'enquiry')", [TOMASZ_DESK]);

    const bids = [
      { operatorId: 'OP-1001', price: 100630 },
      { operatorId: 'OP-1002', price: 104000 },
    ];
    for (const bid of bids) {
      await client.query(
        `insert into bids (desk_id, id, enquiry_id, operator_id, token, sent_at, closes_at, prices, received_at)
         values ($1,$2,'CV-3H9QR',$3,$4,$5,$6,$7,$5)`,
        [
          MARIA_DESK,
          makeId('BD'),
          bid.operatorId,
          makeToken(),
          now,
          now + 172800 * 1000,
          JSON.stringify([bid.price]),
        ],
      );
    }

    const runs: SeedRun[] = [
      {
        id: 'RN-1001',
        hireId: 'CV-2P7GB',
        driverName: 'Ewan Price',
        driverTelephone: '01632 960301',
        blocks: [
          { kind: 'drive', minutes: 270 },
          { kind: 'break', minutes: 45 },
          { kind: 'drive', minutes: 120 },
        ],
      },
      {
        id: 'RN-1002',
        hireId: 'CV-A4F6C',
        driverName: 'Marek Zając',
        driverTelephone: '01632 960302',
        blocks: [
          { kind: 'drive', minutes: 271 },
          { kind: 'break', minutes: 45 },
          { kind: 'drive', minutes: 60 },
        ],
      },
      {
        id: 'RN-1003',
        hireId: 'CV-B8H3K',
        driverName: 'Ewan Price',
        driverTelephone: '01632 960301',
        blocks: [{ kind: 'drive', minutes: 120 }],
      },
      {
        id: 'RN-1004',
        hireId: 'CV-C6M9T',
        driverName: 'Marek Zając',
        driverTelephone: '01632 960302',
        blocks: [{ kind: 'drive', minutes: 120 }],
      },
    ];
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      const vehicle = await client.query<{ id: string; seats: number }>(
        'select id, seats from vehicles where desk_id = $1 and hire_id = $2 order by position limit 1',
        [MARIA_DESK, run.hireId],
      );
      const enquiry = await client.query<{ depart_date: string; depart_time: string; depart_instant: string }>(
        'select depart_date, depart_time, depart_instant from enquiries where desk_id = $1 and id = $2',
        [MARIA_DESK, run.hireId],
      );
      const place = enquiry.rows[0];
      await client.query(
        `insert into runs (desk_id, id, hire_id, vehicle_id, number, seats, driver_name, driver_telephone,
           driver_folded, sheet_token, depart_date, depart_time, depart_instant, blocks, blocks_start_date,
           blocks_start_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$11,$12)`,
        [
          MARIA_DESK,
          run.id,
          run.hireId,
          vehicle.rows[0].id,
          index + 1,
          vehicle.rows[0].seats,
          run.driverName,
          run.driverTelephone,
          foldTelephone(run.driverTelephone),
          makeToken(),
          place.depart_date,
          place.depart_time,
          Number(place.depart_instant),
          JSON.stringify(run.blocks),
        ],
      );
      for (let stop = 0; stop < STOPS.length; stop += 1) {
        await client.query('insert into run_stops (desk_id, id, run_id, position, text) values ($1,$2,$3,$4,$5)', [
          MARIA_DESK,
          makeId('RS'),
          run.id,
          stop,
          STOPS[stop],
        ]);
      }
    }
    await client.query('insert into counters (desk_id, kind, value) values ($1, $2, $3)', [MARIA_DESK, 'run', 4]);

    const seatPlan = [
      { name: 'Agnieszka Wiśniewska', group: 'Adult', seat: '12A' },
      { name: "Jack O'Rourke", group: 'Adult', seat: '3C' },
      { name: 'Maja Kowalska', group: 'Year 5', seat: '1A' },
      { name: 'Ibrahim Malik', group: 'Year 5', seat: '1B' },
      { name: 'Tom Bennett', group: 'Year 5', seat: '1C' },
    ];
    const schoolVehicle = await client.query<{ id: string }>(
      'select id from vehicles where desk_id = $1 and hire_id = $2 order by position limit 1',
      [MARIA_DESK, 'CV-B8H3K'],
    );
    for (let index = 0; index < seatPlan.length; index += 1) {
      const person = seatPlan[index];
      const passengerId = makeId('PS');
      await client.query(
        'insert into passengers (desk_id, id, hire_id, name, group_name, needs, position) values ($1,$2,$3,$4,$5,$6,$7)',
        [MARIA_DESK, passengerId, 'CV-B8H3K', person.name, person.group, '', index],
      );
      await client.query(
        'insert into seat_places (desk_id, hire_id, vehicle_id, seat, passenger_id) values ($1,$2,$3,$4,$5)',
        [MARIA_DESK, 'CV-B8H3K', schoolVehicle.rows[0].id, person.seat, passengerId],
      );
    }

    const year = Number(boot.slice(0, 4));
    const invoiceId = makeId('DOC');
    await client.query(
      `insert into documents (desk_id, id, hire_id, kind, state, number, customer_name, created_at, history)
       values ($1,$2,'CV-C6M9T','invoice','waiting',$3,$4,$5,$6)`,
      [
        MARIA_DESK,
        invoiceId,
        `INV-${year}-0001`,
        'Agnieszka Wiśniewska',
        now,
        JSON.stringify([
          { at: new Date(now).toISOString().slice(0, 19) + 'Z', who: 'Maria Whitcombe', what: 'Started' },
        ]),
      ],
    );
    await client.query('insert into doc_numbers (desk_id, year, kind, last) values ($1,$2,$3,1)', [
      MARIA_DESK,
      year,
      'invoice',
    ]);
  });
}
