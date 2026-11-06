import { api, ApiError, errorCopy } from './api.js';
import { h, qs, qsa, announce, passageAnnounce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtNm, fmtKn } from '../shared/bases.js';
import { computePassage, haversineNm, type Anchorage, type LegInput, type PassageComputed } from '../shared/passage.js';
import { member, isSessionError, sessionBanner } from './shell.js';
import { Decimal } from '../shared/decimal.js';

interface PassageState {
  id: string;
  yachtSlug: string;
  name: string;
  status: 'draft' | 'sent';
  base: 'split' | 'lavrio';
  startAnchorageId: string;
  departureDate: string;
  departureTime: string;
  startChargePct: number;
  legs: Array<{ toAnchorageId: string; speedKn: number }>;
}

export async function passagesScreen(ws: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/passages`);
  const table = h('table', { 'aria-label': 'Passages' });
  const tbody = h('tbody', {});
  if (data.passages.length === 0) {
    tbody.append(h('tr', {}, h('td', {}, 'No passages yet.')));
  }
  for (const p of data.passages) {
    tbody.append(h('tr', {},
      h('td', {}, h('a', { href: `/w/${ws}/passages/${p.id}` }, p.name)),
      h('td', {}, p.yachtSlug),
      h('td', {}, p.status === 'sent' ? 'Sent' : 'Draft'),
      h('td', { class: 'num' }, fmtDateOnly(p.base, p.departsAt)),
    ));
  }
  table.append(tbody);
  return h('div', {},
    h('h1', {}, 'Passages'),
    h('p', {}, h('a', { href: `/w/${ws}/passages/new` }, 'New passage')),
    table,
  );
}

export async function newPassageScreen(ws: string): Promise<HTMLElement> {
  const [yachtsData, anchoragesData] = await Promise.all([
    api<any>(`/api/w/${ws}/yachts`),
    api<any>(`/api/w/${ws}/anchorages`),
  ]);
  const anchorages: Anchorage[] = anchoragesData.anchorages;
  const yachtSel = h('select', { 'aria-label': 'Yacht' });
  for (const y of yachtsData.yachts) {
    yachtSel.append(h('option', { value: y.slug }, y.name));
  }
  const first = [...yachtSel.options].sort((a, b) => a.textContent!.localeCompare(b.textContent!))[0];
  if (first) yachtSel.value = first.value;
  const name = h('input', { 'aria-label': 'Passage name', value: '' });
  const date = h('input', { type: 'text', 'aria-label': 'Departure date', placeholder: 'YYYY-MM-DD' });
  const time = h('input', { type: 'text', 'aria-label': 'Departure time', placeholder: 'HH:MM', value: '09:00' });
  const charge = h('input', { type: 'number', 'aria-label': 'Starting charge', value: '100', min: '0', max: '100', step: '1' });
  const start = h('select', { 'aria-label': 'Start anchorage' });
  const fillStart = () => {
    start.textContent = '';
    const yacht = yachtsData.yachts.find((y: any) => y.slug === yachtSel.value);
    const baseAnchorage = anchorages.find((a) => a.id === (yacht.base === 'split' ? 'split-base' : 'lavrio-base'));
    if (baseAnchorage) start.append(h('option', { value: baseAnchorage.id }, baseAnchorage.name));
    for (const a of anchorages) {
      if (a.id !== baseAnchorage?.id) start.append(h('option', { value: a.id }, a.name));
    }
  };
  fillStart();
  yachtSel.addEventListener('change', fillStart);
  const problems = h('div', { role: 'region', 'aria-label': 'Problems', class: 'problems', style: 'display:none' }, h('h2', {}, 'Problems'));
  const errBox = h('div', {});
  const btn = h('button', { class: 'primary' }, 'Create passage');
  btn.addEventListener('click', async () => {
    const errors: Record<string, string> = {};
    if (!name.value.trim()) errors.name = 'This field is required.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) errors.departureDate = 'Enter a date as YYYY-MM-DD.';
    if (!/^\d{2}:\d{2}$/.test(time.value)) errors.departureTime = 'Enter a time as HH:MM.';
    const pct = Number(charge.value);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) errors.startChargePct = 'Enter a whole number from 0 to 100.';
    if (Object.keys(errors).length > 0) {
      problems.style.display = '';
      problems.textContent = '';
      problems.append(h('h2', {}, 'Problems'));
      for (const [field, msg] of Object.entries(errors)) {
        const target = { name, departureDate: date, departureTime: time, startChargePct: charge }[field];
        problems.append(h('p', {}, h('a', {
          href: '#',
          onclick: (e: Event) => { e.preventDefault(); (target as HTMLElement).focus(); },
        }, `${fieldLabel(field)}: ${msg}`)));
      }
      return;
    }
    problems.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Creating passage';
    announce('Creating passage');
    try {
      const res = await api<any>(`/api/w/${ws}/passages`, {
        method: 'POST',
        body: JSON.stringify({
          yachtSlug: yachtSel.value,
          name: name.value,
          startAnchorageId: start.value,
          departureDate: date.value,
          departureTime: time.value,
          startChargePct: pct,
          legs: [],
        }),
      });
      announce('Passage created.');
      location.href = `/w/${ws}/passages/${res.passage.id}`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Create passage';
      const e = err as ApiError;
      if (e.status === 401) {
        errBox.textContent = '';
        errBox.append(sessionBanner(e));
        return;
      }
      const copy = errorCopy(e);
      errBox.textContent = '';
      errBox.append(h('p', { class: 'msg err' }, copy.message));
      announce(copy.message);
    }
  });
  return h('div', {},
    h('h1', {}, 'New passage'),
    problems,
    h('form', { novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
      h('div', { class: 'field' }, h('label', {}, 'Yacht'), yachtSel),
      h('div', { class: 'field' }, h('label', {}, 'Passage name'), name),
      h('div', { class: 'two-col' },
        h('div', { class: 'field' }, h('label', {}, 'Departure date'), date),
        h('div', { class: 'field' }, h('label', {}, 'Departure time'), time),
      ),
      h('div', { class: 'field' }, h('label', {}, 'Starting charge'), charge),
      h('div', { class: 'field' }, h('label', {}, 'Start anchorage'), start),
      errBox,
      btn,
    ),
  );
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    name: 'Passage name', departureDate: 'Departure date', departureTime: 'Departure time', startChargePct: 'Starting charge',
  };
  return map[field] ?? field;
}

export async function passageScreen(ws: string, id: string): Promise<HTMLElement> {
  const [passageRes, anchoragesData, yachtsData] = await Promise.all([
    api<any>(`/api/w/${ws}/passages/${id}`),
    api<any>(`/api/w/${ws}/anchorages`),
    api<any>(`/api/w/${ws}/yachts`),
  ]);
  const anchorages: Anchorage[] = anchoragesData.anchorages;
  const anchorageMap = new Map(anchorages.map((a) => [a.id, a]));
  const yacht = yachtsData.yachts.find((y: any) => y.slug === passageRes.passage.yachtSlug);
  const isCaptain = member!.role === 'captain' || member!.role === 'fleet_director';
  const isCrew = member!.role === 'crew_member';

  const state: PassageState = {
    id,
    yachtSlug: passageRes.passage.yachtSlug,
    name: passageRes.passage.name,
    status: passageRes.passage.status,
    base: passageRes.passage.base,
    startAnchorageId: passageRes.passage.startAnchorageId,
    departureDate: passageRes.passage.departureDate,
    departureTime: passageRes.passage.departureTime,
    startChargePct: passageRes.passage.startChargePct,
    legs: passageRes.passage.legs.map((l: any) => ({ toAnchorageId: l.toAnchorageId, speedKn: l.speedKn })),
  };

  const ribbon = h('img', { 'aria-label': 'Charge ribbon', class: 'ribbon', alt: 'Charge ribbon' });
  ribbon.setAttribute('role', 'img');
  const legsList = h('ul', { 'aria-label': 'Legs', style: 'list-style:none;padding:0;display:contents' });
  const hairline = h('div', { class: 'progresshair', style: 'display:none' }, h('div', { class: 'hairline-track' }, h('div', { style: 'width:0%' })));
  const sendBtn = h('button', { class: 'primary' }, 'Send to crew');
  const msgBox = h('div', {});
  const saveBtn = h('button', {}, 'Save passage');
  const updates = h('div', { 'aria-live': 'polite', 'data-passage-updates': '', class: 'visually-hidden', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });

  const compute = (): PassageComputed => {
    return computePassage({
      anchorages: anchorageMap,
      startAnchorageId: state.startAnchorageId,
      startChargePct: state.startChargePct,
      departsAt: departsInstant(),
      params: {
        batteryKwh: String(yacht.batteryKwh),
        hotelKw: String(yacht.hotelKw),
        solarKw: String(yacht.solarKw),
        dragKwPerKnCubed: String(yacht.dragKwPerKnCubed),
      },
    }, state.legs.map((l) => ({ toAnchorageId: l.toAnchorageId, speedKn: String(l.speedKn) })));
  };

  const departsInstant = (): { ms: number } => {
    // The departure instant is computed the same way the server does: base-local wall time to UTC.
    const d = state.departureDate;
    const t = /^(\d{2}):(\d{2})$/.exec(state.departureTime);
    if (!t) return { ms: Date.parse(`${d}T00:00:00Z`) };
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (!m) return { ms: Date.parse(`${d}T00:00:00Z`) };
    const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
    const probes = [7200000, 3600000, 0];
    const valid: number[] = [];
    for (const p of probes) {
      const utc = wall - p;
      const back = utc + offsetAt(utc);
      if (back === wall) valid.push(p);
    }
    if (valid.length === 0) return { ms: wall };
    return { ms: wall - Math.max(...valid) };
  };

  // Local offset table for the two bases (mirrors the shared display rules).
  const offsetAt = (utcMs: number): number => {
    const offsets = (window as any).__tzOffsets?.[state.base];
    if (!offsets) return 3600000;
    let off = offsets[0][1];
    for (const [ts, o] of offsets) {
      if (utcMs >= ts) off = o;
      else break;
    }
    return off;
  };

  const fmtLegArrival = (leg: any): string => {
    const name = leg.arrivalBase === 'split' ? 'Split' : 'Lavrio';
    const d = new Date(Date.parse(leg.arrivesAt) + (leg.arrivalBase === 'split' ? 3600000 : 7200000) + (dstAdjust(leg.arrivalBase, Date.parse(leg.arrivesAt))));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return `${wd} ${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} ${name} time`;
  };
  const dstAdjust = (base: 'split' | 'lavrio', utcMs: number): number => {
    const baseOff = offsetAt(utcMs);
    return baseOff - 3600000;
  };

  const chargeDigit = (pct: number): HTMLElement => {
    const span = h('span', { class: 'num' }, `${pct}%`);
    return span;
  };

  const activeLeg = { index: 0 };
  let lastCharges: number[] = [];

  const render = () => {
    const computed = compute();
    legsList.textContent = '';
    ribbon.setAttribute('data-min-charge', computed.minChargePct === null ? '' : String(computed.minChargePct));
    lastCharges = [];
    computed.legs.forEach((leg, i) => {
      lastCharges.push(leg.arrivalChargePct);
      const card = h('li', { class: `card leg-card ${leg.reserve === 'below_reserve' ? 'below' : ''}` });
      card.setAttribute('data-arrival-charge', String(leg.arrivalChargePct));
      card.setAttribute('data-reserve', leg.reserve);
      const speed = h('input', { type: 'range', min: '4', max: '12', step: '0.5', value: String(state.legs[i].speedKn), 'aria-label': `Leg ${i + 1} speed`, 'aria-valuetext': `${state.legs[i].speedKn.toFixed(1)} kn` });
      speed.addEventListener('input', () => {
        const kn = Number(speed.value);
        state.legs[i].speedKn = kn;
        speed.setAttribute('aria-valuetext', `${kn.toFixed(1)} kn`);
        updateFromLeg(i);
      });
      speed.addEventListener('keydown', (e) => {
        const kn = e as KeyboardEvent;
        const v = state.legs[i].speedKn;
        if (kn.key === 'PageUp') { e.preventDefault(); state.legs[i].speedKn = clamp(v + 2); }
        else if (kn.key === 'PageDown') { e.preventDefault(); state.legs[i].speedKn = clamp(v - 2); }
        else if (kn.key === 'Home') { e.preventDefault(); state.legs[i].speedKn = 4; }
        else if (kn.key === 'End') { e.preventDefault(); state.legs[i].speedKn = 12; }
        else return;
        (e.target as HTMLInputElement).value = String(state.legs[i].speedKn);
        (e.target as HTMLInputElement).setAttribute('aria-valuetext', `${state.legs[i].speedKn.toFixed(1)} kn`);
        updateFromLeg(i);
      });
      const removeBtn = h('button', { 'aria-label': `Remove leg ${i + 1}`, class: 'danger', style: 'min-width:44px' }, `Remove leg ${i + 1}`);
      removeBtn.addEventListener('click', () => {
        state.legs.splice(i, 1);
        render();
      });
      const chargeEl = chargeDigit(leg.arrivalChargePct);
      card.append(
        h('h3', {}, `Leg ${i + 1}: ${anchorageMap.get(leg.fromAnchorageId)?.name} to ${anchorageMap.get(leg.toAnchorageId)?.name}`),
        h('p', { class: 'num' }, `${fmtNm(leg.distanceNm)} · arrives ${fmtLegArrival(leg)}`),
        h('p', { class: 'num' }, 'Arrives with ', chargeEl),
        leg.reserve === 'below_reserve' ? h('p', { class: 'below-note' }, 'Below reserve') : h('span', { style: 'display:none' }, ''),
        h('div', { class: 'band', style: 'background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(217,131,36,0.25) 6px 12px); border: 1px solid var(--amber); border-radius: 10px' }),
        isCaptain || !isCrew ? h('div', { style: 'margin:0.6rem 0' }, speed) : h('span', {}),
        isCaptain || !isCrew ? removeBtn : h('span', {}),
      );
      legsList.append(card);
    });
    if (computed.legs.length === 0) {
      legsList.append(h('li', { class: 'empty' }, 'No legs yet.'));
    }
    drawRibbon(computed);
    const below = computed.legs.some((l) => l.reserve === 'below_reserve');
    sendBtn.disabled = isCrew || state.legs.length === 0 || below;
    positionHairline();
  };

  const clamp = (v: number): number => Math.max(4, Math.min(12, Math.round(v * 2) / 2));

  const updateFromLeg = (index: number) => {
    const computed = compute();
    // Update every leg from the changed one rightward.
    const cards = [...legsList.children] as HTMLElement[];
    computed.legs.forEach((leg, i) => {
      const card = cards[i];
      if (!card) return;
      card.setAttribute('data-arrival-charge', String(leg.arrivalChargePct));
      card.setAttribute('data-reserve', leg.reserve);
      card.classList.toggle('below', leg.reserve === 'below_reserve');
      const chargeEl = qs('.num.arr', card) ?? card.querySelectorAll('.num')[1];
      const below = qs('.below-note', card);
      if (leg.reserve === 'below_reserve' && !below) {
        card.append(h('p', { class: 'below-note' }, 'Below reserve'));
      } else if (leg.reserve !== 'below_reserve' && below) {
        below.remove();
      }
      if (i >= index) {
        if (chargeEl) {
          rollDigits(chargeEl as HTMLElement, leg.arrivalChargePct);
        }
        const label = card.querySelector('h3');
        if (label) label.textContent = `Leg ${i + 1}: ${anchorageMap.get(leg.fromAnchorageId)?.name} to ${anchorageMap.get(leg.toAnchorageId)?.name}`;
      }
    });
    ribbon.setAttribute('data-min-charge', computed.minChargePct === null ? '' : String(computed.minChargePct));
    drawRibbon(computed);
    const below = computed.legs.some((l) => l.reserve === 'below_reserve');
    sendBtn.disabled = isCrew || state.legs.length === 0 || below;
    const leg = computed.legs[index];
    if (leg) {
      const name = anchorageMap.get(leg.toAnchorageId)?.name ?? '';
      passageAnnounce(leg.reserve === 'below_reserve'
        ? `Leg ${index + 1} to ${name}: arrives with ${leg.arrivalChargePct}% — below reserve.`
        : `Leg ${index + 1} to ${name}: arrives with ${leg.arrivalChargePct}%.`);
    }
  };

  const rollDigits = (el: HTMLElement, pct: number) => {
    const target = `${pct}%`;
    if (el.dataset.roll === target) return;
    el.dataset.roll = target;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      el.textContent = target;
      return;
    }
    const old = el.textContent ?? '';
    const wrap = h('span', { class: 'digit' });
    const chars = [...target].map((ch, idx) => {
      const same = old[idx] === ch;
      const stack = h('span', { class: 'stack' }, h('span', {}, old[idx] ?? ''), h('span', {}, ch));
      if (same) return h('span', {}, ch);
      (stack.firstElementChild as HTMLElement).style.position = 'absolute';
      return stack;
    });
    wrap.append(...chars);
    el.textContent = '';
    el.append(wrap);
    window.requestAnimationFrame(() => {
      qsa('.stack', wrap).forEach((s) => {
        (s as HTMLElement).style.transform = 'translateY(-100%)';
      });
      window.setTimeout(() => {
        el.textContent = target;
      }, 180);
    });
  };

  const drawRibbon = (computed: PassageComputed) => {
    const points = [{ pct: state.startChargePct, frac: 0 }];
    const legs = computed.legs;
    legs.forEach((l, i) => {
      points.push({ pct: l.arrivalChargePct, frac: (i + 1) / Math.max(1, legs.length) });
    });
    const W = 800;
    const H = 140;
    const x = (f: number) => 10 + f * (W - 20);
    const y = (p: number) => H - 10 - (p / 100) * (H - 20);
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.frac).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');
    const pts = points.map((p) => `<circle class="pt" cx="${x(p.frac).toFixed(1)}" cy="${y(p.pct).toFixed(1)}" r="3.5"/>`).join('');
    const belowBands = legs.map((l, i) => {
      if (l.reserve !== 'below_reserve') return '';
      const x1 = x(i / Math.max(1, legs.length));
      const x2 = x((i + 1) / Math.max(1, legs.length));
      return `<rect class="hatch on" x="${x1}" y="${y(100)}" width="${(x2 - x1).toFixed(1)}" height="${(y(0) - y(100)).toFixed(1)}"/>`;
    }).join('');
    const svg = `<svg class="ribbon" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs><pattern id="hatchPattern" width="8" height="8" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
        <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(217,131,36,0.35)" stroke-width="2"/>
      </pattern></defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fffcf3"/>
      ${belowBands}
      <line class="reserve-line" x1="0" y1="${y(20)}" x2="${W}" y2="${y(20)}"/>
      <path class="line" d="${path}"/>
      ${pts}
    </svg>`;
    ribbon.outerHTML = svg;
    // Keep a reference to the new ribbon element.
    const fresh = document.querySelector('img.ribbon') as HTMLElement | null;
    if (fresh) {
      // The replaced element is an svg with class ribbon; re-find it.
    }
  };

  const stripState = { index: 0 };
  const positionHairline = () => {
    const count = state.legs.length;
    if (count <= 1) {
      qs('.hairline-track > div', hairline).style.width = '0%';
      return;
    }
    qs('.hairline-track > div', hairline).style.width = `${Math.round((stripState.index / (count - 1)) * 100)}%`;
  };
  const selectLeg = (dir: 1 | -1) => {
    const count = state.legs.length;
    if (count === 0) return;
    const next = Math.max(0, Math.min(count - 1, activeLeg.index + dir));
    activeLeg.index = next;
    positionHairline();
    const cards = [...legsList.children] as HTMLElement[];
    const card = cards[next];
    if (!card) return;
    const slider = card.querySelector('input[type="range"]') as HTMLElement | null;
    (slider ?? card.querySelector('button'))?.focus();
    card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };

  const addLegBtn = h('button', {}, 'Add leg');
  addLegBtn.addEventListener('click', () => {
    openDialog('Add leg', (panel, ctrl) => {
      const options = anchorages.filter((a) => a.id !== currentEndId());
      const sel = h('select', { 'aria-label': 'Arrive at' });
      for (const a of options) {
        sel.append(h('option', { value: a.id }, a.name));
      }
      const errBox = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Add leg');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', () => {
        if (state.legs.length >= 12) {
          errBox.textContent = '';
          errBox.append(h('p', { class: 'msg err' }, 'Use at most 12 legs.'));
          announce('Use at most 12 legs.');
          return;
        }
        const last = state.legs[state.legs.length - 1];
        if (last && last.toAnchorageId === sel.value) {
          errBox.textContent = '';
          errBox.append(h('p', { class: 'msg err' }, 'Choose a different anchorage.'));
          announce('Choose a different anchorage.');
          return;
        }
        if (!last && state.startAnchorageId === sel.value) {
          errBox.textContent = '';
          errBox.append(h('p', { class: 'msg err' }, 'Choose a different anchorage.'));
          announce('Choose a different anchorage.');
          return;
        }
        state.legs.push({ toAnchorageId: sel.value, speedKn: 6 });
        ctrl.close();
        render();
      });
      panel.append(
        h('h2', {}, 'Add leg'),
        h('div', { class: 'field' }, h('label', {}, 'Arrive at'), sel),
        errBox,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  });
  const currentEndId = (): string => state.legs.length === 0 ? state.startAnchorageId : state.legs[state.legs.length - 1].toAnchorageId;

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving passage';
    announce('Saving passage');
    try {
      await api(`/api/w/${ws}/passages/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: state.name,
          startAnchorageId: state.startAnchorageId,
          departureDate: state.departureDate,
          departureTime: state.departureTime,
          startChargePct: state.startChargePct,
          legs: state.legs,
        }),
      });
      const copy = 'Passage saved.';
      message('ok', copy, msgBox);
      announce(copy);
      state.status = 'draft';
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        msgBox.textContent = '';
        msgBox.append(sessionBanner(e));
        return;
      }
      const copy = errorCopy(e);
      message('err', copy.message, msgBox);
      announce(copy.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save passage';
    }
  });

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending to crew';
    announce('Sending to crew');
    try {
      await api(`/api/w/${ws}/passages/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: state.name,
          startAnchorageId: state.startAnchorageId,
          departureDate: state.departureDate,
          departureTime: state.departureTime,
          startChargePct: state.startChargePct,
          legs: state.legs,
        }),
      });
      await api(`/api/w/${ws}/passages/${id}/send`, { method: 'POST' });
      const copy = 'Passage sent to crew.';
      message('ok', copy, msgBox);
      announce(copy);
      state.status = 'sent';
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        msgBox.textContent = '';
        msgBox.append(sessionBanner(e));
        return;
      }
      let copy: string;
      if (e.body && e.body.error === 'below_reserve') copy = 'A leg arrives below the 20% reserve — raise its charge before sending.';
      else if (e.body && e.body.error === 'no_legs') copy = 'Add at least one leg before sending.';
      else copy = errorCopy(e).message;
      message('err', copy, msgBox);
      announce(copy);
    } finally {
      sendBtn.textContent = 'Send to crew';
      render();
    }
  });

  // Leg selection shortcuts: [ and ] from any control of the legs region.
  const region = h('div', { style: 'position:relative' });
  region.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      if (target.getAttribute('type') === 'range') {
        // sliders may use [ and ]
      } else {
        return;
      }
    }
    if (e.key === '[') { e.preventDefault(); selectLeg(-1); }
    if (e.key === ']') { e.preventDefault(); selectLeg(1); }
  });
  // Wheel on the legs strip.
  let lastWheel = 0;
  region.addEventListener('wheel', (e) => {
    if (window.innerWidth < 1024) return;
    const delta = (e as WheelEvent).deltaY;
    if (delta === 0) return;
    const now = performance.now();
    if (now - lastWheel < 360) { e.preventDefault(); return; }
    const count = state.legs.length;
    const next = stripState.index + (delta > 0 ? 1 : -1);
    if (next < 0 || next > count - 1) return;
    e.preventDefault();
    lastWheel = now;
    stripState.index = next;
    positionHairline();
    const cards = [...legsList.children] as HTMLElement[];
    cards[next]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, { passive: false });

  const departureCard = h('div', { class: 'card' },
    h('h2', {}, 'Departure'),
    h('p', { class: 'num' }, `${state.departureDate} ${state.departureTime} ${state.base === 'split' ? 'Split' : 'Lavrio'} time`),
    h('p', { class: 'num' }, `Starting charge ${state.startChargePct}%`),
  );

  const stickyBar = h('div', { class: 'stickybar' }, saveBtn, sendBtn);

  render();

  const content = h('div', {},
    h('h1', {}, state.name),
    msgBox,
    departureCard,
    h('h2', {}, 'Charge ribbon'),
    region,
    updates,
    isCaptain || !isCrew ? addLegBtn : h('span', {}),
    h('div', { class: 'strip-wrap' }, h('div', { class: 'strip cards-col', tabindex: '0' }, legsList)),
    hairline,
    isCrew ? h('span', {}) : stickyBar,
  );
  region.append(ribbon);
  return content;
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}

// Expose the base offset table for the client-side display rules.
import { BASE_OFFSETS } from '../shared/offsets.js';
(window as any).__tzOffsets = BASE_OFFSETS;
