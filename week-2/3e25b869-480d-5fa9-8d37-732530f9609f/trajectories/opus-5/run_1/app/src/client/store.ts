import { DEFAULT_PROVINCE } from '../shared/money.js';
import type {
  Batch,
  Cart,
  OrderSummary,
  ProvinceCode,
  ServiceStatus,
  StaffRole,
  SubscriptionSummary,
} from '../shared/types.js';
import { api, ApiFailure } from './api.js';

export type AccountView = {
  customer: { email: string; locale: string };
  orders: OrderSummary[];
  subscriptions: SubscriptionSummary[];
};

export type Store = {
  status: ServiceStatus | null;
  batches: Batch[];
  serverNow: string | null;
  cart: Cart | null;
  province: ProvinceCode;
  account: AccountView | null;
  staff: { email: string; name: string; role: StaffRole } | null;
  selectedBatch: string | null;
  verifiedEmail: string | null;
};

export const store: Store = {
  status: null,
  batches: [],
  serverNow: null,
  cart: null,
  province: DEFAULT_PROVINCE,
  account: null,
  staff: null,
  selectedBatch: null,
  verifiedEmail: null,
};

export const POLL_MS = 5_000;

export function selectedBatch(): Batch | null {
  const chosen = store.batches.find((batch) => batch.code === store.selectedBatch);
  if (chosen) return chosen;
  return defaultBatch();
}

/** The first live batch in server order, or the first batch listed when none is live. */
export function defaultBatch(): Batch | null {
  return store.batches.find((batch) => batch.state === 'live') ?? store.batches[0] ?? null;
}

export async function loadStatus(): Promise<void> {
  try {
    store.status = await api.get<ServiceStatus>('/api/status');
  } catch {
    store.status = null;
  }
}

export async function loadDrop(): Promise<void> {
  const payload = await api.get<{ server_now: string; batches: Batch[] }>('/api/drop');
  store.batches = payload.batches;
  store.serverNow = payload.server_now;
}

export async function loadCart(): Promise<void> {
  store.cart = await api.get<Cart>(`/api/cart?province=${store.province}`);
}

export async function loadAccount(): Promise<boolean> {
  try {
    store.account = await api.get<AccountView>('/api/account');
    store.verifiedEmail = store.account.customer.email;
    return true;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) store.account = null;
    return false;
  }
}

export async function loadStaff(): Promise<boolean> {
  try {
    const payload = await api.get<{ staff: { email: string; name: string; role: StaffRole } }>(
      '/api/staff/me',
    );
    store.staff = payload.staff;
    return true;
  } catch {
    store.staff = null;
    return false;
  }
}

const timers: number[] = [];

export function everyPoll(run: () => void | Promise<void>): void {
  timers.push(window.setInterval(() => void run(), POLL_MS));
}

export function stopPolling(): void {
  while (timers.length > 0) {
    const timer = timers.pop();
    if (timer !== undefined) window.clearInterval(timer);
  }
}
