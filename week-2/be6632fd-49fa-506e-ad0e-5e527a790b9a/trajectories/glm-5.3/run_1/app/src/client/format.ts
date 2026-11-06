// Formatting helpers shared by every screen. Every date and time on screen follows
// the published formats, computed against the server's clock where countdowns run.
import type { ApiFail } from './api.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad2(n: number): string { return String(n).padStart(2, '0'); }

// Copenhagen time is the anchor for every date the planner or calendar shows.
const CPH = 'Europe/Copenhagen';
const ZONES: Record<string, string> = {
  copenhagen: 'Europe/Copenhagen', stockholm: 'Europe/Stockholm', paris: 'Europe/Paris',
  london: 'Europe/London', new_york: 'America/New_York', tokyo: 'Asia/Tokyo'
};

export function partsIn(instant: Date, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number; dow: number; iso: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short'
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  return {
    y: Number(map.year), m: Number(map.month), d: Number(map.day),
    hh: Number(hour), mm: Number(map.minute), ss: Number(map.second),
    dow: DOW.indexOf(map.weekday.slice(0, 3)), iso: `${map.year}-${map.month}-${map.day}`
  };
}

export function cphParts(instant: Date): ReturnType<typeof partsIn> { return partsIn(instant, CPH); }

export function dateWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DOW[(dow + 6) % 7]} ${d} ${MON[m - 1]} ${y}`;
}

export function marketTimeWords(instant: Date, market: string, city: string): string {
  const tz = ZONES[market] ?? CPH;
  const p = partsIn(instant, tz);
  return `${DOW[p.dow]} ${p.d} ${MON[p.m - 1]} ${p.y}, ${pad2(p.hh)}:${pad2(p.mm)} ${city} time`;
}

export function money(amountMinor: number, currency: string): string {
  const decimals = currency === 'JPY' ? 0 : 2;
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amountMinor));
  let body: string;
  if (decimals === 0) body = group(abs);
  else body = `${group(Math.floor(abs / 100))}.${pad2(abs % 100)}`;
  return `${sign}${currency} ${body}`;
}

function group(n: number): string { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

export function isoWeekOf(iso: string): { key: string; label: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7;
  const thursday = new Date(date.getTime() + (3 - day) * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const jan1Day = (jan1.getUTCDay() + 6) % 7;
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return { key: `${isoYear}-W${pad2(week)}`, label: `Week ${week} · ${isoYear}` };
}

export function countdown(remaining: number): string {
  if (remaining <= 0) return '00:00:00';
  const total = Math.floor(remaining / 1000);
  const dd = Math.floor(total / 86400);
  const hh = Math.floor((total % 86400) / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const core = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
  return dd > 0 ? `${dd}d ${core}` : core;
}

export function isNightLocal(instant: Date, market: string): boolean {
  const p = partsIn(instant, ZONES[market] ?? CPH);
  return p.hh >= 22 || p.hh < 7;
}

export function instantOfParts(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm));
}

export function parseInstant(s: string): Date { return new Date(s); }

// The spoken value of the dial's slider: the drop's date and time in Copenhagen.
export function spokenCopenhagen(dateIso: string, hh: number, mm: number): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return `${DOW[dow]} ${d} ${MON[m - 1]} ${y}, ${pad2(hh)}:${pad2(mm)} Copenhagen time`;
}

export function announce(el: HTMLElement, text: string): void {
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = text; });
}

export function statusClass(fail: ApiFail | null): string {
  return fail && fail.status >= 400 ? 'status-err' : 'status-ok';
}
