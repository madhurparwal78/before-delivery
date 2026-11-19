import { Pennies, halfUpDivide } from './money.js';
import { daysBetween } from './time.js';

export type AllocationVehicle = {
  id: string;
  departInstant: number;
  position: number;
  deposit: Pennies;
  total: Pennies;
  depositPaid: Pennies;
  balancePaid: Pennies;
};

export type AllocationPart = { vehicleId: string; kind: 'deposit' | 'balance'; amount: Pennies };
export type Allocation = { parts: AllocationPart[]; credit: Pennies };

export function allocationOrder(vehicles: AllocationVehicle[]): AllocationVehicle[] {
  return [...vehicles].sort((a, b) => a.departInstant - b.departInstant || a.position - b.position);
}

/** Money goes to vehicles by departure then list order, deposits first, then balances, to the penny. */
export function allocate(amount: Pennies, vehicles: AllocationVehicle[]): Allocation {
  const order = allocationOrder(vehicles);
  const parts: AllocationPart[] = [];
  let left = amount;
  for (const vehicle of order) {
    if (left <= 0) break;
    const owed = Math.max(0, vehicle.deposit - vehicle.depositPaid);
    const taken = Math.min(owed, left);
    if (taken > 0) {
      parts.push({ vehicleId: vehicle.id, kind: 'deposit', amount: taken });
      left -= taken;
    }
  }
  for (const vehicle of order) {
    if (left <= 0) break;
    const owed = Math.max(0, vehicle.total - Math.max(vehicle.deposit, vehicle.depositPaid) - vehicle.balancePaid);
    const taken = Math.min(owed, left);
    if (taken > 0) {
      parts.push({ vehicleId: vehicle.id, kind: 'balance', amount: taken });
      left -= taken;
    }
  }
  return { parts, credit: left };
}

export type PaymentState = 'nothingPaid' | 'depositPartPaid' | 'depositPaid' | 'paidInFull';

const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  nothingPaid: 'Nothing paid',
  depositPartPaid: 'Part of the deposit paid',
  depositPaid: 'Deposit paid',
  paidInFull: 'Paid in full',
};

export function paymentStateLabel(state: PaymentState): string {
  return PAYMENT_STATE_LABELS[state];
}

/** Worked out from money and totals at each read. */
export function paymentStateOf(vehicles: AllocationVehicle[], credit: Pennies): PaymentState {
  const paid = vehicles.reduce((sum, vehicle) => sum + vehicle.depositPaid + vehicle.balancePaid, 0) + credit;
  const total = vehicles.reduce((sum, vehicle) => sum + vehicle.total, 0);
  const owed = Math.max(0, total - paid);
  if (paid <= 0) return 'nothingPaid';
  if (owed <= 0) return 'paidInFull';
  const depositsPaid = vehicles.every((vehicle) => vehicle.depositPaid >= vehicle.deposit);
  return depositsPaid ? 'depositPaid' : 'depositPartPaid';
}

export const BALANCE_DUE_DAYS_BEFORE = 7;
export const REMINDER_DAYS_BEFORE = 10;

export function balanceDueOn(departureDate: string): string {
  const [year, month, day] = departureDate.split('-').map(Number);
  const due = new Date(Date.UTC(year, month - 1, day - BALANCE_DUE_DAYS_BEFORE));
  return due.toISOString().slice(0, 10);
}

export type CancellationBand = { days: number; chargeOf: (total: Pennies, deposit: Pennies) => Pennies };

/** Days between UK calendar dates, then the published band, with the deposit floor and total cap. */
export function cancellationCharge(
  noticeDate: string,
  departureDate: string,
  total: Pennies,
  deposit: Pennies,
): { days: number; charge: Pennies } {
  const days = daysBetween(noticeDate, departureDate);
  let charge: Pennies;
  if (days >= 30) charge = deposit;
  else if (days >= 15) charge = halfUpDivide(total * 25, 100);
  else if (days >= 8) charge = halfUpDivide(total * 50, 100);
  else charge = total;
  charge = Math.max(charge, deposit);
  charge = Math.min(charge, total);
  return { days, charge };
}

export const FREE_WAITING_MINUTES = 15;
export const FREE_AIRPORT_MINUTES = 60;

/** Waiting beyond the free minutes, at the hour rate pro rata per minute, half up per stop. */
export function waitingCharge(minutes: number, freeMinutes: number, ratePerHour: Pennies): Pennies {
  const charged = Math.max(0, minutes - freeMinutes);
  if (charged === 0) return 0;
  return halfUpDivide(ratePerHour * charged, 60);
}
