import { api, state, el, clear, serverClock, durationText, dateKeyKitchen, addDaysKey, longDateFromKey } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';

// The owner's daily usage report: isometric bars above its tables, redrawn in
// place every 10 seconds, following the URL's date.

interface ReportJson {
  date: string; timeZone: string; totalBookedMinutes: number;
  stations: Array<{ stationId: string; stationName: string; bookedMinutes: number; bookingCount: number }>;
  tenants: Array<{ tenantId: string; businessName: string; bookedMinutes: number; bookingCount: number; noShowCount: number }>;
}

let zone = 'UTC';

export function renderReport(app: HTMLElement, url: URL): () => void {
  const timers: number[] = [];
  let destroyed = false;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;
    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    let date = url.searchParams.get('date');
    const todayOf = () => dateKeyKitchen(serverClock.now(), zone);
    if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      date = todayOf();
      const fixed = new URL(location.href);
      fixed.searchParams.set('date', date);
      history.replaceState(null, '', fixed.toString());
    }

    const wrap = el('div', { class: 'report-wrap' });
    const dateGroup = el('div', { role: 'group', 'aria-label': 'Kitchen date', class: 'date-group' });
    const dateText = el('span', { class: 'date-text' }, longDateFromKey(date, zone));
    const prev = el('button', { class: 'btn btn-ghost' }, 'Previous day');
    const next = el('button', { class: 'btn btn-ghost' }, 'Next day');
    const today = el('button', { class: 'btn btn-ghost' }, 'Today');
    const pendingCopy = el('span', { class: 'pending-copy', hidden: '' }, 'Loading report…');
    dateGroup.append(prev, next, today, dateText, pendingCopy);

    const figure = el('figure', { 'aria-label': 'Usage by station', class: 'usage-figure' });
    const stationTable = el('table', { 'aria-label': 'Usage by station', class: 'report-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Station'), el('th', {}, 'Booked'), el('th', {}, 'Bookings')))) as HTMLTableElement;
    const stationBody = el('tbody', {});
    stationTable.appendChild(stationBody);
    const tenantTable = el('table', { 'aria-label': 'Usage by tenant', class: 'report-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Business'), el('th', {}, 'Booked'), el('th', {}, 'Bookings'), el('th', {}, 'No-shows')))) as HTMLTableElement;
    const tenantBody = el('tbody', {});
    tenantTable.appendChild(tenantBody);
    const totalLine = el('p', { class: 'report-total' }, 'Total booked 0 min');

    app.append(el('h1', { class: 'screen-heading' }, 'Daily usage'), dateGroup, wrap);
    wrap.append(figure, stationTable, tenantTable, totalLine);

    let lastTotal = -1;
    let lastDate: string | null = null;
    let loading = false;

    const setDate = (newDate: string, push: boolean) => {
      date = newDate;
      lastDate = null;
      lastTotal = -1;
      dateText.textContent = longDateFromKey(date, zone);
      const fixed = new URL(location.href);
      fixed.searchParams.set('date', date);
      if (push) history.pushState(null, '', fixed.toString());
      else history.replaceState(null, '', fixed.toString());
      void load();
    };

    prev.addEventListener('click', () => setDate(addDaysKey(date!, zone, -1), true));
    next.addEventListener('click', () => setDate(addDaysKey(date!, zone, 1), true));
    today.addEventListener('click', () => setDate(todayOf(), true));

    const load = async (periodic = false) => {
      if (loading) return;
      loading = true;
      if (!periodic) pendingCopy.hidden = false;
      const r = await api('GET', `/api/reports/daily?date=${date}`);
      loading = false;
      pendingCopy.hidden = true;
      if (destroyed || r.status !== 200 || !r.ok) return;
      if (r.sentUnder !== state.sessionId) return;
      const data = r.ok as ReportJson;
      if (data.date !== date) return;
      serverClock.update(new Date(Date.now()).toISOString(), zone);
      draw(data, periodic);
    };

    const draw = (data: ReportJson, periodic: boolean) => {
      clear(figure);
      const max = Math.max(...data.stations.map((s) => s.bookedMinutes), 0);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const width = 100 + data.stations.length * 70;
      const height = 280;
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('class', 'usage-svg');
      const descriptions = data.stations.map((s) => `${s.stationName}: ${durationText(s.bookedMinutes)}`).join('; ');
      figure.setAttribute('aria-description', descriptions);

      // A shared hairline floor line.
      const floor = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      floor.setAttribute('x1', '0');
      floor.setAttribute('x2', String(width));
      floor.setAttribute('y1', '220');
      floor.setAttribute('y2', '220');
      floor.setAttribute('class', 'usage-floor');
      svg.appendChild(floor);

      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      data.stations.forEach((s, index) => {
        const heightUnits = max === 0 ? 0 : Math.ceil((160 * s.bookedMinutes) / max - 0.0001 + 0) || 0;
        const raw = max === 0 ? 0 : (160 * s.bookedMinutes) / max;
        const h = max === 0 ? 0 : Math.floor(raw + 0.5);
        void heightUnits;
        const x = 40 + index * 70;
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-station-id', s.stationId);
        group.setAttribute('data-minutes', String(s.bookedMinutes));
        group.setAttribute('data-height', String(h));
        const barW = 40;
        const barD = 16;
        const topY = 220 - h;
        const top = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        top.setAttribute('points', `${x},${topY} ${x + barD},${topY - barD / 2} ${x + barD + barW},${topY} ${x + barW},${topY + barD / 2}`);
        const left = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        left.setAttribute('points', `${x},${topY} ${x + barW},${topY + barD / 2} ${x + barW},220 ${x},220`);
        const right = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        right.setAttribute('points', `${x + barW},${topY + barD / 2} ${x + barW + barD},${topY} ${x + barW + barD},220 ${x + barW},220`);
        top.classList.add('face-top');
        left.classList.add('face-left');
        right.classList.add('face-right');
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(x + barW / 2));
        label.setAttribute('y', '245');
        label.setAttribute('text-anchor', 'middle');
        label.textContent = s.stationName;
        label.classList.add('station-label');
        group.append(top, left, right, label);
        svg.appendChild(group);
        if (!reduce && !periodic) {
          group.animate(
            [{ transform: 'translateY(160px)', opacity: '0.2' }, { transform: 'translateY(0)', opacity: '1' }],
            { duration: 600, delay: index * 40, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'both' },
          );
        }
      });
      figure.appendChild(svg);

      clear(stationBody);
      for (const s of data.stations) {
        stationBody.appendChild(el('tr', {},
          el('td', {}, s.stationName),
          el('td', {}, durationText(s.bookedMinutes)),
          el('td', {}, String(s.bookingCount)),
        ));
      }
      clear(tenantBody);
      for (const t of data.tenants) {
        tenantBody.appendChild(el('tr', {},
          el('td', {}, t.businessName),
          el('td', {}, durationText(t.bookedMinutes)),
          el('td', {}, String(t.bookingCount)),
          el('td', {}, String(t.noShowCount)),
        ));
      }
      totalLine.textContent = `Total booked ${durationText(data.totalBookedMinutes)}`;

      if (!periodic && lastDate !== data.date) {
        announce(`Daily usage for ${longDateFromKey(data.date, zone)}: Total booked ${durationText(data.totalBookedMinutes)}.`);
        lastDate = data.date;
        lastTotal = data.totalBookedMinutes;
      } else if (periodic && lastTotal !== -1 && lastTotal !== data.totalBookedMinutes) {
        announce(`Daily usage for ${longDateFromKey(data.date, zone)} updated: Total booked ${durationText(data.totalBookedMinutes)}.`);
        lastTotal = data.totalBookedMinutes;
      }
    };

    await load(false);
    timers.push(window.setInterval(() => { void load(true); }, 10_000));
    return () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };
  };

  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}
