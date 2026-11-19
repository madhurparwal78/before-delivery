import { addDays, PlainDate } from '../shared/dates';
import { call } from './api';
import { currentLayout, Layout } from './dom';
import { closeAllDialogs } from './dialog';
import { setMessage, regionNames } from './regions';
import {
  Board,
  CloseResult,
  DeskSummary,
  Guest,
  RatePlan,
  Report,
  Stay,
  TaxRate,
  Timeline,
  User,
  Blocker,
} from './types';

export const TIMELINE_NIGHTS = 14;
export const WINDOW_STEP = 7;

export interface Pickup {
  stayId: string;
  status: string;
  guestName: string;
  nights: number;
  originRoomId: string;
  originFirstNight: PlainDate;
  roomId: string;
  firstNight: PlainDate;
  version: number;
}

export interface AppState {
  user: User | null;
  route: string;
  layout: Layout;
  desk: DeskSummary | null;
  timeline: Timeline | null;
  windowStart: PlainDate | null;
  currentRoomId: string | null;
  currentDate: PlainDate | null;
  focusZone: 'cell' | 'rack';
  pickup: Pickup | null;
  board: Board | null;
  ratePlans: RatePlan[];
  taxRates: TaxRate[];
  guests: Guest[];
  guestSearch: string;
  report: Report | null;
  reportFrom: PlainDate | null;
  reportTo: PlainDate | null;
  stay: Stay | null;
  stayLoadToken: number;
  closePhase: 'idle' | 'night' | 'stamping' | 'slide';
  ground: 'day' | 'night';
  closeResult: CloseResult | null;
  closeResultShown: boolean;
  blockers: Blocker[];
  todayOpen: boolean;
}

export const state: AppState = {
  user: null,
  route: '/',
  layout: currentLayout(),
  desk: null,
  timeline: null,
  windowStart: null,
  currentRoomId: null,
  currentDate: null,
  focusZone: 'cell',
  pickup: null,
  board: null,
  ratePlans: [],
  taxRates: [],
  guests: [],
  guestSearch: '',
  report: null,
  reportFrom: null,
  reportTo: null,
  stay: null,
  stayLoadToken: 0,
  closePhase: 'idle',
  ground: 'day',
  closeResult: null,
  closeResultShown: false,
  blockers: [],
  todayOpen: false,
};

type Renderer = () => void;

let renderer: Renderer = () => undefined;

export function setRenderer(next: Renderer): void {
  renderer = next;
}

export function render(): void {
  renderer();
}

export function homeFor(role: User['role']): string {
  return role === 'housekeeper' ? '/board' : '/desk';
}

const routeRoles: Record<string, User['role'][]> = {
  '/desk': ['owner', 'front_desk'],
  '/board': ['owner', 'front_desk', 'housekeeper'],
  '/guests': ['owner', 'front_desk'],
  '/rates': ['owner'],
  '/reports': ['owner'],
};

export function mayOpen(role: User['role'], route: string): boolean {
  const roles = routeRoles[route];
  return roles !== undefined && roles.includes(role);
}

export function navigate(route: string): void {
  closeAllDialogs();
  window.history.pushState({}, '', route);
  state.route = route;
  void loadRoute();
}

export async function loadDesk(): Promise<void> {
  const [desk, plans] = await Promise.all([
    call<DeskSummary>('/api/desk'),
    call<{ ratePlans: RatePlan[] }>('/api/rate-plans'),
  ]);
  if (desk.data) {
    state.desk = desk.data;
    setMessage(regionNames.businessDate, desk.data.hotel.businessDate);
    setMessage(regionNames.freeRooms, desk.data.freeRoomsText);
    if (state.windowStart === null) {
      state.windowStart = addDays(desk.data.hotel.businessDate, -1);
    }
    if (state.closeResult === null) state.closeResult = desk.data.lastClose;
  }
  if (plans.data) state.ratePlans = plans.data.ratePlans;
  await loadTimeline();
}

export async function loadTimeline(): Promise<void> {
  if (state.windowStart === null) return;
  const from = state.windowStart;
  const to = addDays(from, TIMELINE_NIGHTS - 1);
  const result = await call<Timeline>(`/api/timeline?from=${from}&to=${to}`);
  if (!result.data) return;
  state.timeline = result.data;
  if (state.currentRoomId === null && result.data.rooms.length > 0) {
    state.currentRoomId = result.data.rooms[0].id;
  }
  if (state.currentDate === null) state.currentDate = result.data.businessDate;
}

export async function loadBoard(): Promise<void> {
  const result = await call<Board>('/api/housekeeping/board');
  if (result.data) state.board = result.data;
}

export async function loadGuests(): Promise<void> {
  const search = encodeURIComponent(state.guestSearch);
  const result = await call<{ guests: Guest[] }>(`/api/guests?search=${search}`);
  if (result.data) state.guests = result.data.guests;
}

export async function loadRates(): Promise<void> {
  const [plans, rates] = await Promise.all([
    call<{ ratePlans: RatePlan[] }>('/api/rate-plans'),
    call<{ taxRates: TaxRate[] }>('/api/tax-rates'),
  ]);
  if (plans.data) state.ratePlans = plans.data.ratePlans;
  if (rates.data) state.taxRates = rates.data.taxRates;
}

export async function loadReport(): Promise<void> {
  if (state.reportFrom === null || state.reportTo === null) return;
  const result = await call<Report>(
    `/api/reports?from=${state.reportFrom}&to=${state.reportTo}`,
  );
  if (result.data) state.report = result.data;
}

export async function loadRoute(): Promise<void> {
  const route = state.route;
  if (route === '/desk') await loadDesk();
  if (route === '/board') {
    await loadBoard();
    if (state.user && state.user.role !== 'housekeeper') await loadDesk();
  }
  if (route === '/guests') await loadGuests();
  if (route === '/rates') {
    await loadDesk();
    await loadRates();
  }
  if (route === '/reports') {
    await loadDesk();
    if (state.reportFrom === null && state.desk) {
      state.reportFrom = state.desk.hotel.businessDate;
      state.reportTo = state.desk.hotel.businessDate;
    }
    await loadReport();
  }
  render();
}

export async function signOut(): Promise<void> {
  await call('/api/session', { method: 'DELETE' });
  state.user = null;
  window.location.assign('/');
}
