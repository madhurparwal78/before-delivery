import { query, tx } from './db';
import { hashPassword } from './ids';
import { tierLabel } from '../shared/labels';
import { storeWallTimeToInstant } from '../shared/time';
import type { InstrumentType, Size } from '../shared/types';

const SEED_VERSION = 'seed-1';

const FAMILIES = [
  { id: 'F-01', parent_name: 'Robin Alder', email: 'robin.alder@example.com', phone: '555-0101', address: '14 Orchard Row' },
  { id: 'F-02', parent_name: 'Sam Brandt', email: 'sam.brandt@example.com', phone: '555-0102', address: '9 Mill Lane' },
  {
    id: 'F-03',
    parent_name: 'Lee Castellanos',
    email: 'lee.castellanos@example.com',
    phone: '555-0103',
    address: '220 Quarry Road',
  },
  {
    id: 'F-04',
    parent_name: 'Avery Dunmore',
    email: 'avery.dunmore@example.com',
    phone: '555-0104',
    address: '3 Tannery Court',
  },
];

const SCHOOLS = [
  { id: 'larkspur', name: 'Larkspur Middle School', delivery_weekday: 2 },
  { id: 'ferncliff', name: 'Ferncliff Elementary', delivery_weekday: 4 },
];

const USERS = [
  { id: 'U-01', name: 'Dana Whitlock', email: 'owner@keelandbell.example', password: 'brass-owner-2026', role: 'owner', family_id: null, school_id: null },
  { id: 'U-02', name: 'Ira Penhallow', email: 'tech@keelandbell.example', password: 'brass-tech-2026', role: 'tech', family_id: null, school_id: null },
  { id: 'U-03', name: 'Celia Marrow', email: 'cmarrow@larkspur.example', password: 'baton-larkspur-2026', role: 'director', family_id: null, school_id: 'larkspur' },
  { id: 'U-04', name: 'Tomás Ibarra', email: 'tibarra@ferncliff.example', password: 'baton-ferncliff-2026', role: 'director', family_id: null, school_id: 'ferncliff' },
  { id: 'U-05', name: 'Robin Alder', email: 'robin.alder@example.com', password: 'family-alder-2026', role: 'parent', family_id: 'F-01', school_id: null },
  { id: 'U-06', name: 'Sam Brandt', email: 'sam.brandt@example.com', password: 'family-brandt-2026', role: 'parent', family_id: 'F-02', school_id: null },
  { id: 'U-07', name: 'Lee Castellanos', email: 'lee.castellanos@example.com', password: 'family-castellanos-2026', role: 'parent', family_id: 'F-03', school_id: null },
  { id: 'U-08', name: 'Avery Dunmore', email: 'avery.dunmore@example.com', password: 'family-dunmore-2026', role: 'parent', family_id: 'F-04', school_id: null },
];

const STUDENTS = [
  { id: 'S-01', name: 'Juniper Alder', grade: 7, school_id: 'larkspur', family_id: 'F-01' },
  { id: 'S-02', name: 'Theo Alder', grade: 4, school_id: 'ferncliff', family_id: 'F-01' },
  { id: 'S-03', name: 'Mira Brandt', grade: 6, school_id: 'larkspur', family_id: 'F-02' },
  { id: 'S-04', name: 'Nico Castellanos', grade: 6, school_id: 'larkspur', family_id: 'F-03' },
  { id: 'S-05', name: 'Ezra Dunmore', grade: 6, school_id: 'larkspur', family_id: 'F-04' },
  { id: 'S-06', name: 'Wren Dunmore', grade: 4, school_id: 'ferncliff', family_id: 'F-04' },
];

const INSTRUMENTS: Array<{ serial: string; instrument_type: InstrumentType; size: Size; model: string; status: string }> = [
  { serial: 'KB-FL-0101', instrument_type: 'flute', size: 'full', model: 'Corvin FL-200', status: 'available' },
  { serial: 'KB-FL-0102', instrument_type: 'flute', size: 'full', model: 'Corvin FL-200', status: 'available' },
  { serial: 'KB-CL-0201', instrument_type: 'clarinet', size: 'full', model: 'Corvin CL-300', status: 'available' },
  { serial: 'KB-CL-0202', instrument_type: 'clarinet', size: 'full', model: 'Corvin CL-300', status: 'available' },
  { serial: 'KB-TR-0301', instrument_type: 'trumpet', size: 'full', model: 'Harlow TR-150', status: 'on_contract' },
  { serial: 'KB-TR-0302', instrument_type: 'trumpet', size: 'full', model: 'Harlow TR-150', status: 'available' },
  { serial: 'KB-VN-0401', instrument_type: 'violin', size: '1/4', model: 'Ostwald VN-10', status: 'on_contract' },
  { serial: 'KB-VN-0402', instrument_type: 'violin', size: '1/2', model: 'Ostwald VN-10', status: 'available' },
  { serial: 'KB-VN-0403', instrument_type: 'violin', size: '1/2', model: 'Ostwald VN-10', status: 'available' },
  { serial: 'KB-VN-0404', instrument_type: 'violin', size: '3/4', model: 'Ostwald VN-10', status: 'available' },
  { serial: 'KB-VN-0405', instrument_type: 'violin', size: '4/4', model: 'Ostwald VN-10', status: 'available' },
  { serial: 'KB-CE-0501', instrument_type: 'cello', size: '1/2', model: 'Ostwald CE-20', status: 'available' },
  { serial: 'KB-CE-0502', instrument_type: 'cello', size: '1/2', model: 'Ostwald CE-20', status: 'on_contract' },
  { serial: 'KB-CE-0503', instrument_type: 'cello', size: '3/4', model: 'Ostwald CE-20', status: 'available' },
  { serial: 'KB-CE-0504', instrument_type: 'cello', size: '4/4', model: 'Ostwald CE-20', status: 'available' },
  { serial: 'KB-CE-0505', instrument_type: 'cello', size: '1/4', model: 'Ostwald CE-20', status: 'retired' },
];

const PRICE_LIST_ITEMS = [
  { instrument_type: 'flute', base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
  { instrument_type: 'clarinet', base_rent_cents: 2400, waiver_cents: 500, purchase_price_cents: 72000 },
  { instrument_type: 'trumpet', base_rent_cents: 2600, waiver_cents: 600, purchase_price_cents: 83200 },
  { instrument_type: 'violin', base_rent_cents: 1800, waiver_cents: 400, purchase_price_cents: 54000 },
  { instrument_type: 'cello', base_rent_cents: 4500, waiver_cents: 900, purchase_price_cents: 180000 },
];

const PRICE_LIST_TIERS = [
  { from_month: 0, to_month: 3, percent: 40, name: 'Term 1' },
  { from_month: 4, to_month: 12, percent: 30, name: 'Year 1' },
  { from_month: 13, to_month: null, percent: 20, name: 'After' },
].map((tier) => ({ ...tier, label: tierLabel(tier.name, tier.percent) }));

const CONTRACTS = [
  { id: 'C-1001', student_id: 'S-02', serial: 'KB-VN-0401', waiver: true, signed: '2025-09-03', activated: '2025-09-04', opening: 16200 },
  { id: 'C-1002', student_id: 'S-03', serial: 'KB-TR-0301', waiver: false, signed: '2025-08-28', activated: '2025-09-02', opening: 7800 },
  { id: 'C-1003', student_id: 'S-01', serial: 'KB-CE-0502', waiver: true, signed: '2024-09-03', activated: '2024-09-03', opening: 67500 },
];

/** Writes the seed only into a database that has never been seeded. */
export async function seedDatabase(): Promise<void> {
  const existing = await query<{ value: string }>('select value from meta where key = $1', ['seed']);
  if (existing.length > 0) return;

  await tx(async (sql) => {
    for (const [index, family] of FAMILIES.entries()) {
      await sql.query(
        'insert into families (id, parent_name, email, phone, address, seed_order) values ($1,$2,$3,$4,$5,$6)',
        [family.id, family.parent_name, family.email, family.phone, family.address, index],
      );
    }
    for (const [index, school] of SCHOOLS.entries()) {
      await sql.query('insert into schools (id, name, delivery_weekday, seed_order) values ($1,$2,$3,$4)', [
        school.id,
        school.name,
        school.delivery_weekday,
        index,
      ]);
    }
    for (const user of USERS) {
      await sql.query(
        'insert into users (id, name, email, password_hash, role, family_id, school_id) values ($1,$2,$3,$4,$5,$6,$7)',
        [user.id, user.name, user.email, hashPassword(user.password), user.role, user.family_id, user.school_id],
      );
    }
    for (const student of STUDENTS) {
      await sql.query(
        'insert into students (id, name, grade, school_id, family_id, created_at) values ($1,$2,$3,$4,$5,$6)',
        [student.id, student.name, student.grade, student.school_id, student.family_id, new Date('2025-08-01T12:00:00Z')],
      );
    }
    for (const instrument of INSTRUMENTS) {
      await sql.query('insert into instruments (serial, instrument_type, size, model, status) values ($1,$2,$3,$4,$5)', [
        instrument.serial,
        instrument.instrument_type,
        instrument.size,
        instrument.model,
        instrument.status,
      ]);
    }
    await sql.query(
      'insert into price_lists (id, effective_date, created_at, withdrawn_at, tax_rate_bp, items, tiers) values ($1,$2,$3,null,$4,$5,$6)',
      [
        'PL-2024-01',
        '2024-01-01',
        storeWallTimeToInstant('2024-01-01', 12),
        825,
        JSON.stringify(PRICE_LIST_ITEMS),
        JSON.stringify(PRICE_LIST_TIERS),
      ],
    );
    for (const contract of CONTRACTS) {
      const signedAt = storeWallTimeToInstant(contract.signed, 12);
      const activatedAt = storeWallTimeToInstant(contract.activated, 12);
      await sql.query(
        `insert into contracts (
           id, status, student_id, serial, waiver, price_list_id, bound, delivery_date, hold_expires_at,
           signed_at, activated_at, closed_at, billing_anchor_date, predecessor_id, successor_id,
           subscription_state, agreement_stored, bill_of_sale_stored, created_at
         ) values ($1,'active',$2,$3,$4,'PL-2024-01',true,$5,null,$6,$7,null,$8,null,null,null,true,false,$6)`,
        [contract.id, contract.student_id, contract.serial, contract.waiver, contract.activated, signedAt, activatedAt, contract.activated],
      );
      await sql.query(
        'insert into equity_entries (id, contract_id, kind, amount_cents, transfer_id, payment_id, created_at) values ($1,$2,$3,$4,null,null,$5)',
        [`E-OPEN-${contract.id}`, contract.id, 'opening', contract.opening, activatedAt],
      );
      await sql.query(
        'insert into contract_history (contract_id, from_status, to_status, at, actor, actor_name) values ($1,null,$2,$3,$4,null)',
        [contract.id, 'active', activatedAt, 'owner'],
      );
    }
    await sql.query('insert into meta (key, value) values ($1,$2)', ['seed', SEED_VERSION]);
  });
}
