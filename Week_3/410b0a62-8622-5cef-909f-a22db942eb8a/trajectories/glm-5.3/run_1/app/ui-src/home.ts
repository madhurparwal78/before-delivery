import { api, type HomePayload, type ItemJson, type WeekJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h, clear, prefersReducedMotion } from './dom.js';
import { fmtForm, fmtTss, fmtDuration, dataAttr, dayLabel, mondayLabel } from './format.js';
import { COMPLIANCE_LABELS } from './domain.js';
import { onLiveChange } from './main.js';
import { openLogSession } from './log-session.js';
import { openThresholdForm } from './thresholds.js';

export async function renderHome(main: HTMLElement, ctx: AppCtx, athleteId: string, week: string | null): Promise<void> {
  const me = ctx.me;
  if (!me) {
    window.location.href = '/sign-in';
    return;
  }
  const targetId = athleteId === '' ? me.id : athleteId;
  const params = new URLSearchParams();
  if (week) params.set('week', week);
  params.set('before', '4');
  params.set('after', '4');
  const query = params.toString();
  let payload: HomePayload;
  try {
    payload = await api.get<HomePayload>(`/athletes/${targetId}/home?${query}`);
  } catch {
    main.append(notFoundView());
    return;
  }

  const container = h('div', { class: 'page home' });
  main.append(container);
  drawHome(container, ctx, payload, targetId, week);

  onLiveChange((msg) => {
    if (msg.athlete_id !== targetId) return;
    void api
      .get<HomePayload>(`/athletes/${targetId}/home?${query}`)
      .then((fresh) => {
        clear(container);
        drawHome(container, ctx, fresh, targetId, week);
      })
      .catch(() => {
        clear(container);
        container.append(notFoundView());
      });
  });
}

function notFoundView(): HTMLElement {
  return h(
    'section',
    { class: 'notfound' },
    h('h1', { class: 'display' }, 'Not found'),
    h('p', {}, "This page isn't available to you."),
    h('a', { class: 'pill pill-primary', href: '/' }, 'Back to home')
  );
}

function drawHome(container: HTMLElement, ctx: AppCtx, payload: HomePayload, athleteId: string, weekParam: string | null): void {
  const today = payload.today;
  const bannerDay = payload.banner;
  const banner = h(
    'section',
    { class: 'today-band', role: 'region', 'aria-label': 'Today' },
    h(
      'div',
      { class: 'band-inner' },
      h(
        'div',
        { class: 'band-copy' },
        h(
          'p',
          {
            class: 'band-form display',
            'data-tsb': bannerDay ? dataAttr(bannerDay.tsb, 1) : '0.0',
          },
          `Form ${bannerDay ? fmtForm(bannerDay.tsb) : '0.0'}.`
        ),
        h(
          'p',
          {
            class: 'band-detail',
            'data-ctl': bannerDay ? dataAttr(bannerDay.ctl, 1) : '0.0',
            'data-atl': bannerDay ? dataAttr(bannerDay.atl, 1) : '0.0',
          },
          `Fitness ${bannerDay ? fmtTss(bannerDay.ctl) : '0.0'} · fatigue ${bannerDay ? fmtTss(bannerDay.atl) : '0.0'} coming into today`
        ),
        h(
          'div',
          { class: 'band-actions' },
          h('button', { class: 'pill pill-navy', onclick: () => void openLogSession(ctx, athleteId, today) }, 'Log a session'),
          h(
            'a',
            { class: 'pill pill-navy', href: `/athletes/${athleteId}/builder?date=${today}` },
            'Plan a workout'
          )
        )
      ),
      h('div', { class: 'band-shape shape-1' }),
      h('div', { class: 'band-shape shape-2' }),
      h('div', { class: 'band-shape shape-3' }),
      h('div', { class: 'band-shape shape-4' })
    )
  );

  const chartCard = buildChartCard(payload);
  const rail = buildRail(ctx, payload, athleteId, weekParam);
  const libraryPanel = buildLibrary(ctx, athleteId, payload);
  const tiles = buildTiles(payload);
  const rings = buildRings(payload);
  const driftWall = buildDriftWall(payload);
  const countdown = buildCountdown(payload, today);
  const thresholds = h('section', { class: 'section thresholds-card' });
  openThresholdForm(thresholds, ctx, athleteId, payload.thresholds);
  const footer = buildFooter(ctx);

  container.append(banner, chartCard, rail.node, libraryPanel, tiles, rings, driftWall, countdown, thresholds, copyWeekSection(ctx, payload, athleteId, weekParam), footer);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add('risen');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.2 }
  );
  for (const node of Array.from(container.querySelectorAll('.section, .ring-row'))) {
    if (!prefersReducedMotion()) observer.observe(node);
  }
  rail.init();
}

// --------------------------------------------------------------------- chart

function buildChartCard(payload: HomePayload): HTMLElement {
  const days = payload.series;
  const readout = h('div', { class: 'chart-readout', role: 'status', id: 'chart-readout' });
  const focusDate = days.length > 0 ? days[days.length - 1]!.date : payload.today;

  const group = h(
    'div',
    {
      class: 'chart-card',
      role: 'group',
      'aria-label': 'Fitness chart',
      tabindex: '0',
      'data-focus-date': focusDate,
      'data-animating': 'false',
      'data-animation-ms': String(animationMs()),
    },
    h('h2', { class: 'section-title' }, 'Fitness')
  );

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('preserveAspectRatio', 'none');

  const band = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  band.setAttribute('class', 'chart-band');
  band.setAttribute('data-week', payload.weeks.find((w) => isCentered(w, payload.today))?.week ?? '');
  svg.append(band);

  const fitnessLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  fitnessLine.setAttribute('class', 'chart-line ctl');
  const fatigueLine = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  fatigueLine.setAttribute('class', 'chart-line atl');
  svg.append(fitnessLine, fatigueLine);

  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  marker.setAttribute('class', 'chart-marker');
  svg.append(marker);

  group.append(svg);

  const table = h('table', { class: 'chart-table', role: 'table', 'aria-label': 'Fitness table' });
  const thead = h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'TSS'), h('th', {}, 'Fitness'), h('th', {}, 'Fatigue'), h('th', {}, 'Form')));
  const tbody = h('tbody', {});
  table.append(thead, tbody);
  group.append(readout, table);

  const draw = (animate: boolean): void => {
    if (prefersReducedMotion()) {
      group.setAttribute('data-animation-ms', '0');
      group.setAttribute('data-animating', 'false');
      drawChart(group, svg, fitnessLine, fatigueLine, marker, band, days, focusDate, payload);
    } else if (animate && animationMs() > 0) {
      group.setAttribute('data-animating', 'true');
      drawChart(group, svg, fitnessLine, fatigueLine, marker, band, days, focusDate, payload);
      window.setTimeout(() => {
        group.setAttribute('data-animating', 'false');
      }, animationMs());
    } else {
      group.setAttribute('data-animating', 'false');
      drawChart(group, svg, fitnessLine, fatigueLine, marker, band, days, focusDate, payload);
    }
    for (const day of days) {
      const row = h(
        'tr',
        {
          'data-date': day.date,
          'data-tss': dataAttr(day.tss, 1),
          'data-ctl': dataAttr(day.ctl, 1),
          'data-atl': dataAttr(day.atl, 1),
          'data-tsb': dataAttr(day.tsb, 1),
        },
        h('td', {}, dayLabel(day.date, true)),
        h('td', {}, fmtTss(day.tss)),
        h('td', {}, fmtTss(day.ctl)),
        h('td', {}, fmtTss(day.atl)),
        h('td', {}, fmtForm(day.tsb))
      );
      tbody.append(row);
    }
  };
  draw(false);

  group.addEventListener('keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const current = days.findIndex((d) => d.date === group.getAttribute('data-focus-date'));
    let next = current;
    if (key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (key === 'ArrowRight') next = Math.min(days.length - 1, current + 1);
    else if (key === 'Home') next = 0;
    else if (key === 'End') next = days.length - 1;
    else return;
    event.preventDefault();
    if (next === current || next < 0 || days.length === 0) return;
    const day = days[next]!;
    group.setAttribute('data-focus-date', day.date);
    updateMarker(marker, days, day.date);
    const readoutNode = group.querySelector<HTMLElement>('#chart-readout');
    if (readoutNode) {
      readoutNode.textContent = `${dayLabel(day.date, true)}: ${fmtTss(day.tss)} TSS, fitness ${fmtTss(day.ctl)}, fatigue ${fmtTss(day.atl)}, form ${fmtForm(day.tsb)}`;
    }
  });

  return h('div', { class: 'section chart-wrap' }, group);
}

function isCentered(week: WeekJson, today: string): boolean {
  return week.days.some((d) => d.date === today);
}

/** The configured chart animation duration, read from the chart element itself. */
function animationMs(): number {
  const group = document.querySelector<HTMLElement>('.chart-card');
  const parsed = group === null ? NaN : Number(group.getAttribute('data-animation-ms'));
  if (prefersReducedMotion()) return 0;
  return Number.isFinite(parsed) ? parsed : 450;
}

function drawChart(
  group: HTMLElement,
  svg: SVGSVGElement,
  fitnessLine: SVGElement,
  fatigueLine: SVGElement,
  marker: SVGElement,
  band: SVGElement,
  days: HomePayload['series'],
  focusDate: string,
  payload: HomePayload
): void {
  const width = 1200;
  const height = 220;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (days.length === 0) {
    fitnessLine.setAttribute('points', '');
    fatigueLine.setAttribute('points', '');
    return;
  }
  const maxCtl = Math.max(...days.map((d) => d.ctl), 1);
  const maxAtl = Math.max(...days.map((d) => d.atl), 1);
  const maxVal = Math.max(maxCtl, maxAtl) * 1.1;
  const x = (i: number): number => (i / Math.max(1, days.length - 1)) * width;
  const y = (v: number): number => height - (v / maxVal) * height;

  const ctlPoints = days.map((d, i) => `${x(i).toFixed(1)},${y(d.ctl).toFixed(1)}`).join(' ');
  const atlPoints = days.map((d, i) => `${x(i).toFixed(1)},${y(d.atl).toFixed(1)}`).join(' ');
  fitnessLine.setAttribute('points', ctlPoints);
  fatigueLine.setAttribute('points', atlPoints);

  const centeredWeek = payload.weeks.find((w) => isCentered(w, payload.today));
  if (centeredWeek) {
    const startIdx = days.findIndex((d) => d.date === centeredWeek.monday);
    const startI = startIdx < 0 ? 0 : startIdx;
    const endIdx = days.findIndex((d) => d.date === addLocal(centeredWeek.monday, 6));
    const endI = endIdx < 0 ? days.length - 1 : endIdx;
    const x1 = x(startI);
    const x2 = x(endI);
    band.setAttribute('x', String(x1));
    band.setAttribute('width', String(Math.max(2, x2 - x1)));
    band.setAttribute('y', '0');
    band.setAttribute('height', String(height));
    band.setAttribute('data-week', centeredWeek.week);
  }

  for (const point of Array.from(svg.querySelectorAll('.chart-point'))) point.remove();
  days.forEach((d, i) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('class', 'chart-point');
    circle.setAttribute('cx', String(x(i)));
    circle.setAttribute('cy', String(y(d.ctl)));
    circle.setAttribute('r', '2');
    circle.setAttribute('data-date', d.date);
    circle.setAttribute('data-ctl', String(d.ctl));
    circle.setAttribute('data-atl', String(d.atl));
    circle.setAttribute('data-tsb', String(d.tsb));
    svg.append(circle);
  });
  updateMarker(marker, days, focusDate);
  group.setAttribute('data-focus-date', focusDate);
}

function updateMarker(marker: SVGElement, days: HomePayload['series'], focusDate: string): void {
  const idx = days.findIndex((d) => d.date === focusDate);
  if (idx < 0) {
    marker.setAttribute('x1', '0');
    marker.setAttribute('x2', '0');
    return;
  }
  const x = (idx / Math.max(1, days.length - 1)) * 1200;
  marker.setAttribute('x1', String(x));
  marker.setAttribute('x2', String(x));
  marker.setAttribute('y1', '0');
  marker.setAttribute('y2', '220');
}

function addLocal(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// --------------------------------------------------------------------- rail

function buildRail(ctx: AppCtx, payload: HomePayload, athleteId: string, weekParam: string | null): { node: HTMLElement; init: () => void } {
  const weeks = [...payload.weeks].sort(byMonday);
  const centerWeek = weekParam ?? weeks.find((w) => isCentered(w, payload.today))?.week ?? weeks[Math.floor(weeks.length / 2)]?.week ?? '';
  const announcements = h('div', { class: 'sr-only', role: 'status', id: 'week-announcements' });
  const calendarAnnouncements = h('div', { class: 'sr-only', role: 'status', id: 'calendar-announcements' });

  const region = h(
    'section',
    {
      class: 'week-rail section',
      role: 'region',
      'aria-label': 'Week rail',
      tabindex: '0',
      'data-week': centerWeek,
      'data-moving': 'false',
    },
    announcements,
    calendarAnnouncements
  );

  let centerIndex = Math.max(0, weeks.findIndex((w) => w.week === centerWeek));
  const track = h('div', { class: 'rail-track' });
  const dots = h('div', { class: 'rail-dots' });
  const prev = h('button', { class: 'pill rail-arrow', 'aria-label': 'Previous week' }, '‹');
  const next = h('button', { class: 'pill rail-arrow', 'aria-label': 'Next week' }, '›');
  const loadEarlier = h('button', { class: 'pill rail-load', 'aria-label': 'Load earlier weeks' }, 'Load earlier weeks');
  const loadLater = h('button', { class: 'pill rail-load', 'aria-label': 'Load later weeks' }, 'Load later weeks');

  const controls = h('div', { class: 'rail-controls' }, prev, dots, next);
  region.append(track, controls, loadEarlier, loadLater);

  let loadedWeeks = weeks;

  function draw(): void {
    clear(track);
    clear(dots);
    for (const [i, week] of loadedWeeks.entries()) {
      const tile = weekTile(ctx, athleteId, week, payload.today, i === centerIndex);
      track.append(tile);
      const dot = h('button', {
        class: 'rail-dot',
        'aria-label': `Week of ${mondayLabel(week.monday)}`,
        onclick: () => moveTo(i),
      });
      if (i === centerIndex) dot.setAttribute('aria-current', 'true');
      dots.append(dot);
    }
    region.setAttribute('data-week', loadedWeeks[centerIndex]?.week ?? '');
    prev.disabled = centerIndex === 0;
    next.disabled = centerIndex === loadedWeeks.length - 1;
    announce(`Week of ${mondayLabel(loadedWeeks[centerIndex]?.monday ?? '')}: planned ${fmtTss(loadedWeeks[centerIndex]?.planned_tss ?? 0)}, completed ${fmtTss(loadedWeeks[centerIndex]?.completed_tss ?? 0)}, form ${fmtForm(loadedWeeks[centerIndex]?.tsb ?? 0)}`);
    updateAddress(loadedWeeks[centerIndex]?.week ?? '');
  }

  function moveTo(index: number): void {
    if (index < 0 || index >= loadedWeeks.length || index === centerIndex) return;
    centerIndex = index;
    if (prefersReducedMotion()) {
      draw();
      scrollToCenter(false);
    } else {
      region.setAttribute('data-moving', 'true');
      draw();
      scrollToCenter(true);
      window.setTimeout(() => {
        region.setAttribute('data-moving', 'false');
      }, 420);
    }
  }

  /** Scrolls the track so the centred week sits in the middle of the rail. */
  function scrollToCenter(smooth: boolean): void {
    const tile = track.children[centerIndex] as HTMLElement | undefined;
    if (!tile) return;
    tile.scrollIntoView({
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
      inline: 'center',
      block: 'nearest',
    });
  }

  function announce(text: string): void {
    const node = region.querySelector<HTMLElement>('#week-announcements');
    if (node) node.textContent = text;
  }

  function updateAddress(week: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set('week', week);
    window.history.replaceState({}, '', url.toString());
  }

  prev.addEventListener('click', () => moveTo(centerIndex - 1));
  next.addEventListener('click', () => moveTo(centerIndex + 1));
  loadEarlier.addEventListener('click', () => {
    const first = loadedWeeks[0];
    if (!first) return;
    const extra = [1, 2, 3, 4].map((i) => shiftWeek(first, -i)).reverse();
    loadedWeeks = [...extra.map((monday) => syntheticWeek(monday)), ...loadedWeeks];
    centerIndex += extra.length;
    draw();
  });
  loadLater.addEventListener('click', () => {
    const last = loadedWeeks[loadedWeeks.length - 1];
    if (!last) return;
    const extra = [1, 2, 3, 4].map((i) => shiftWeek(last, i));
    loadedWeeks = [...loadedWeeks, ...extra.map((monday) => syntheticWeek(monday))];
    draw();
  });
  region.addEventListener('keydown', (event) => {
    // Week keys act only when the rail region itself holds focus, so they do
    // not intercept keys meant for controls inside it.
    if (event.target !== region) return;
    const key = (event as KeyboardEvent).key;
    if (key === 'ArrowLeft') moveTo(centerIndex - 1);
    if (key === 'ArrowRight') moveTo(centerIndex + 1);
  });

  // Horizontal swipe longer than 40px moves the rail by one week.
  let swipeStartX: number | null = null;
  region.addEventListener(
    'pointerdown',
    (event) => {
      if ((event as PointerEvent).pointerType !== 'touch') return;
      swipeStartX = (event as PointerEvent).clientX;
    },
    { passive: true }
  );
  region.addEventListener(
    'pointerup',
    (event) => {
      if (swipeStartX === null) return;
      const dx = (event as PointerEvent).clientX - swipeStartX;
      swipeStartX = null;
      if (dx > 40) moveTo(centerIndex - 1);
      else if (dx < -40) moveTo(centerIndex + 1);
    },
    { passive: true }
  );

  function syntheticWeek(monday: string): WeekJson {
    return {
      week: weekOf(monday),
      monday,
      planned_tss: 0,
      completed_tss: 0,
      tsb: null,
      tally: { 'on-target': 0, close: 0, 'off-target': 0, missed: 0, unplanned: 0, planned: 0 },
      sports: { bike_tss: 0, run_tss: 0, bike_s: 0, run_s: 0, sessions: 0 },
      days: Array.from({ length: 7 }, (_, i) => ({ date: addLocal(monday, i), items: [] })),
    };
  }

  function shiftWeek(week: WeekJson, offset: number): string {
    return addLocal(week.monday, offset * 7);
  }

  function weekOf(monday: string): string {
    const [y, m, d] = monday.split('-').map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    const dayNum = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
    const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const week = Math.ceil(((dt.getTime() - jan4.getTime()) / 86400000 + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  draw();

  return {
    node: region,
    init: () => {
      scrollToCenter(false);
    },
  };
}

function byMonday(a: WeekJson, b: WeekJson): number {
  return a.monday < b.monday ? -1 : a.monday > b.monday ? 1 : 0;
}

function weekTile(ctx: AppCtx, athleteId: string, week: WeekJson, today: string, active: boolean): HTMLElement {
  const tally = week.tally;
  const attrs: Record<string, string> = {
    'data-week': week.week,
    'data-active': active ? 'true' : 'false',
    'data-planned-tss': dataAttr(week.planned_tss, 1),
    'data-completed-tss': dataAttr(week.completed_tss, 1),
    'data-tsb': week.tsb === null ? '0.0' : dataAttr(week.tsb, 1),
    'data-count-on-target': String(tally['on-target'] ?? 0),
    'data-count-close': String(tally.close ?? 0),
    'data-count-off-target': String(tally['off-target'] ?? 0),
    'data-count-missed': String(tally.missed ?? 0),
    'data-count-unplanned': String(tally.unplanned ?? 0),
    'data-count-planned': String(tally.planned ?? 0),
  };
  const chipRow = h('div', { class: 'day-chips' });
  for (const day of week.days) {
    const chip = dayChip(ctx, athleteId, day.date, today, day.items);
    chipRow.append(chip);
  }
  return h(
    'div',
    { class: active ? 'week-tile active' : 'week-tile', role: 'group', 'aria-label': `Week of ${mondayLabel(week.monday)}`, ...attrs },
    h('p', { class: 'week-monday display' }, mondayLabel(week.monday)),
    h('p', { class: 'week-totals' }, `Planned ${fmtTss(week.planned_tss)} TSS · Completed ${fmtTss(week.completed_tss)} TSS · Form ${week.tsb === null ? '0.0' : fmtForm(week.tsb)}`),
    h(
      'p',
      { class: 'week-tally' },
      `On target ${tally['on-target'] ?? 0} · Close ${tally.close ?? 0} · Off target ${tally['off-target'] ?? 0} · Missed ${tally.missed ?? 0} · Unplanned ${tally.unplanned ?? 0} · Planned ${tally.planned ?? 0}`
    ),
    chipRow
  );
}

function dayChip(ctx: AppCtx, athleteId: string, date: string, today: string, items: ItemJson[]): HTMLElement {
  const list = h('ul', { class: 'day-items' });
  for (const item of items) {
    list.append(calendarItem(item));
  }
  const isToday = date === today;
  return h(
    'div',
    {
      class: isToday ? 'day-chip today' : 'day-chip',
      role: 'group',
      'aria-label': dayLabel(date),
      'data-date': date,
    },
    h(
      'div',
      { class: 'day-chip-head' },
      h('span', { class: 'day-name' }, dayLabel(date)),
      h('span', { class: 'day-actions' },
        h('button', {
          class: 'pill pill-mini',
          onclick: () => void openLogSession(ctx, athleteId, date),
        }, `Log session on ${dayLabel(date)}`),
        h('a', { class: 'pill pill-mini', href: `/athletes/${athleteId}/builder?date=${date}` }, `Plan on ${dayLabel(date)}`)
      )
    ),
    list
  );
}

function calendarItem(item: ItemJson): HTMLElement {
  const title = item.planned?.title ?? item.completed?.title ?? '';
  const detailId = item.completed?.id ?? item.planned?.id ?? '';
  const li = h('li', {
    class: 'calendar-item',
    'data-compliance': item.compliance,
    'data-planned-tss': item.planned?.planned_tss === undefined ? '0' : dataAttr(item.planned.planned_tss ?? 0, 1),
    'data-completed-tss': item.completed?.tss === undefined ? '0' : dataAttr(item.completed.tss ?? 0, 1),
    'data-tss': item.completed?.tss === undefined ? '0' : dataAttr(item.completed.tss ?? 0, 1),
    'data-duration-s': String(item.planned?.duration_s ?? item.completed?.duration_s ?? 0),
    'data-sport': item.planned?.sport ?? item.completed?.sport ?? 'bike',
  });
  const strip = h('span', { class: `item-strip ${item.compliance}` });
  const link = h('a', { class: 'item-link', href: `/workouts/${detailId}` }, title);
  li.append(strip, link);
  if (item.planned !== null && item.completed === null) {
    const label = item.planned.title ?? '';
    li.append(
      h('button', {
        class: 'pill pill-mini move-button',
        'aria-label': `Move ${label}`,
        onclick: (event: Event) => beginKeyboardMove(event, item),
      }, 'Move')
    );
  }
  li.append(h('span', { class: 'item-state' }, COMPLIANCE_LABELS[item.compliance] ?? ''));
  return li;
}

function beginKeyboardMove(event: Event, item: ItemJson): void {
  const button = event.currentTarget as HTMLElement;
  const chip = button.closest('.day-chip') as HTMLElement | null;
  if (!chip || !item.planned) return;
  const region = chip.closest('.week-rail') as HTMLElement | null;
  if (!region) return;
  const chips = Array.from(region.querySelectorAll<HTMLElement>('.day-chip'));
  let current = chips.indexOf(chip);
  const announceNode = region.querySelector<HTMLElement>('#calendar-announcements');
  const workout = item.planned;
  const setAnnounce = (text: string): void => {
    if (announceNode) announceNode.textContent = text;
  };
  setAnnounce(`Picked up ${workout.title}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`);

  const onKey = (keyEvent: Event): void => {
    const ke = keyEvent as KeyboardEvent;
    if (ke.key === 'ArrowLeft' && current > 0) {
      current -= 1;
      setAnnounce(dayLabel(chips[current]!.dataset.date ?? ''));
      ke.preventDefault();
    } else if (ke.key === 'ArrowRight' && current < chips.length - 1) {
      current += 1;
      setAnnounce(dayLabel(chips[current]!.dataset.date ?? ''));
      ke.preventDefault();
    } else if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      const targetDate = chips[current]!.dataset.date ?? '';
      void api
        .patch(`/workouts/${workout.id}`, { version: workout.version, date: targetDate })
        .then(() => {
          setAnnounce(`Moved ${workout.title} to ${dayLabel(targetDate)}.`);
          window.location.reload();
        })
        .catch((err: unknown) => {
          setAnnounce((err as Error).message);
        });
      button.removeEventListener('keydown', onKey);
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      setAnnounce(`Move of ${workout.title} cancelled.`);
      button.removeEventListener('keydown', onKey);
    }
  };
  button.addEventListener('keydown', onKey);
  button.focus();
}

// --------------------------------------------------------------------- tiles

function buildTiles(payload: HomePayload): HTMLElement {
  const centered = payload.weeks.find((w) => isCentered(w, payload.today)) ?? payload.weeks[0];
  const sports = centered?.sports ?? { bike_tss: 0, run_tss: 0, bike_s: 0, run_s: 0, sessions: 0 };
  const tiles = [
    { label: 'Bike stress', value: fmtTss(sports.bike_tss), attr: dataAttr(sports.bike_tss, 1) },
    { label: 'Run stress', value: fmtTss(sports.run_tss), attr: dataAttr(sports.run_tss, 1) },
    { label: 'Bike time', value: fmtDuration(sports.bike_s), attr: String(Math.round(sports.bike_s)) },
    { label: 'Run time', value: fmtDuration(sports.run_s), attr: String(Math.round(sports.run_s)) },
    { label: 'Sessions', value: String(sports.sessions), attr: String(sports.sessions) },
  ];
  return h(
    'section',
    { class: 'section tiles' },
    ...tiles.map((tile) =>
      h(
        'div',
        { class: 'tile', role: 'group', 'aria-label': tile.label, 'data-value': tile.attr },
        h('p', { class: 'tile-label' }, tile.label),
        h('p', { class: 'tile-value display' }, tile.value)
      )
    )
  );
}

function buildRings(payload: HomePayload): HTMLElement {
  const names = ['This week', 'Last 4 weeks', 'Last 12 weeks'];
  return h(
    'section',
    { class: 'section rings' },
    ...payload.rings.map((ring, i) => {
      const percent = ring.percent;
      const label = names[i] ?? '';
      const text = percent === null ? 'No planned sessions' : `${percent}% on target`;
      const circumference = 2 * Math.PI * 34;
      const offset = percent === null ? circumference : circumference * (1 - percent / 100);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ring-svg');
      svg.setAttribute('viewBox', '0 0 80 80');
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bg.setAttribute('cx', '40');
      bg.setAttribute('cy', '40');
      bg.setAttribute('r', '34');
      bg.setAttribute('class', 'ring-bg');
      const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fg.setAttribute('cx', '40');
      fg.setAttribute('cy', '40');
      fg.setAttribute('r', '34');
      fg.setAttribute('class', 'ring-fg');
      fg.setAttribute('stroke-dasharray', String(circumference));
      fg.setAttribute('stroke-dashoffset', String(offset));
      svg.append(bg, fg);
      return h(
        'div',
        { class: 'ring-row', role: 'group', 'aria-label': label, 'data-percent': percent === null ? '' : String(percent) },
        svg,
        h('div', { class: 'ring-copy' }, h('p', { class: 'ring-label' }, label), h('p', { class: 'ring-value display' }, text))
      );
    })
  );
}

function buildDriftWall(payload: HomePayload): HTMLElement {
  const recent = payload.recent;
  const region = h('section', { class: 'section drift-wall', role: 'region', 'aria-label': 'Recent uploads' });
  if (recent.length === 0) {
    region.append(h('p', { class: 'empty-line display' }, 'No sessions yet'));
    return region;
  }
  const row1 = h('div', { class: 'drift-row drift-row-1' });
  const row2 = h('div', { class: 'drift-row drift-row-2' });
  recent.forEach((session, i) => {
    const tile = h(
      'div',
      { class: 'drift-tile' },
      h('span', { class: 'drift-title' }, session.title),
      h('span', { class: 'drift-meta' }, `${dayLabel(session.date)} · ${fmtTss(session.tss ?? 0)} TSS`)
    );
    (i % 2 === 0 ? row1 : row2).append(tile);
  });
  region.append(row1, row2);
  if (!prefersReducedMotion()) {
    let ticking = false;
    const update = (): void => {
      const rect = region.getBoundingClientRect();
      const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
      const shift = Math.max(-30, Math.min(30, (progress - 0.5) * 60));
      row1.style.transform = `translateX(${shift}px)`;
      row2.style.transform = `translateX(${-shift}px)`;
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
  }
  return region;
}

function buildCountdown(payload: HomePayload, today: string): HTMLElement {
  const event = payload.event;
  let text = 'No event on the calendar';
  let days = 0;
  if (event) {
    const diff = daysBetween(today, event.date);
    days = diff;
    if (diff === 0) text = `Race day: ${event.name}`;
    else if (diff === 1) text = `1 day to ${event.name}`;
    else text = `${diff} days to ${event.name}`;
  }
  return h(
    'section',
    { class: 'section countdown-band', role: 'region', 'aria-label': 'Next event', 'data-days': String(days) },
    h('p', { class: 'countdown-text display' }, text)
  );
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const first = Date.UTC(ay!, am! - 1, ad!) / 86400000;
  const second = Date.UTC(by!, bm! - 1, bd!) / 86400000;
  return Math.round(second - first);
}

/** The Copy week section, shown to coaches viewing a linked athlete. */
function copyWeekSection(ctx: AppCtx, payload: HomePayload, athleteId: string, weekParam: string | null): HTMLElement {
  const section = h('section', { class: 'section copy-week' });
  if (ctx.me === null || ctx.me.role !== 'coach') return section;
  const weeks = [...payload.weeks].sort((a, b) => (a.monday < b.monday ? -1 : 1));
  const sourceWeek = weekParam ?? weeks.find((w) => isCentered(w, payload.today))?.week ?? weeks[0]?.week ?? '';
  const planned = weeks
    .find((w) => w.week === sourceWeek)
    ?.days.flatMap((d) => d.items.map((item) => ({ day: d.date, item })))
    .filter((entry) => entry.item.planned !== null) ?? [];

  const button = h('button', { class: 'pill pill-primary' }, 'Copy week');
  section.append(button);
  button.addEventListener('click', () => {
    openCopyWeekDialog(ctx, payload, athleteId, sourceWeek, planned);
  });
  return section;
}

function openCopyWeekDialog(
  ctx: AppCtx,
  payload: HomePayload,
  athleteId: string,
  sourceWeek: string,
  planned: { day: string; item: ItemJson }[]
): void {
  document.getElementById('copy-week-dialog')?.remove();
  const list = h('div', { class: 'copy-list' });
  const boxes: { id: string; checkbox: HTMLInputElement }[] = [];
  for (const entry of planned) {
    const workout = entry.item.planned!;
    const checkbox = h('input', { type: 'checkbox' }) as HTMLInputElement;
    checkbox.checked = true;
    boxes.push({ id: workout.id, checkbox });
    list.append(h('label', { class: 'copy-item' }, checkbox, `${workout.title} · ${dayLabel(entry.day)}`));
  }

  const athleteSelect = h('select', { class: 'field', 'aria-label': 'Copy to athlete' }) as HTMLSelectElement;
  for (const athlete of ctx.athletes.filter((a) => a.id !== athleteId)) {
    athleteSelect.append(h('option', { value: athlete.id }, athlete.name));
  }
  const targetWeek = h('input', { class: 'field', type: 'text', value: nextWeek(sourceWeek), 'aria-label': 'Target week' }) as HTMLInputElement;
  const copyButton = h('button', { class: 'pill pill-primary' }, 'Copy workouts');
  const cancelButton = h('button', { class: 'pill pill-ghost' }, 'Cancel');
  const selectAll = h('button', { class: 'pill pill-secondary' }, 'Select all');
  const status = h('div', { class: 'dialog-status', role: 'status', id: 'copy-status' });

  const dialog = h(
    'div',
    { class: 'dialog', id: 'copy-week-dialog', role: 'dialog', 'aria-label': 'Copy week' },
    h('h2', { class: 'dialog-title' }, 'Copy week'),
    list,
    selectAll,
    h('label', { class: 'field-label', for: 'copy-athlete' }, 'Copy to athlete'),
    athleteSelect,
    h('label', { class: 'field-label', for: 'copy-week' }, 'Target week'),
    targetWeek,
    h('div', { class: 'dialog-actions' }, copyButton, cancelButton),
    status
  );
  document.body.append(dialog);
  const first = dialog.querySelector<HTMLElement>('.copy-item input, button');
  first?.focus();

  selectAll.addEventListener('click', () => {
    for (const box of boxes) box.checkbox.checked = true;
  });
  cancelButton.addEventListener('click', () => dialog.remove());
  dialog.addEventListener('keydown', (event) => {
    const ke = event as KeyboardEvent;
    if (ke.key === 'Escape') {
      dialog.remove();
      return;
    }
    if (ke.key === 'Tab') {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('input:not([type=hidden]), select, button'));
      if (focusable.length === 0) return;
      const firstEl = focusable[0]!;
      const lastEl = focusable[focusable.length - 1]!;
      if (ke.shiftKey && document.activeElement === firstEl) {
        ke.preventDefault();
        lastEl.focus();
      } else if (!ke.shiftKey && document.activeElement === lastEl) {
        ke.preventDefault();
        firstEl.focus();
      }
    }
  });

  copyButton.addEventListener('click', async () => {
    const chosen = boxes.filter((b) => b.checkbox.checked).map((b) => b.id);
    if (chosen.length === 0) {
      status.textContent = 'Choose planned workouts from that week.';
      return;
    }
    copyButton.disabled = true;
    copyButton.textContent = 'Copying…';
    try {
      const res = await api.post<{ created: number; skipped: number }>(`/athletes/${athleteId}/copy-week`, {
        week: sourceWeek,
        workout_ids: chosen,
        to_athlete_id: athleteSelect.value,
        to_week: targetWeek.value.trim(),
      });
      const word = res.created === 1 ? 'workout' : 'workouts';
      const name = ctx.athletes.find((a) => a.id === athleteSelect.value)?.name ?? '';
      status.textContent = `Copied ${res.created} ${word} to ${name}. Skipped ${res.skipped} on days that have already passed.`;
      copyButton.disabled = false;
      copyButton.textContent = 'Copy workouts';
      window.setTimeout(() => dialog.remove(), 900);
    } catch (err) {
      copyButton.disabled = false;
      copyButton.textContent = 'Copy workouts';
      status.textContent = (err as Error).message;
    }
  });
  void payload;
}

/** The ISO week following `week`. */
function nextWeek(week: string): string {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = Date.UTC(y!, 0, 4) / 1000;
  const jan4Weekday = (new Date(jan4 * 1000).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4Weekday * 86400;
  const mondayEpoch = week1Monday + ((w ?? 1) - 1) * 7 * 86400;
  const nextMonday = new Date((mondayEpoch + 7 * 86400) * 1000);
  const yy = nextMonday.getUTCFullYear();
  const thursday = new Date(nextMonday.getTime() + 3 * 86400000);
  const j4 = Date.UTC(thursday.getUTCFullYear(), 0, 4) / 1000;
  const j4w = (new Date(j4 * 1000).getUTCDay() + 6) % 7;
  const w1 = j4 - j4w * 86400;
  const weekNumber = Math.floor((thursday.getTime() / 1000 - w1) / (7 * 86400)) + 1;
  return `${yy}-W${String(weekNumber).padStart(2, '0')}`;
}

function buildLibrary(ctx: AppCtx, athleteId: string, payload: HomePayload): HTMLElement {
  const region = h('section', { class: 'section workout-library', role: 'region', 'aria-label': 'Workout library' });
  const list = h('ul', { class: 'library-list' });
  region.append(h('h2', { class: 'section-title' }, 'Workout library'), list);

  void api
    .get<{ library: { id: string; name: string; duration_s: number; planned_tss: number }[] }>('/library')
    .then((res) => {
      for (const item of res.library) {
        const placeButton = h(
          'button',
          {
            class: 'pill pill-secondary',
            'aria-label': `Place ${item.name}`,
          },
          'Place'
        );
        placeButton.addEventListener('click', () => {
          beginPlace(placeButton, athleteId, item.id, item.name, payload);
        });
        list.append(
          h(
            'li',
            { class: 'library-item' },
            h('span', { class: 'library-name' }, `${item.name} · ${fmtDuration(item.duration_s)} · ${fmtTss(item.planned_tss)} TSS`),
            placeButton
          )
        );
      }
    })
    .catch(() => {
      list.append(h('li', { class: 'library-item' }, 'No saved workouts yet.'));
    });
  void ctx;
  return region;
}

function beginPlace(button: HTMLElement, athleteId: string, libraryId: string, name: string, payload: HomePayload): void {
  const rail = button.closest('.week-rail');
  const chips = rail
    ? Array.from(rail.querySelectorAll<HTMLElement>('.day-chip'))
    : Array.from(document.querySelectorAll<HTMLElement>('.day-chip'));
  if (chips.length === 0) return;
  let current = chips.findIndex((c) => c.dataset.date === payload.today);
  if (current < 0) current = 0;
  const announceNode = document.getElementById('calendar-announcements');
  const setAnnounce = (text: string): void => {
    if (announceNode) announceNode.textContent = text;
  };
  setAnnounce(`Picked up ${name}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`);
  const onKeyDown = (keyEvent: Event): void => {
    const ke = keyEvent as KeyboardEvent;
    if (ke.key === 'ArrowLeft' && current > 0) {
      current -= 1;
      ke.preventDefault();
      setAnnounce(dayLabel(chips[current]?.dataset.date ?? ''));
    } else if (ke.key === 'ArrowRight' && current < chips.length - 1) {
      current += 1;
      ke.preventDefault();
      setAnnounce(dayLabel(chips[current]?.dataset.date ?? ''));
    } else if (ke.key === 'Enter' || ke.key === ' ') {
      ke.preventDefault();
      button.removeEventListener('keydown', onKeyDown);
      const targetDate = chips[current]?.dataset.date ?? '';
      void api
        .post(`/athletes/${athleteId}/workouts`, { date: targetDate, library_id: libraryId })
        .then(() => {
          setAnnounce(`Placed ${name} on ${dayLabel(targetDate)}.`);
          window.location.reload();
        })
        .catch((err: unknown) => {
          setAnnounce((err as Error).message);
        });
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      button.removeEventListener('keydown', onKeyDown);
      setAnnounce(`Move of ${name} cancelled.`);
    }
  };
  button.addEventListener('keydown', onKeyDown);
  button.focus();
}

function buildFooter(ctx: AppCtx): HTMLElement {
  const codeField = h('input', { class: 'field footer-field', type: 'text', 'aria-label': 'Coach code' }) as HTMLInputElement;
  const send = h('button', { class: 'pill pill-accent' }, 'Send request');
  const status = h('p', { class: 'footer-status' });
  const formWrap = h(
    'form',
    {
      class: 'coach-code-form',
      onsubmit: async (event: Event) => {
        event.preventDefault();
        send.disabled = true;
        send.textContent = 'Sending…';
        try {
          const res = await api.post<{ link: { coach_name: string } }>('/links', { coach_code: codeField.value.trim() });
          formWrap.replaceWith(
            h('p', { class: 'footer-status' }, `Request sent to ${res.link.coach_name}. They'll appear under Coaches once they accept.`)
          );
        } catch (err) {
          send.disabled = false;
          send.textContent = 'Send request';
          status.textContent = (err as Error).message;
        }
      },
    },
    codeField,
    send,
    status
  );

  const coachCode = ctx.me?.coach_code ?? null;
  return h(
    'footer',
    { class: 'site-footer', role: 'contentinfo' },
    h('p', { class: 'footer-brand' }, 'Tempoline'),
    coachCode !== null ? h('p', { class: 'footer-code' }, `Your coach code: ${coachCode}`) : null,
    coachCode === null ? formWrap : null,
    h('p', { class: 'footer-note' }, `Signed in as ${ctx.me?.name ?? ''}`)
  );
}
