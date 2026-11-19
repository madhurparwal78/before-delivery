// The published API client the spec files share.
import type { APIRequestContext, Page } from '@playwright/test';

export interface PublicUnit {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: string;
  price: number;
  pricePerM2: number;
  pricePerSqft: number;
  priceVersion: number;
  status: 'available' | 'held' | 'reserved';
  syncing: boolean;
  viewPhotographed: boolean;
  viewUrl: string | null;
}

export interface SearchReply {
  total: number;
  hits: PublicUnit[];
  facets: Record<string, Record<string, number>>;
  priceStats: { min: number; max: number } | null;
  matchingCodes: string[];
  nextCursor: string | null;
}

export interface Account {
  email: string;
  name: string;
  role: 'buyer' | 'coordinator';
}

export interface Hold {
  id: string;
  unitCode: string;
  status: 'active' | 'released' | 'lapsed' | 'converted';
  endedBy: 'buyer' | 'withdrawal' | 'lapse' | 'conversion' | null;
  quotedPrice: number;
  priceVersion: number;
  createdAt: string;
  endsAt: string;
  endedAt: string | null;
  shareUrl: string | null;
}

export const BASE = process.env.HIGHWATER_BASE_URL ?? 'http://127.0.0.1:4173';

export interface ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
}

async function call<T>(context: APIRequestContext, path: string, init?: { method?: string; data?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  const response = await context.fetch(path, {
    method: init?.method ?? 'GET',
    data: init?.data === undefined ? undefined : JSON.stringify(init.data),
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const body = text.length > 0 ? JSON.parse(text) : null;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(response.headers())) headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  return { status: response.status(), body: body as T, headers };
}

export async function get<T>(context: APIRequestContext, path: string): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  return call<T>(context, path);
}

export async function post<T>(context: APIRequestContext, path: string, data?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  return call<T>(context, path, { method: 'POST', data, headers });
}

export async function put<T>(context: APIRequestContext, path: string, data?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, string> }> {
  return call<T>(context, path, { method: 'PUT', data, headers });
}

export async function signIn(context: APIRequestContext, email: string, password: string): Promise<{ account: Account; cookie: string }> {
  const response = await context.fetch('/api/session', {
    method: 'POST',
    data: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as { account?: Account; error?: { message: string } }) : {};
  if (response.status() !== 200) throw new Error(`sign in failed: ${response.status()}: ${body.error?.message ?? ''}`);
  let setCookie = '';
  const raw = response.headersArray() as Array<{ name: string; value: string }>;
  for (const entry of raw) {
    if (String(entry.name ?? '').toLowerCase() === 'set-cookie') setCookie = String(entry.value ?? '');
  }
  const cookie = setCookie.split(';')[0];
  return { account: body.account as Account, cookie };
}

// Creates a fresh buyer account so a suite never collides with another suite's
// hold attempt window or one-hold state.
export async function freshBuyer(context: APIRequestContext, label: string): Promise<{ cookie: string; account: Account }> {
  const email = `buyer-${label}-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
  const password = `Buyer-Pass-${Date.now()}`;
  await context.fetch('/api/accounts', {
    method: 'POST',
    data: JSON.stringify({ name: 'Test Buyer', email, password }),
    headers: { 'content-type': 'application/json' },
    failOnStatusCode: false,
  });
  return signIn(context, email, password);
}

// A sign-in attempt that is allowed to fail, for the published 401 case.
export async function trySignIn(context: APIRequestContext, email: string, password: string): Promise<{ status: number; account: Account | null; cookie: string }> {
  const response = await context.fetch('/api/session', {
    method: 'POST',
    data: JSON.stringify({ email, password }),
    headers: { 'content-type': 'application/json' },
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const text = await response.text();
  const body = text.length > 0 ? (JSON.parse(text) as { account?: Account }) : {};
  let cookie = '';
  if (response.status() === 200) {
    const raw = response.headersArray() as Array<{ name: string; value: string }>;
    for (const entry of raw) {
      if (String(entry.name ?? '').toLowerCase() === 'set-cookie') cookie = String(entry.value ?? '').split(';')[0];
    }
  }
  return { status: response.status(), account: body.account ?? null, cookie };
}

export async function signInPage(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
  await dialog.getByRole('textbox', { name: 'Password' }).fill(password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#notices')?.textContent === 'Signed in.');
}

export const ACCOUNTS = {
  coordinator: { email: 'mira.castell@orrinvale.example', password: 'Highwater-Console-26' },
  ana: { email: 'ana.ferreira@example.com', password: 'Window-Seat-2026' },
  tom: { email: 'tom.okafor@example.com', password: 'Harbour-Line-2026' },
};
