import { stageState, deepLinkY, createWebglIris, createSvgIris, segmentHeight, type IrisRenderer, type StageState } from './iris';
import { api, startStatusPolling, formatAmount, fareLabel, type Locale, type ErrorShape } from './common';

const locale: Locale = document.documentElement.lang === 'fr' ? 'fr' : 'en';
const L = locale === 'fr';

function seasonTitle(el: Element): string {
  return (el.querySelector('.season-title') as HTMLElement | null)?.textContent?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// Programme stage: the Iris Pull.
// ---------------------------------------------------------------------------
function setupStage(): void {
  const stageMaybe = document.getElementById('programme-stage');
  if (!stageMaybe) return;
  const stage = stageMaybe;
  document.documentElement.classList.add('js');

  const layers = Array.from(stage.querySelectorAll<HTMLElement>('.season-layer'));
  const tabs = Array.from(stage.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const announcer = document.getElementById('season-announcer');
  const canvas = stage.querySelector('canvas.iris-canvas') as HTMLCanvasElement | null;
  const svg = stage.querySelector('svg.iris-svg') as SVGSVGElement | null;
  const seasonCount = Number(stage.dataset.seasonCount ?? '1');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer: IrisRenderer | null = null as IrisRenderer | null;
  let contextLost = false;
  let usingWebgl = false;

  function switchRenderer(next: IrisRenderer | null, kind: 'webgl' | 'svg', context: 'ok' | 'lost' | 'none'): void {
    if (renderer) renderer.destroy();
    renderer = next;
    stage.dataset.renderer = kind;
    stage.dataset.context = context;
    usingWebgl = kind === 'webgl';
    contextLost = context === 'lost';
  }

  if (canvas) {
    const webgl = createWebglIris(canvas, () => {
      // The context is lost: the SVG iris replaces the canvas at once.
      switchRenderer(svg ? createSvgIris(svg) : null, 'svg', 'lost');
      draw(currentState);
    });
    if (webgl) {
      switchRenderer(webgl, 'webgl', 'ok');
      canvas.addEventListener('webglcontextrestored', () => {
        // Within one second the canvas returns with the current state.
        const restored = createWebglIris(canvas, () => {
          switchRenderer(svg ? createSvgIris(svg) : null, 'svg', 'lost');
          draw(currentState);
        });
        if (restored) {
          switchRenderer(restored, 'webgl', 'ok');
          draw(currentState);
        }
      });
    } else {
      switchRenderer(svg ? createSvgIris(svg) : null, 'svg', 'none');
    }
  } else if (svg) {
    switchRenderer(createSvgIris(svg), 'svg', 'none');
  }

  let currentState: StageState = stageState(0, seasonCount, window.innerWidth, window.innerHeight);
  let activeAnnounced = -1;

  function activateSeason(index: number, announceIt: boolean): void {
    const layer = layers[index];
    if (!layer) return;
    const slug = layer.dataset.seasonSlug ?? '';
    if (document.documentElement.dataset.activeSeason !== slug) {
      document.documentElement.dataset.activeSeason = slug;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('season', slug);
    window.history.replaceState(null, '', url);
    for (const tab of tabs) {
      const selected = tab.dataset.seasonIndex === String(index);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      if (selected) {
        tab.setAttribute('aria-current', 'true');
      } else {
        tab.removeAttribute('aria-current');
      }
    }
    if (announceIt && activeAnnounced !== index) {
      const count = layer.querySelectorAll('.rail-list li').length;
      const title = seasonTitle(layer);
      if (announcer) {
        announcer.textContent = L
          ? `${title} — ${count} ${count === 1 ? 'séance' : 'séances'}`
          : `${title} — ${count} ${count === 1 ? 'screening' : 'screenings'}`;
      }
      activeAnnounced = index;
    }
  }

  function applyLayerVisibility(state: StageState | null, selectedOnly: boolean): void {
    layers.forEach((layer, i) => {
      const isLayerVisible = selectedOnly
        ? i === (state?.segment ?? 0)
        : (i === (state?.segment ?? 0) || i === (state?.segment ?? 0) + 1);
      layer.classList.toggle('layer-active', isLayerVisible);
      if (!selectedOnly && state) {
        const rail = layer.querySelector('.rail') as HTMLElement | null;
        if (rail) rail.style.opacity = String(state.railVisible);
      }
    });
    if (selectedOnly && state) {
      layers.forEach(layer => {
        const rail = layer.querySelector('.rail') as HTMLElement | null;
        if (rail) rail.style.opacity = '';
      });
    }
  }

  function draw(state: StageState): void {
    currentState = state;
    stage.dataset.segment = String(state.segment);
    stage.dataset.irisOpen = state.openness.toFixed(3);
    stage.dataset.irisRotation = state.rotationDegrees.toFixed(1);
    stage.dataset.irisRadius = String(Math.round(state.radiusPx));
    stage.dataset.fstop = state.fstop;
    stage.dataset.railVisible = state.railVisible.toFixed(3);
    stage.dataset.tintMix = state.tintMix.toFixed(3);
    const fstopValue = document.getElementById('fstop-value');
    if (fstopValue) fstopValue.textContent = state.fstop;
    if (renderer) {
      renderer.draw({
        openness: state.openness,
        rotationDegrees: state.rotationDegrees,
        radiusPx: state.radiusPx,
      });
    }
    const index = state.activeIndex;
    const wasActive = document.documentElement.dataset.activeSeason;
    activateSeason(index, document.readyState === 'complete');
    void wasActive;
  }

  function onScroll(): void {
    if (reducedMotion) return;
    const state = stageState(
      window.scrollY,
      seasonCount,
      window.innerWidth,
      window.innerHeight,
    );
    draw(state);
    applyLayerVisibility(state, false);
  }

  // Reduced motion: the selected season fully open, instant tab switching.
  if (reducedMotion) {
    const initialSlug = stage.dataset.initialSeason ?? layers[0]?.dataset.seasonSlug ?? '';
    const initialIndex = Math.max(0, layers.findIndex(l => l.dataset.seasonSlug === initialSlug));
    const diagonal = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
    stage.dataset.segment = String(initialIndex);
    stage.dataset.irisOpen = '1.000';
    stage.dataset.irisRotation = '40.0';
    stage.dataset.irisRadius = String(Math.round(diagonal / 2));
    stage.dataset.fstop = '1.4';
    stage.dataset.railVisible = '1.000';
    stage.dataset.tintMix = '0.000';
    stage.classList.add('reduced-motion');
    applyLayerVisibility(null, true);
    layers.forEach((layer, i) => layer.classList.toggle('layer-selected', i === initialIndex));
    activateSeason(initialIndex, true);
    renderer?.draw({ openness: 1, rotationDegrees: 40, radiusPx: diagonal / 2 });
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const index = Number(tab.dataset.seasonIndex ?? '0');
        layers.forEach((layer, i) => layer.classList.toggle('layer-selected', i === index));
        stage.dataset.segment = String(index);
        activateSeason(index, true);
      });
    }
  } else {
    stage.style.setProperty('--segment-count', String(seasonCount));
    const spacer = stage.querySelector('.stage-spacer') as HTMLElement | null;
    if (spacer) spacer.style.height = `${segmentHeight * seasonCount}px`;

    // Deep link: land at the season's fully open position.
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('season');
    if (slug) {
      const index = layers.findIndex(l => l.dataset.seasonSlug === slug);
      if (index >= 0) {
        window.scrollTo(0, deepLinkY(index));
      }
    }
    applyLayerVisibility(stageState(window.scrollY, seasonCount, window.innerWidth, window.innerHeight), false);
    onScroll();
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    }, { passive: true });

    // Season tabs: keyboard and click, behaving like a deep link.
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const index = Number(tab.dataset.seasonIndex ?? '0');
        window.scrollTo(0, deepLinkY(index));
      });
      tab.addEventListener('keydown', (e: KeyboardEvent) => {
        const idx = tabs.indexOf(tab);
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          tabs[(idx + 1) % tabs.length].focus();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          tabs[(idx - 1 + tabs.length) % tabs.length].focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          tabs[0].focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          tabs[tabs.length - 1].focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const index = Number(tab.dataset.seasonIndex ?? '0');
          window.scrollTo(0, deepLinkY(index));
        }
      });
    }
  }

  // Rail seats-left refresh, every 15 seconds.
  setInterval(async () => {
    const spans = document.querySelectorAll<HTMLElement>('[data-seats-left-for]');
    for (const span of spans) {
      const id = span.dataset.seatsLeftFor ?? '';
      try {
        const data = await api<{ screening: { seats_remaining: number } }>(`/api/screenings/${id}`);
        const remaining = data.screening.seats_remaining;
        span.textContent = remaining === 0
          ? (L ? 'Complet' : 'Sold out')
          : (L ? `${remaining} restantes` : `${remaining} left`);
      } catch {
        // keep the last value
      }
    }
  }, 15000);
}

// ---------------------------------------------------------------------------
// Screening page: the seat map.
// ---------------------------------------------------------------------------
function setupScreening(): void {
  const seatMapMaybe = document.getElementById('seat-map');
  if (!seatMapMaybe) return;
  const seatMap: HTMLElement = seatMapMaybe;
  const screeningId = seatMap.dataset.screeningId ?? '';
  const holdButton = document.getElementById('hold-seats');
  const groupCheckbox = document.getElementById('group-booking') as HTMLInputElement | null;
  const seatsRemaining = document.getElementById('seats-remaining');

  const selected = new Set<string>();

  function seatElements(): HTMLElement[] {
    return Array.from(seatMap.querySelectorAll<HTMLElement>('[role="gridcell"]'));
  }

  function seatOrder(): HTMLElement[] {
    const rows = Array.from(seatMap.querySelectorAll<HTMLElement>('[role="row"]'));
    const out: HTMLElement[] = [];
    for (const row of rows) {
      out.push(...Array.from(row.querySelectorAll<HTMLElement>('[role="gridcell"]')));
    }
    return out;
  }

  let focusedSeat: HTMLElement | null = null;

  seatMap.addEventListener('focus', () => {
    const order = seatOrder();
    if (focusedSeat && focusedSeat.isConnected) {
      focusedSeat.focus();
    } else if (order[0]) {
      order[0].focus();
    }
  });

  seatMap.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (!target.matches('[role="gridcell"]')) return;
    const order = seatOrder();
    const index = order.indexOf(target);
    const perRow = seatMap.querySelector('[role="row"]')?.querySelectorAll('[role="gridcell"]').length ?? 1;
    const rowStart = Math.floor(index / perRow) * perRow;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      order[Math.min(index + 1, rowStart + perRow - 1)]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      order[Math.max(index - 1, rowStart)]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      order[Math.min(index + perRow, order.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      order[Math.max(index - perRow, 0)]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      order[rowStart]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      order[rowStart + perRow - 1]?.focus();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleSeat(target);
    }
  });

  seatMap.addEventListener('click', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('[role="gridcell"]') as HTMLElement | null;
    if (target) toggleSeat(target);
  });

  seatMap.addEventListener('focusin', (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.matches('[role="gridcell"]')) focusedSeat = target;
  });

  function toggleSeat(cell: HTMLElement): void {
    if (cell.getAttribute('aria-disabled') === 'true') return;
    const seat = cell.dataset.seat ?? '';
    const isSelected = cell.getAttribute('aria-selected') === 'true';
    if (isSelected) {
      selected.delete(seat);
      cell.setAttribute('aria-selected', 'false');
    } else {
      selected.add(seat);
      cell.setAttribute('aria-selected', 'true');
    }
  }

  async function refreshSeatMap(): Promise<void> {
    try {
      const data = await api<{ screening: { seats_remaining: number; seats: { code: string; state: string }[] } }>(
        `/api/screenings/${screeningId}`,
      );
      const bySeat = new Map(data.screening.seats.map(s => [s.code, s.state]));
      for (const cell of seatElements()) {
        const seat = cell.dataset.seat ?? '';
        const state = bySeat.get(seat) ?? 'available';
        const mine = state === 'mine' || selected.has(seat);
        cell.classList.toggle('seat-available', state === 'available' && !mine);
        cell.classList.toggle('seat-mine', mine);
        cell.classList.toggle('seat-held', state === 'held');
        cell.classList.toggle('seat-sold', state === 'sold');
        cell.setAttribute('aria-disabled', state === 'sold' || state === 'held' ? 'true' : 'false');
        cell.setAttribute('aria-selected', mine ? 'true' : 'false');
      }
      if (seatsRemaining) {
        const remaining = data.screening.seats_remaining;
        seatsRemaining.textContent = remaining === 0
          ? (L ? 'Complet' : 'Sold out')
          : (L ? `${remaining} restantes` : `${remaining} left`);
      }
    } catch {
      // keep the last rendering
    }
  }

  setInterval(refreshSeatMap, 5000);

  if (holdButton) {
    holdButton.addEventListener('click', async () => {
      const errorLine = document.getElementById('booking-error');
      const statusLine = document.getElementById('booking-status');
      const seats = Array.from(selected);
      if (seats.length === 0) {
        if (errorLine) errorLine.textContent = L ? 'Choisissez de 1 à 10 places.' : 'Choose 1 to 10 seats.';
        return;
      }
      holdButton.setAttribute('disabled', 'disabled');
      holdButton.textContent = L ? 'En cours…' : 'Working…';
      if (statusLine) statusLine.textContent = L ? 'En cours…' : 'Working…';
      try {
        const body = {
          screening_id: screeningId,
          seats,
          group: groupCheckbox?.checked === true,
        };
        const data = await api<{ hold: { id: string } }>('/api/holds', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (statusLine) statusLine.textContent = L
          ? 'Places retenues. Terminez le paiement avant la fin du minuteur.'
          : 'Seats held. Complete checkout before the timer ends.';
        window.location.href = `/${locale}/checkout/${data.hold.id}`;
      } catch (err) {
        const e = err as Error & { payload?: ErrorShape };
        if (errorLine && e.payload?.error?.message) errorLine.textContent = e.payload.error.message;
        holdButton.removeAttribute('disabled');
        holdButton.textContent = L ? 'Retenir les places' : 'Hold seats';
        void refreshSeatMap();
        if (e.payload?.error?.code === 'seat_taken') {
          for (const seat of (e.payload.error as unknown as { seats?: string[] }).seats ?? []) {
            selected.delete(seat);
            const cell = seatMap.querySelector(`[data-seat="${seat}"]`);
            cell?.setAttribute('aria-selected', 'false');
            cell?.classList.add('seat-sold');
            cell?.setAttribute('aria-disabled', 'true');
          }
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Every page: status polling and the language switch.
// ---------------------------------------------------------------------------
function setupLanguageSwitch(): void {
  const button = document.querySelector<HTMLAnchorElement>('.language-button');
  if (!button) return;
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    const other: Locale = locale === 'en' ? 'fr' : 'en';
    const scrollY = window.scrollY;
    const activeElement = document.activeElement as HTMLElement | null;
    const activeId = activeElement?.id ?? null;

    // Typed values and selections are captured, then restored.
    const fieldValues = new Map<string, string>();
    const checkedFields = new Map<string, boolean>();
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea, select'))) {
      if (input.id && input.type !== 'password') {
        fieldValues.set(input.id, input.value);
        checkedFields.set(input.id, input.checked);
      }
    }
    const selectedSeats = new Set(
      Array.from(document.querySelectorAll('[role="gridcell"][aria-selected="true"]'))
        .map(el => (el as HTMLElement).dataset.seat ?? ''),
    );

    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Halide-Locale': other },
      body: JSON.stringify({ locale: other }),
    }).catch(() => undefined);

    // Fetch the same page under the other locale prefix.
    const path = window.location.pathname.replace(/^\/(en|fr)/, `/${other}`);
    const url = path + window.location.search;
    const res = await fetch(url, { headers: { 'X-Halide-Locale': other } });
    if (res.ok) {
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'text/html');
      document.documentElement.lang = other;
      document.title = doc.title;

      // Swap the header and main regions in place.
      const newHeader = doc.querySelector('header.site-header');
      const oldHeader = document.querySelector('header.site-header');
      if (newHeader && oldHeader) oldHeader.replaceWith(newHeader);
      const newMain = doc.querySelector('main');
      const oldMain = document.querySelector('main');
      if (newMain && oldMain) oldMain.replaceWith(newMain);

      window.history.replaceState(null, '', url);
      window.scrollTo(0, scrollY);

      // Restore typed values.
      for (const [id, value] of fieldValues) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
          el.value = value;
          el.checked = checkedFields.get(id) ?? false;
        }
      }
      for (const seat of selectedSeats) {
        const cell = document.querySelector(`[data-seat="${seat}"]`);
        cell?.setAttribute('aria-selected', 'true');
      }
      if (activeId) {
        const el = document.getElementById(activeId);
        el?.focus();
      }
      // Re-run the page setup under the new locale.
      void boot();
    } else {
      window.location.href = button.href;
    }
  });
}

function setupMenuToggle(): void {
  const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    nav.hidden = expanded;
  });
}

function setupFilmNotes(): void {
  const toggle = document.getElementById('film-notes-toggle');
  const region = document.getElementById('film-notes-region');
  if (!toggle || !region) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    region.hidden = expanded;
  });
}

function boot(): void {
  setupStage();
  setupScreening();
  setupLanguageSwitch();
  setupMenuToggle();
  setupFilmNotes();
}

boot();
startStatusPolling(down => {
  document.body.classList.toggle('billing-down', down);
});

export {};
