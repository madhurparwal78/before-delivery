import { PoolClient } from 'pg';
import { config } from '../config.js';
import { makeId, makeToken, one, query } from '../db.js';
import { Pennies, moneyString } from '../../domain/money.js';
import { Language } from '../../domain/strings.js';
import {
  LocalDateTime,
  addDays,
  endOfUkDayInstant,
  formatUkDate,
  instantString,
  ukDateOf,
} from '../../domain/time.js';
import { Party, Size, depositFor, vehicleMoney } from '../../domain/vehicles.js';
import { AllocationVehicle, PaymentState, balanceDueOn, paymentStateOf } from '../../domain/payments.js';
import { RateTable, rateTableById, rateTableInForce } from './rates.js';
import { ledgerLines } from './ledger.js';

export type Occasion = 'school' | 'weddings' | 'company' | 'festivals';
export type JourneyType = 'oneWay' | 'return' | 'sameDayReturn' | 'severalStops';
export type EnquiryState = 'new' | 'priced' | 'quoted' | 'won' | 'lost';
export type Stage = 'enquiry' | 'quoted' | 'accepted';

export type Stop = { id: string; text: string; checked: boolean };

export type VehicleView = {
  id: string;
  position: number;
  seats: Size;
  operatorId: string | null;
  boughtPrice: Pennies;
  marginTenths: number;
  sellingPrice: Pennies;
  vat: Pennies;
  quoteTotal: Pennies;
  extraCharges: Pennies;
  total: Pennies;
  deposit: Pennies;
  depositPaid: Pennies;
  balancePaid: Pennies;
  refundsDue: Pennies;
  owedAmount: Pennies;
  departAt: LocalDateTime | null;
  departInstant: number | null;
  runId: string | null;
};

export type QuotePage = {
  id: string;
  token: string;
  version: number;
  sentAt: number;
  validUntil: string;
  endsAt: number;
  acceptedAt: number | null;
  depositSaidSent: boolean;
  mailed: boolean;
  replaced: boolean;
};

export type HireView = {
  deskId: string;
  id: string;
  reference: string;
  stage: Stage;
  quoteVersion: number;
  rates: RateTable;
  rateTableId: string | null;
  awardedOperatorId: string | null;
  awardedAt: number | null;
  cancelledAt: number | null;
  reminderSent: boolean;
  occasion: Occasion;
  enquiryState: EnquiryState;
  journeyType: JourneyType;
  departAt: LocalDateTime;
  departInstant: number;
  returnAt: LocalDateTime | null;
  returnInstant: number | null;
  party: Party;
  details: string | null;
  language: Language;
  submittedBody: string | null;
  mergedInto: string | null;
  createdAt: number;
  stops: Stop[];
  customer: {
    id: string;
    name: string;
    email: string;
    telephone: string;
    language: Language;
    state: string;
    erased: boolean;
  };
  vehicles: VehicleView[];
  page: QuotePage | null;
  paid: Pennies;
  owed: Pennies;
  credit: Pennies;
  paymentState: PaymentState;
  total: Pennies;
  depositTotal: Pennies;
  balanceDueOn: string | null;
};

type EnquiryRow = {
  id: string;
  customer_id: string;
  occasion: Occasion;
  state: EnquiryState;
  journey_type: JourneyType;
  depart_date: string;
  depart_time: string;
  depart_repeated: string | null;
  depart_instant: string;
  return_date: string | null;
  return_time: string | null;
  return_repeated: string | null;
  return_instant: string | null;
  people: number;
  large: number;
  medium: number;
  hand: number;
  wheelchairs: number;
  details: string | null;
  language: Language;
  submitted_body: string | null;
  merged_into: string | null;
  created_at: string;
  stage: Stage;
  quote_version: number;
  rate_table_id: string | null;
  awarded_operator_id: string | null;
  awarded_at: string | null;
  cancelled_at: string | null;
  reminder_sent: boolean;
  customer_name: string;
  customer_email: string;
  customer_telephone: string;
  customer_language: Language;
  customer_state: string;
  customer_erased: boolean;
};

const HIRE_SELECT = `
  select e.id, e.customer_id, e.occasion, e.state, e.journey_type, e.depart_date, e.depart_time, e.depart_repeated,
         e.depart_instant, e.return_date, e.return_time, e.return_repeated, e.return_instant, e.people, e.large,
         e.medium, e.hand, e.wheelchairs, e.details, e.language, e.submitted_body, e.merged_into, e.created_at,
         h.stage, h.quote_version, h.rate_table_id, h.awarded_operator_id, h.awarded_at, h.cancelled_at,
         h.reminder_sent,
         c.name as customer_name, c.email as customer_email, c.telephone as customer_telephone,
         c.language as customer_language, c.state as customer_state, c.erased as customer_erased
  from enquiries e
  join hires h on h.desk_id = e.desk_id and h.id = e.id
  join customers c on c.desk_id = e.desk_id and c.id = e.customer_id`;

export function localOf(date: string, time: string, repeated: string | null): LocalDateTime {
  return repeated ? { date, time, repeatedHour: repeated as 'first' | 'second' } : { date, time };
}

export async function stopsOf(deskId: string, enquiryId: string): Promise<Stop[]> {
  const rows = await query<{ id: string; text: string; checked: boolean }>(
    'select id, text, checked from stops where desk_id = $1 and enquiry_id = $2 order by position',
    [deskId, enquiryId],
  );
  return rows.map((row) => ({ id: row.id, text: row.text, checked: row.checked }));
}

export async function currentQuotePage(deskId: string, hireId: string): Promise<QuotePage | null> {
  const row = await one<{
    id: string;
    token: string;
    version: number;
    sent_at: string;
    valid_until: string;
    ends_at: string;
    accepted_at: string | null;
    deposit_said_sent: boolean;
    mailed: boolean;
    replaced: boolean;
  }>(
    `select id, token, version, sent_at, valid_until, ends_at, accepted_at, deposit_said_sent, mailed, replaced
     from quote_pages where desk_id = $1 and hire_id = $2 and replaced = false
     order by sent_at desc, id desc limit 1`,
    [deskId, hireId],
  );
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    version: Number(row.version),
    sentAt: Number(row.sent_at),
    validUntil: row.valid_until,
    endsAt: Number(row.ends_at),
    acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
    depositSaidSent: row.deposit_said_sent,
    mailed: row.mailed,
    replaced: row.replaced,
  };
}

/** A quote is valid until the end of the fifth UK calendar day after sending. */
export function quoteEnd(sentAt: number): { validUntil: string; endsAt: number } {
  if (config.quoteValidSeconds !== null) {
    const endsAt = sentAt + config.quoteValidSeconds * 1000;
    return { validUntil: ukDateOf(endsAt), endsAt };
  }
  const validUntil = addDays(ukDateOf(sentAt), 5);
  return { validUntil, endsAt: endOfUkDayInstant(validUntil) };
}

type VehicleRow = {
  id: string;
  position: number;
  seats: number;
  operator_id: string | null;
  bought_price: number;
  margin_tenths: number;
  deposit: number | null;
  extra_charges: number;
  run_id: string | null;
  depart_date: string | null;
  depart_time: string | null;
  depart_instant: string | null;
};

export async function loadHire(deskId: string, id: string): Promise<HireView | null> {
  const row = await one<EnquiryRow>(`${HIRE_SELECT} where e.desk_id = $1 and e.id = $2`, [deskId, id]);
  if (!row) return null;
  return buildHire(deskId, row);
}

export async function loadHireByVehicle(deskId: string, vehicleId: string): Promise<HireView | null> {
  const row = await one<{ hire_id: string }>('select hire_id from vehicles where desk_id = $1 and id = $2', [
    deskId,
    vehicleId,
  ]);
  return row ? loadHire(deskId, row.hire_id) : null;
}

async function buildHire(deskId: string, row: EnquiryRow): Promise<HireView> {
  const departAt = localOf(row.depart_date, row.depart_time, row.depart_repeated);
  const rates = row.rate_table_id
    ? ((await rateTableById(deskId, row.rate_table_id)) ?? (await rateTableInForce(deskId, ukDateOf(Date.now()))))
    : await rateTableInForce(deskId, ukDateOf(Date.now()));
  const vehicleRows = await query<VehicleRow>(
    `select v.id, v.position, v.seats, v.operator_id, v.bought_price, v.margin_tenths, v.deposit, v.extra_charges,
            r.id as run_id, r.depart_date, r.depart_time, r.depart_instant
     from vehicles v left join runs r on r.desk_id = v.desk_id and r.vehicle_id = v.id
     where v.desk_id = $1 and v.hire_id = $2 order by v.position`,
    [deskId, row.id],
  );
  const allocations = await query<{ vehicle_id: string | null; kind: string; sum: string }>(
    `select vehicle_id, kind, sum(amount)::text as sum from allocations
     where desk_id = $1 and hire_id = $2 group by vehicle_id, kind`,
    [deskId, row.id],
  );
  const lines = await ledgerLines(deskId, row.id);
  const refundsByVehicle = new Map<string, Pennies>();
  for (const line of lines) {
    if (line.account !== 'refundsDue' || !line.vehicleId) continue;
    refundsByVehicle.set(line.vehicleId, (refundsByVehicle.get(line.vehicleId) ?? 0) - line.amount);
  }
  const paidOf = (vehicleId: string, kind: string): Pennies =>
    Number(allocations.find((part) => part.vehicle_id === vehicleId && part.kind === kind)?.sum ?? 0);
  const credit = Number(allocations.find((part) => part.kind === 'credit')?.sum ?? 0);

  const vehicles: VehicleView[] = vehicleRows.map((vehicle) => {
    const seats = Number(vehicle.seats) as Size;
    const money = vehicleMoney(Number(vehicle.bought_price), Number(vehicle.margin_tenths), seats, rates);
    const extraCharges = Number(vehicle.extra_charges);
    const deposit = vehicle.deposit === null ? depositFor(money.total, seats, rates) : Number(vehicle.deposit);
    const depositPaid = paidOf(vehicle.id, 'deposit');
    const balancePaid = paidOf(vehicle.id, 'balance');
    const total = money.total + extraCharges;
    return {
      id: vehicle.id,
      position: Number(vehicle.position),
      seats,
      operatorId: vehicle.operator_id,
      boughtPrice: Number(vehicle.bought_price),
      marginTenths: Number(vehicle.margin_tenths),
      sellingPrice: money.sellingPrice,
      vat: money.vat,
      quoteTotal: money.total,
      extraCharges,
      total,
      deposit,
      depositPaid,
      balancePaid,
      refundsDue: refundsByVehicle.get(vehicle.id) ?? 0,
      owedAmount: Math.max(0, total - depositPaid - balancePaid),
      departAt: vehicle.depart_date ? { date: vehicle.depart_date, time: vehicle.depart_time as string } : departAt,
      departInstant: vehicle.depart_instant ? Number(vehicle.depart_instant) : Number(row.depart_instant),
      runId: vehicle.run_id,
    };
  });

  const allocationVehicles: AllocationVehicle[] = vehicles.map((vehicle) => ({
    id: vehicle.id,
    departInstant: vehicle.departInstant ?? Number(row.depart_instant),
    position: vehicle.position,
    deposit: vehicle.deposit,
    total: vehicle.total,
    depositPaid: vehicle.depositPaid,
    balancePaid: vehicle.balancePaid,
  }));
  const total = vehicles.reduce((sum, vehicle) => sum + vehicle.total, 0);
  const paid = vehicles.reduce((sum, vehicle) => sum + vehicle.depositPaid + vehicle.balancePaid, 0) + credit;
  const owed = Math.max(0, total - paid);
  const earliestDeparture = vehicles
    .map((vehicle) => vehicle.departAt?.date ?? row.depart_date)
    .sort()
    .at(0);

  return {
    deskId,
    id: row.id,
    reference: row.id,
    stage: row.stage,
    quoteVersion: Number(row.quote_version),
    rates,
    rateTableId: row.rate_table_id,
    awardedOperatorId: row.awarded_operator_id,
    awardedAt: row.awarded_at === null ? null : Number(row.awarded_at),
    cancelledAt: row.cancelled_at === null ? null : Number(row.cancelled_at),
    reminderSent: row.reminder_sent,
    occasion: row.occasion,
    enquiryState: row.state,
    journeyType: row.journey_type,
    departAt,
    departInstant: Number(row.depart_instant),
    returnAt: row.return_date ? localOf(row.return_date, row.return_time as string, row.return_repeated) : null,
    returnInstant: row.return_instant === null ? null : Number(row.return_instant),
    party: {
      people: Number(row.people),
      large: Number(row.large),
      medium: Number(row.medium),
      hand: Number(row.hand),
      wheelchairs: Number(row.wheelchairs),
    },
    details: row.details,
    language: row.language,
    submittedBody: row.submitted_body,
    mergedInto: row.merged_into,
    createdAt: Number(row.created_at),
    stops: await stopsOf(deskId, row.id),
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      email: row.customer_email,
      telephone: row.customer_telephone,
      language: row.customer_language,
      state: row.customer_state,
      erased: row.customer_erased,
    },
    vehicles,
    page: await currentQuotePage(deskId, row.id),
    paid,
    owed,
    credit,
    paymentState: paymentStateOf(allocationVehicles, credit),
    total,
    depositTotal: vehicles.reduce((sum, vehicle) => sum + vehicle.deposit, 0),
    balanceDueOn: earliestDeparture ? balanceDueOn(earliestDeparture) : null,
  };
}

/** A hire's last day is the UK date of its return, otherwise of its latest departure. */
export function lastDayOf(hire: HireView): string {
  if (hire.returnAt) return hire.returnAt.date;
  const dates = [hire.departAt.date, ...hire.vehicles.map((vehicle) => vehicle.departAt?.date ?? hire.departAt.date)];
  return dates.sort().at(-1) as string;
}

export function vehicleJson(vehicle: VehicleView): Record<string, unknown> {
  return {
    id: vehicle.id,
    seats: vehicle.seats,
    operatorId: vehicle.operatorId,
    boughtPrice: moneyString(vehicle.boughtPrice),
    marginPercent: marginString(vehicle.marginTenths),
    sellingPrice: moneyString(vehicle.sellingPrice),
    vat: moneyString(vehicle.vat),
    total: moneyString(vehicle.total),
    deposit: moneyString(vehicle.deposit),
    departAt: vehicle.departAt,
    departInstant: vehicle.departInstant === null ? null : instantString(vehicle.departInstant),
    runId: vehicle.runId,
  };
}

export function marginString(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const part = tenths % 10;
  return part === 0 ? String(whole) : `${whole}.${part}`;
}

export function hireJson(hire: HireView, runs: { id: string; number: number; sheetPath: string }[]): Record<string, unknown> {
  return {
    id: hire.id,
    reference: hire.reference,
    customerId: hire.customer.id,
    stage: hire.stage,
    enquiryState: hire.enquiryState,
    quotePath: hire.page ? `/q/${hire.page.token}` : null,
    sentAt: hire.page ? instantString(hire.page.sentAt) : null,
    validUntil: hire.page?.validUntil ?? null,
    endsAt: hire.page ? instantString(hire.page.endsAt) : null,
    vehicles: hire.vehicles.map(vehicleJson),
    runs,
  };
}

export function occasionLabel(occasion: Occasion): string {
  const labels: Record<Occasion, string> = {
    school: 'School',
    weddings: 'Weddings',
    company: 'Company',
    festivals: 'Festivals and sport',
  };
  return labels[occasion];
}

export function stateLabel(state: EnquiryState): string {
  const labels: Record<EnquiryState, string> = {
    new: 'New',
    priced: 'Priced',
    quoted: 'Quoted',
    won: 'Won',
    lost: 'Lost',
  };
  return labels[state];
}

export function validUntilLabel(page: QuotePage): string {
  return formatUkDate(page.validUntil);
}

export async function makeQuotePage(
  client: PoolClient,
  deskId: string,
  hireId: string,
  version: number,
  sentAt: number,
  mailed: boolean,
): Promise<QuotePage> {
  const { validUntil, endsAt } = quoteEnd(sentAt);
  const id = makeId('QP');
  const token = makeToken();
  await client.query(
    `insert into quote_pages (desk_id, id, hire_id, token, version, sent_at, valid_until, ends_at, mailed)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [deskId, id, hireId, token, version, sentAt, validUntil, endsAt, mailed],
  );
  return {
    id,
    token,
    version,
    sentAt,
    validUntil,
    endsAt,
    acceptedAt: null,
    depositSaidSent: false,
    mailed,
    replaced: false,
  };
}
