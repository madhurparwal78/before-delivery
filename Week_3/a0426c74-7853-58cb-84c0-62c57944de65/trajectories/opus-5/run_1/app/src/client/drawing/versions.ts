import type { CompareResult } from '../../shared/compare.js';
import { compareCountsText } from '../../shared/compare.js';
import { historyLine } from '../../shared/transitions.js';
import type { VersionSnapshot } from '../../shared/snapshot.js';
import { sheetSvg } from '../../shared/svgtext.js';
import { api, RequestFailed } from '../api.js';
import { button, clear, el, on, reducedMotion } from '../dom.js';
import { store } from '../store.js';
import { toast } from '../toasts.js';

export interface VersionPayload {
  id: string;
  sheet_id: string;
  number: number;
  state: string;
  replaced_by: number | null;
  replaced_text: string | null;
  stamps: string[];
  steps?: { role: string; state: string; due_at: string | null }[];
  snapshot: VersionSnapshot;
}

export interface VersionsHooks {
  refresh(): void;
  restore(versionId: string): void;
  openCompare(earlier?: number, later?: number): void;
}

async function versionsOf(sheetId: string): Promise<VersionPayload[]> {
  const response = await api.get<{ versions: VersionPayload[] }>(`/api/sheets/${sheetId}/versions`);
  return response.versions;
}

function reviewButtons(version: VersionPayload, hooks: VersionsHooks): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const start = button('Start review');
  on(start, 'click', () => {
    void api
      .post(`/api/versions/${version.id}/review`, {})
      .then(() => hooks.refresh())
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });
  nodes.push(start);
  for (const action of ['Approve', 'Reject'] as const) {
    const node = button(action);
    on(node, 'click', () => {
      const steps = version.steps ?? [];
      const pending = steps.find((step) => step.state === 'pending');
      const role = pending ? pending.role : store.role === 'manage' ? 'manage' : 'markup';
      void api
        .post(`/api/versions/${version.id}/review/${role}/${action.toLowerCase()}`, { comment: action })
        .then(() => hooks.refresh())
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) {
            toast(error.body.message);
            const area = document.querySelector('[data-review-message]');
            if (area) area.textContent = error.body.message;
          }
        });
    });
    nodes.push(node);
  }
  const restore = button('Restore this version');
  on(restore, 'click', () => hooks.restore(version.id));
  nodes.push(restore);
  const link = button('Create view link');
  on(link, 'click', () => {
    void api
      .post<{ id: string; url: string }>(`/api/versions/${version.id}/links`, {})
      .then((created) => {
        store.links.push({ id: created.id, url: created.url, version_id: version.id });
        toast(`View link ready: ${created.url}`);
        hooks.refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });
  nodes.push(link);
  const off = button('Turn off link');
  on(off, 'click', () => {
    const existing = store.links.find((candidate) => candidate.version_id === version.id);
    if (!existing) {
      toast('No link to turn off.');
      return;
    }
    void api
      .remove(`/api/links/${existing.id}`)
      .then(() => {
        store.links = store.links.filter((candidate) => candidate.id !== existing.id);
        hooks.refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof RequestFailed) toast(error.body.message);
      });
  });
  nodes.push(off);
  return nodes;
}

/** region Versions: the version list, its review stamp and the review step controls. */
export function versionsPanel(hooks: VersionsHooks, fixedVersionId?: string): HTMLElement {
  const wrapper = el('div', { class: 'versions' });
  let drawToken = 0;

  const draw = async (): Promise<void> => {
    const token = (drawToken += 1);
    const sheets = store.sheets;
    const panels: HTMLElement[] = [el('p', { 'data-review-message': '', class: 'review-message' })];
    for (const sheet of sheets) {
      const list = el('ul', { role: 'list', 'aria-label': `Versions of ${sheet.name}`, class: 'version-list' });
      const versions = await versionsOf(sheet.id);
      if (token !== drawToken) return;
      for (const version of versions) {
        if (fixedVersionId && version.id !== fixedVersionId) continue;
        const item = el('li', { 'data-version': version.id, 'data-version-number': String(version.number), 'data-state': version.state }, [
          el('span', {}, [`${sheet.name} v${version.number}`]),
          el('span', { class: 'version-state' }, [version.state]),
        ]);
        for (const stamp of version.stamps) item.append(el('p', { class: 'stamp', 'data-stamp': stamp }, [stamp]));
        if (version.replaced_text) item.append(el('p', { class: 'replaced' }, [version.replaced_text]));
        for (const node of reviewButtons(version, hooks)) item.append(node);
        list.append(item);
      }
      if (versions.length === 0) list.append(el('li', { class: 'empty' }, ['No versions yet.']));
      panels.push(el('h3', {}, [sheet.name]), list);
    }
    if (token !== drawToken) return;
    clear(wrapper);
    for (const node of panels) wrapper.append(node);
  };

  store.on((event) => {
    if (event.kind === 'versions' || event.kind === 'model') void draw();
  });
  void draw();
  return wrapper;
}

export interface CompareHooks {
  sheetId: string;
  versions: { id: string; number: number }[];
}

/** Delta swipe: two versions, a keyboard-operable divider and an overlay switch. */
export function compareView(hooks: CompareHooks): HTMLElement {
  const wrapper = el('section', { class: 'compare', 'aria-label': 'Delta swipe' });
  const earlier = el('select', { 'aria-label': 'Earlier version' });
  const later = el('select', { 'aria-label': 'Later version' });
  const sorted = [...hooks.versions].sort((a, b) => a.number - b.number);
  for (const version of sorted) {
    earlier.append(el('option', { value: String(version.number) }, [`v${version.number}`]));
    later.append(el('option', { value: String(version.number) }, [`v${version.number}`]));
  }
  if (sorted.length >= 2) {
    earlier.value = String(sorted[sorted.length - 2].number);
    later.value = String(sorted[sorted.length - 1].number);
  } else if (sorted.length === 1) {
    earlier.value = String(sorted[0].number);
    later.value = String(sorted[0].number);
  }
  const counts = el('div', { role: 'status', 'aria-label': 'Compare counts', 'aria-live': 'polite' });
  const slider = el('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    value: '50',
    'aria-label': 'Compare swipe',
  });
  const overlay = el('button', { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Overlay' }, ['Overlay']);
  const divider = el('div', { 'data-swipe-divider': '', class: 'swipe-divider' });
  const stage = el('div', { class: 'compare-stage' });
  const history = el('div', { role: 'region', 'aria-label': 'Entity history', class: 'entity-history' });

  let diff: CompareResult | null = null;

  const applyDiff = (): void => {
    if (!diff) return;
    const states = new Map(diff.entities.map((entry) => [entry.id, entry.diff]));
    for (const node of stage.querySelectorAll<SVGElement>('[data-entity-id]')) {
      const id = node.getAttribute('data-entity-id') ?? '';
      const state = states.get(id);
      if (state) node.setAttribute('data-diff', state);
    }
  };

  const place = (): void => {
    const percent = Number(slider.value);
    slider.setAttribute('aria-valuetext', `${percent}% newer version`);
    divider.style.left = `${percent}%`;
    const laterLayer = stage.querySelector<HTMLElement>('[data-compare-layer="later"]');
    const earlierLayer = stage.querySelector<HTMLElement>('[data-compare-layer="earlier"]');
    const hidden = overlay.getAttribute('aria-checked') === 'true';
    divider.hidden = hidden;
    if (laterLayer) laterLayer.style.clipPath = hidden ? 'none' : `inset(0 ${100 - percent}% 0 0)`;
    if (earlierLayer) earlierLayer.style.clipPath = hidden ? 'none' : `inset(0 0 0 ${percent}%)`;
  };

  const load = async (): Promise<void> => {
    const from = Number(earlier.value);
    const to = Number(later.value);
    const result = await api.get<CompareResult>(`/api/sheets/${hooks.sheetId}/compare?from=${from}&to=${to}`);
    diff = result;
    counts.textContent = compareCountsText(result);
    const versions = await api.get<{ versions: VersionPayload[] }>(`/api/sheets/${hooks.sheetId}/versions`);
    const earlierVersion = versions.versions.find((version) => version.number === from);
    const laterVersion = versions.versions.find((version) => version.number === to);
    clear(stage);
    if (laterVersion) {
      const layer = el('div', { 'data-compare-layer': 'later', class: 'compare-layer' });
      layer.innerHTML = sheetSvg(laterVersion.snapshot);
      stage.append(layer);
    }
    if (earlierVersion) {
      const layer = el('div', { 'data-compare-layer': 'earlier', class: 'compare-layer' });
      layer.innerHTML = sheetSvg(earlierVersion.snapshot);
      stage.append(layer);
    }
    stage.append(divider);
    applyDiff();
    place();
  };

  const moveSlider = (next: number): void => {
    const from = Number(slider.value);
    slider.value = String(Math.max(0, Math.min(100, next)));
    place();
    if (!reducedMotion()) {
      divider.animate(
        [{ transform: `translateX(${(from - Number(slider.value)) * 0.01 * stage.clientWidth}px)` }, { transform: 'translateX(0)' }],
        { duration: 120, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', id: 'compare-swipe' },
      );
    }
  };

  on(slider, 'keydown', (event: KeyboardEvent) => {
    const current = Number(slider.value);
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 };
    if (event.key in steps) {
      event.preventDefault();
      moveSlider(current + steps[event.key]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      moveSlider(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      moveSlider(100);
    }
  });
  on(slider, 'input', () => place());
  on(overlay, 'click', () => {
    const on1 = overlay.getAttribute('aria-checked') === 'true';
    overlay.setAttribute('aria-checked', on1 ? 'false' : 'true');
    place();
  });
  on(earlier, 'change', () => void load());
  on(later, 'change', () => void load());
  on(stage, 'click', (event: MouseEvent) => {
    const node = (event.target as HTMLElement).closest('[data-entity-id]');
    if (!node) return;
    void showHistory(node.getAttribute('data-entity-id') ?? '');
  });
  on(stage, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    const node = (event.target as HTMLElement).closest('[data-entity-id]');
    if (!node) return;
    void showHistory(node.getAttribute('data-entity-id') ?? '');
  });

  const showHistory = async (handle: string): Promise<void> => {
    clear(history);
    const response = await api.get<{ history: { revision: number; username: string; command: string; at: string }[] }>(
      `/api/drawings/${store.id}/entities/${encodeURIComponent(handle)}/history`,
    );
    const list = el('ul', { role: 'list' });
    for (const entry of response.history) {
      list.append(el('li', {}, [historyLine(entry.username, entry.command, new Date(entry.at))]));
    }
    history.append(list);
  };

  wrapper.append(earlier, later, counts, slider, overlay, stage, history);
  void load();
  return wrapper;
}
