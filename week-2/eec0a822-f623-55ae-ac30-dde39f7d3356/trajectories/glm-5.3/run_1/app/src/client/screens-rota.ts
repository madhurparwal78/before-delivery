import { api, ApiError, errorCopy } from './api.js';
import { h, qs, qsa, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, addDays, daySlots, parseYmd, nextSaturdayAfter, isSaturday } from '../shared/bases.js';
import { BASE_OFFSETS } from '../shared/offsets.js';
import { member } from './shell.js';

function baseOffsetMs(base: 'split' | 'lavrio', utcMs: number): number {
  const table = BASE_OFFSETS[base];
  let offset = table[0][1];
  for (const [t, o] of table) {
    if (utcMs >= t) offset = o;
    else break;
  }
  return offset;
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Slots of the rota week, as they really occur (46/48/50 per day). */
function weekSlots(base: 'split' | 'lavrio', weekStart: string): Array<{ startsAtMs: number; label: string; date: string }> {
  const out: Array<{ startsAtMs: number; label: string; date: string }> = [];
  for (let d = 0; d < 7; d++) {
    const date = addDays(weekStart, d);
    for (let hh = 0; hh < 24; hh++) {
      for (const mm of [0, 30]) {
        const wall = Date.UTC(parseYmd(date)!.year, parseYmd(date)!.month - 1, parseYmd(date)!.day, hh, mm);
        const probes = [7200000, 3600000, 0];
        const valid: number[] = [];
        for (const p of probes) {
          const utc = wall - p;
          if (utc + baseOffsetMs(base, utc) === wall) valid.push(p);
        }
        if (valid.length === 0) continue; // spring-forward gap
        valid.sort((a, b) => b - a);
        out.push({ startsAtMs: wall - valid[0], label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, date });
        if (valid.length > 1) {
          out.push({ startsAtMs: wall - valid[1], label: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (repeat)`, date });
        }
      }
    }
  }
  out.sort((a, b) => a.startsAtMs - b.startsAtMs);
  return out;
}

export async function rotaScreen(ws: string, slug: string): Promise<HTMLElement> {
  const yachtRes = await api<any>(`/api/w/${ws}/yachts/${slug}`);
  const base = yachtRes.yacht.base as 'split' | 'lavrio';
  const params = new URLSearchParams(location.search);
  const weekStart = params.get('week') ?? nextSaturdayAfter('split', addDays(fmtToday(), -1));
  const rota = await api<any>(`/api/w/${ws}/yachts/${slug}/rota?weekStart=${weekStart}`);
  const slots = weekSlots(base, rota.weekStart);
  const version = { v: rota.version };
  const work = new Map<string, Set<string>>();
  for (const [crewId, starts] of Object.entries<any>(rota.work ?? {})) {
    work.set(crewId, new Set(starts));
  }
  const typed = new Map<string, Set<number>>();
  for (const c of rota.crew) {
    typed.set(c.id, new Set([...(work.get(c.id) ?? [])].map((s) => Date.parse(s)).filter((n) => !Number.isNaN(n))));
  }
  const msgBox = h('div', {});
  const dayTabs = h('div', { role: 'tablist', 'aria-label': 'Rota days', style: 'display:flex;gap:0.4rem;flex-wrap:wrap;margin:0.8rem 0' });
  let activeDay = slots[0].date;
  const daysOfWeek = Array.from(new Set(slots.map((s) => s.date)));

  const gridWrap = h('div', { class: 'rota-frame' });
  const grid = h('table', { class: 'rota-grid', role: 'grid', 'aria-label': 'Rota', tabindex: '0' });
  const active = { crew: 0, slot: 0 };
  const anchor = { crew: 0, slot: 0 };
  const selection = new Set<string>();

  const dayLabel = (date: string): string => {
    const d = parseYmd(date)!;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.month - 1];
    return `${wd} ${d.day} ${mo}`;
  };

  const renderTabs = () => {
    dayTabs.textContent = '';
    daysOfWeek.forEach((date, i) => {
      const tab = h('button', { role: 'tab', 'aria-selected': date === activeDay ? 'true' : 'false', style: 'min-height:44px' }, dayLabel(date));
      tab.addEventListener('click', () => {
        activeDay = date;
        active.slot = 0;
        renderTabs();
        renderGrid();
      });
      dayTabs.append(tab);
    });
  };

  const daySlotsList = (): Array<{ startsAtMs: number; label: string }> => slots.filter((s) => s.date === activeDay);

  const renderGrid = () => {
    const list = daySlotsList();
    grid.textContent = '';
    const colGroup = h('colgroup', {});
    colGroup.append(h('col', { style: 'width:120px' }));
    for (const _ of list) colGroup.append(h('col', {}));
    grid.append(colGroup);
    const headRow: HTMLElement = h('tr', { role: 'row' }, h('td', { role: 'columnheader', class: 'rh name' }, 'Crew'));
    for (const s of list) {
      const parts = s.label.split(':');
      const label = `${parts[0]}:${parts[1]}`;
      const ch = h('td', { role: 'columnheader', class: 'ch' }, label.split(' ')[0], s.label.includes('(repeat)') ? h('span', { class: 'rep' }, '(repeat)') : h('span', { style: 'display:none' }, ''));
      (headRow as HTMLElement).append(ch);
    }
    grid.append(h('thead', {}, headRow));
    const body = h('tbody', {});
    rota.crew.forEach((c: any, ci: number) => {
      const row = h('tr', { role: 'row' }, h('td', { role: 'rowheader', class: 'rh name' }, c.name));
      list.forEach((s, si) => {
        const isWork = typed.get(c.id)?.has(s.startsAtMs);
        const key = `${ci}:${si}`;
        const cell = h('td', {
          role: 'gridcell',
          class: `cell ${isWork ? 'W' : 'R'}`,
          'aria-selected': selection.has(key) ? 'true' : 'false',
          'aria-label': `${c.name} ${s.label}`,
          tabindex: '-1',
        }, isWork ? 'W' : 'R');
        cell.classList.add('c' + ci + 's' + si);
        if (ci === active.crew && si === active.slot) cell.classList.add('active');
        if (selection.has(key)) cell.classList.add('sel');
        body.append(row);
        row.append(cell);
      });
    });
    grid.append(body);
  };

  // Grid keyboard handling: the grid is one Tab stop.
  grid.addEventListener('keydown', (e) => {
    const list = daySlotsList();
    const key = e.key;
    const move = (dc: number, ds: number, extend: boolean) => {
      const c = Math.max(0, Math.min(rota.crew.length - 1, active.crew + dc));
      const s = Math.max(0, Math.min(list.length - 1, active.slot + ds));
      if (!extend) {
        selection.clear();
        anchor.crew = c;
        anchor.slot = s;
      } else {
        // Extend a rectangular selection from the anchor.
        selection.clear();
        for (let ci = Math.min(anchor.crew, c); ci <= Math.max(anchor.crew, c); ci++) {
          for (let si = Math.min(anchor.slot, s); si <= Math.max(anchor.slot, s); si++) {
            selection.add(`${ci}:${si}`);
          }
        }
      }
      active.crew = c;
      active.slot = s;
      renderGrid();
      grid.focus();
    };
    if (key === 'ArrowLeft') { e.preventDefault(); move(0, -1, e.shiftKey); }
    else if (key === 'ArrowRight') { e.preventDefault(); move(0, 1, e.shiftKey); }
    else if (key === 'ArrowUp') { e.preventDefault(); move(-1, 0, e.shiftKey); }
    else if (key === 'ArrowDown') { e.preventDefault(); move(1, 0, e.shiftKey); }
    else if (key === 'Home') { e.preventDefault(); move(0, -active.slot, e.shiftKey); }
    else if (key === 'End') { e.preventDefault(); move(0, list.length - 1 - active.slot, e.shiftKey); }
    else if (key === ' ') {
      e.preventDefault();
      toggleActive();
    }
  });

  const toggleActive = () => {
    const crew = rota.crew[active.crew];
    const list = daySlotsList();
    const slot = list[active.slot];
    if (!crew || !slot) return;
    const set = typed.get(crew.id) ?? new Set<number>();
    const next = new Set(selection.size > 0 ? [...selection].map((k) => {
      const [ci, si] = k.split(':').map(Number);
      return { ci, si };
    }) : [{ ci: active.crew, si: active.slot }]);
    // With a selection, set every selected cell to the opposite of the active cell.
    const currentState = set.has(slot.startsAtMs);
    for (const { ci, si } of next) {
      const c = rota.crew[ci];
      const s = list[si];
      if (!c || !s) continue;
      const targetSet = typed.get(c.id) ?? new Set<number>();
      if (currentState) targetSet.delete(s.startsAtMs);
      else targetSet.add(s.startsAtMs);
      typed.set(c.id, targetSet);
    }
    renderGrid();
    dirty.changed = true;
  };

  // Touch: tapping a cell switches it, judged from the event's pointer type.
  grid.addEventListener('pointerdown', (e) => {
    if ((e as PointerEvent).pointerType !== 'touch') return;
    const cell = (e.target as HTMLElement).closest('td.cell');
    if (!cell) return;
    e.preventDefault();
    const idx = [...grid.querySelectorAll('td.cell')].indexOf(cell);
    const cols = daySlotsList().length;
    active.crew = Math.floor(idx / cols);
    active.slot = idx % cols;
    selection.clear();
    anchor.crew = active.crew;
    anchor.slot = active.slot;
    toggleActive();
  });

  const save = h('button', { class: 'primary' }, 'Save rota');
  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = 'Saving rota';
    announce('Saving rota');
    const workOut: Record<string, string[]> = {};
    for (const c of rota.crew) {
      workOut[c.id] = [...(typed.get(c.id) ?? [])].sort((a, b) => a - b).map((ms) => iso(ms));
    }
    try {
      const res = await api<any>(`/api/w/${ws}/yachts/${slug}/rota?weekStart=${rota.weekStart}`, {
        method: 'PUT',
        body: JSON.stringify({ version: version.v, work: workOut }),
      });
      version.v = res.version;
      dirty.changed = false;
      const copy = 'Rota saved.';
      message('ok', copy, msgBox);
      announce(copy);
    } catch (err) {
      const e = err as ApiError;
      let copy: string;
      if (e.body?.error === 'stale_rota') {
        copy = `${e.body.savedBy} saved this rota at ${fmtDateTime(base, { ms: Date.parse(e.body.savedAt) })}. Your changes are still here — check them and save again.`;
        message('err', copy, msgBox);
        announce(copy);
      } else if (e.body?.error === 'rest_rule') {
        const ruleText: Record<string, string> = {
          max_gap_14h: 'no more than 14 hours between rest periods',
          min_rest_24h: 'at least 10 hours of rest in any 24 hours',
          min_rest_168h: 'at least 77 hours of rest in any 7 days',
          rest_periods_24h: 'rest in no more than two periods, one of at least 6 hours',
        };
        copy = `${e.body.crewName} breaks the rest rules: ${ruleText[e.body.rule]}, from ${fmtDateTime(base, { ms: Date.parse(e.body.windowStart) })} to ${fmtDateTime(base, { ms: Date.parse(e.body.windowEnd) })}.`;
        message('err', copy, msgBox);
        announce(copy);
      } else if (e.status === 401) {
        msgBox.textContent = '';
        msgBox.append(h('div', { class: 'msg err', role: 'alert' },
          h('span', {}, e.body?.error === 'access_removed' ? 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.' : 'Your session has ended. Sign in again — what you typed is kept.' + ' '),
          h('a', { href: `/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}` }, 'Sign in again')));
        announce('Your session has ended. Sign in again — what you typed is kept.');
      } else {
        copy = errorCopy(e).message;
        message('err', copy, msgBox);
        announce(copy);
      }
    } finally {
      save.disabled = false;
      save.textContent = 'Save rota';
    }
  });

  renderTabs();
  renderGrid();

  const dirty = { changed: false };
  const weekLink = (label: string, week: string) => {
    const href = `/w/${ws}/yachts/${slug}/rota?week=${week}`;
    const link = h('a', { href }, label);
    link.addEventListener('click', (e) => {
      if (!dirty.changed) return;
      e.preventDefault();
      e.stopPropagation();
      openDialog('Discard changes', (panel, ctrl) => {
        const keep = h('button', { class: 'primary' }, 'Keep editing');
        keep.addEventListener('click', () => ctrl.close());
        const discard = h('button', { class: 'danger' }, 'Discard changes');
        discard.addEventListener('click', () => {
          dirty.changed = false;
          ctrl.close();
          location.href = href;
        });
        panel.append(
          h('h2', {}, 'Discard changes'),
          h('p', {}, 'Leave this week and discard the typed cells?'),
          h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, keep, discard),
        );
      }, { sheet: window.innerWidth < 1024 });
    });
    return link;
  };
  const weekNav = h('p', {},
    weekLink('Previous week', addDays(rota.weekStart, -7)),
    h('span', { class: 'num', style: 'margin:0 0.8rem' }, `Week of ${fmtDateOnly('split', rota.weekStart)}`),
    weekLink('Next week', addDays(rota.weekStart, 7)),
  );

  return h('div', {},
    h('h1', {}, `${yachtRes.yacht.name} rota`),
    weekNav,
    dayTabs,
    gridWrap,
    gridWrap.append(grid),
    msgBox,
    save,
  );
}

function fmtToday(): string {
  const utcMs = Date.now();
  const off = baseOffsetMs('split', utcMs);
  return new Date(utcMs + off).toISOString().slice(0, 10);
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}
