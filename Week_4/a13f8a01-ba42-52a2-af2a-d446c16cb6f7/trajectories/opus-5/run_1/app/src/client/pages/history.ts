import type { DiffResult, Pen, PaneDiff, VersionEntry } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { siteHeader, verifyBanner, watchVerification } from '../components/shell';
import { h, prefersReducedMotion, replace, say, status } from '../dom';
import { formatDate } from '../format';
import { mountPage, splitPage } from '../layout';
import { CROSSFADE_MS, LIFT_MS, PreviewHost, REST_MS } from '../preview';
import { goto, replaceAddress } from '../router';
import { live, me } from '../store';

const PANES = [
  { key: 'html', label: 'HTML changes' },
  { key: 'css', label: 'CSS changes' },
  { key: 'js', label: 'JS changes' },
] as const;

/** A band's height in pixels is 6 plus 4 times the base-2 logarithm of 1 plus its changes. */
const bandHeight = (entry: VersionEntry): number => 6 + 4 * Math.log2(1 + entry.changed_chars);

const askedVersion = (name: string, total: number): number | null => {
  const raw = new URL(window.location.href).searchParams.get(name);
  if (raw === null) return null;
  const match = /^v(\d+)$/.exec(raw);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  return value >= 1 && value <= total ? value : null;
};

const tick = (element: HTMLElement, prefix: string, from: number, to: number): void => {
  if (prefersReducedMotion() || from === to) {
    element.textContent = `${prefix}${to}`;
    return;
  }
  const started = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - started) / CROSSFADE_MS);
    element.textContent = `${prefix}${Math.round(from + (to - from) * progress)}`;
    if (progress < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
};

export const historyPage = async (params: Record<string, string>): Promise<void> => {
  const penId = params.id!;
  const pen = await api.get<Pen>(`/api/pens/${penId}`);
  const versions = (await api.get<{ versions: VersionEntry[] }>(`/api/pens/${penId}/versions`))
    .versions;
  const total = versions.length;

  const { root, stage, column } = splitPage(siteHeader(), 'stage-history');
  const strata = h('div', { class: 'strata' });
  const marker = h('div', {
    role: 'slider',
    'aria-label': 'Core sample',
    'aria-orientation': 'vertical',
    'aria-valuemin': '1',
    'aria-valuemax': String(Math.max(total, 1)),
    tabindex: '0',
    class: 'marker',
  });
  const miniRegion = h('div', { class: 'mini-preview' });
  replace(stage, [miniRegion, h('div', { class: 'strata-holder' }, [strata, marker])]);

  const banner = verifyBanner();
  const historyStatus = status('History status');
  const compare = h('section', { role: 'region', 'aria-label': 'Compare', class: 'compare' });
  const restoreHolder = h('div', { class: 'restore-holder' });

  replace(column, [
    banner,
    compare,
    restoreHolder,
    historyStatus,
    h('a', { href: `/pen/${penId}`, text: 'Back to editor' }),
  ]);
  mountPage(root);
  live([penId], { account: watchVerification(banner) });

  const preview = new PreviewHost({ region: miniRegion, crossfade: true });

  let pinned = askedVersion('a', total) ?? total;
  let shown = askedVersion('b', total) ?? total;
  let position = shown;
  let restTimer = 0;
  const lastCounts: Record<string, { added: number; removed: number }> = {};

  const bands = new Map<number, HTMLElement>();

  const paintStrata = (): void => {
    const heights = versions.map(bandHeight);
    const available = strata.parentElement?.clientHeight ?? 0;
    const sum = heights.reduce((a, b) => a + b, 0);
    const factor = available > 0 && sum > available ? available / sum : 1;
    bands.clear();
    replace(
      strata,
      [...versions].reverse().map((entry, index) => {
        const band = h('div', {
          class: `band band-${index % 2 === 0 ? 'light' : 'dark'}`,
          'data-version': String(entry.number),
        });
        band.style.height = `${heights[versions.length - 1 - index]! * factor}px`;
        band.addEventListener('pointerdown', () => moveTo(entry.number));
        bands.set(entry.number, band);
        return band;
      }),
    );
  };

  const paintMarker = (): void => {
    const entry = versions[position - 1];
    marker.setAttribute('aria-valuenow', String(position));
    if (entry) {
      marker.setAttribute(
        'aria-valuetext',
        copy.sliderValue(entry.number, total, formatDate(entry.created_at), entry.added, entry.removed),
      );
    }
    const reduced = prefersReducedMotion();
    for (const [number, band] of bands) {
      const selected = number === position;
      if (selected) band.dataset.selected = 'true';
      else delete band.dataset.selected;
      if (reduced) {
        band.style.transition = 'none';
        band.style.transform = '';
        band.style.outline = selected ? '2px solid var(--accent)' : 'none';
      } else {
        band.style.transition = `transform ${LIFT_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
        band.style.transform = selected ? 'translateX(12px)' : 'translateX(0)';
        band.style.outline = 'none';
      }
    }
    const band = bands.get(position);
    if (band) {
      const holder = marker.parentElement!.getBoundingClientRect();
      const box = band.getBoundingClientRect();
      marker.style.top = `${box.top - holder.top + box.height / 2}px`;
    }
  };

  /** After the compare column updates, its +N and −N figures count to their new values. */
  const countsLine = (key: string, added: number, removed: number): HTMLElement => {
    const addedText = h('span', { class: 'tabular' });
    const removedText = h('span', { class: 'tabular' });
    const previous = lastCounts[key] ?? { added: 0, removed: 0 };
    tick(addedText, '+', previous.added, added);
    tick(removedText, '−', previous.removed, removed);
    lastCounts[key] = { added, removed };
    return h('p', { class: 'counts' }, [addedText, ' ', removedText]);
  };

  const paintCompare = (diff: DiffResult): void => {
    replace(compare, [
      h('h2', { text: copy.compareHeading(diff.a, diff.b) }),
      countsLine('total', diff.added, diff.removed),
      ...PANES.map((pane) => {
        const paneDiff = diff.panes[pane.key] as PaneDiff;
        return h('section', { role: 'region', 'aria-label': pane.label, class: 'pane-diff' }, [
          h('h3', { text: pane.label }),
          countsLine(pane.key, paneDiff.added, paneDiff.removed),
          h(
            'ul',
            { class: 'diff-rows mono' },
            paneDiff.rows.map((row) =>
              h('li', {
                class: `diff-row diff-${row.change}`,
                'data-change': row.change,
                text: row.text,
              }),
            ),
          ),
        ]);
      }),
    ]);
  };

  const paintRestore = (): void => {
    if (shown === pen.head) {
      replace(restoreHolder, []);
      return;
    }
    const button = h('button', {
      type: 'button',
      class: 'action accent',
      text: `Restore version ${shown}`,
    });
    button.addEventListener('click', () => void restore(shown));
    replace(restoreHolder, [button]);
  };

  const settle = async (): Promise<void> => {
    shown = position;
    replaceAddress(`/pen/${penId}/history?a=v${pinned}&b=v${shown}`);
    paintRestore();
    void preview.show({ penId, version: shown }).catch(() => undefined);
    if (total > 0) {
      const diff = await api.get<DiffResult>(`/api/pens/${penId}/diff?a=${pinned}&b=${shown}`);
      paintCompare(diff);
    }
  };

  /** The preview and the compare column follow only a marker that has rested. */
  const rest = (): void => {
    window.clearTimeout(restTimer);
    restTimer = window.setTimeout(() => void settle(), REST_MS);
  };

  const moveTo = (value: number): void => {
    const next = Math.min(Math.max(value, 1), Math.max(total, 1));
    if (next === position) return;
    position = next;
    paintMarker();
    rest();
  };

  const restore = async (version: number): Promise<void> => {
    try {
      const made = await api.post<{ number: number }>(`/api/pens/${penId}/restore`, {
        version,
        base_version: pen.head,
      });
      const band = h('div', { class: 'band band-light', 'data-version': String(made.number) });
      band.style.height = '0px';
      strata.insertBefore(band, strata.firstChild);
      window.sessionStorage.setItem(
        'ashlar.restored',
        JSON.stringify({ from: version, to: made.number }),
      );
      const target = bandHeight({ ...versions[version - 1]!, number: made.number });
      if (prefersReducedMotion()) {
        band.style.height = `${target}px`;
        goto(`/pen/${penId}`);
        return;
      }
      band.style.transition = `height ${REST_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
      window.requestAnimationFrame(() => {
        band.style.height = `${target}px`;
      });
      window.setTimeout(() => goto(`/pen/${penId}`), REST_MS);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
        say(historyStatus, copy.restoreStorageDown(version));
        return;
      }
      if (error instanceof ApiFailure && error.code === 'unverified') {
        say(historyStatus, copy.unverified(me()?.email ?? ''));
        return;
      }
      throw error;
    }
  };

  marker.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') moveTo(position + 1);
    else if (event.key === 'ArrowDown') moveTo(position - 1);
    else if (event.key === 'Home') moveTo(1);
    else if (event.key === 'End') moveTo(total);
    else if (event.key === 'Enter') {
      pinned = position;
      replaceAddress(`/pen/${penId}/history?a=v${pinned}&b=v${shown}`);
      void settle();
    } else return;
    event.preventDefault();
  });

  marker.addEventListener('pointerdown', (event) => {
    marker.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  marker.addEventListener('pointermove', (event) => {
    if (!marker.hasPointerCapture(event.pointerId)) return;
    for (const [number, band] of bands) {
      const rect = band.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        moveTo(number);
        return;
      }
    }
  });
  marker.addEventListener('pointerup', (event) => marker.releasePointerCapture(event.pointerId));

  paintStrata();
  paintMarker();
  await settle();
};
