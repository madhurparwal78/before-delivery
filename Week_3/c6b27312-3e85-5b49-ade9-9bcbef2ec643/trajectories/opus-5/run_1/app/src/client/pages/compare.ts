import {
  ApiCallError,
  CompareResponse,
  Pose,
  RevisionResponse,
  Solid,
  send,
} from '../api';
import { all, clear, el, find, on } from '../dom';
import { Viewport } from '../viewport';
import { openLiveStream, showStorageBanner } from '../ui';
import { volumeMm3 } from '../../shared/numbers';
import { parameterChangeLine } from '../values';
import { bodyHeight, opMesh } from '../mesh';

type View = 'overlay' | 'added' | 'removed' | 'swipe';
const VIEWS: View[] = ['overlay', 'added', 'removed', 'swipe'];
const VIEW_LABELS: Record<View, string> = {
  overlay: 'Overlay',
  added: 'Added',
  removed: 'Removed',
  swipe: 'Swipe',
};

export async function mountCompare(host: HTMLElement): Promise<void> {
  const slug = host.dataset.slug ?? '';
  const revisionsAnswer = await send<{ revisions: RevisionResponse[] }>(
    `/api/parts/${slug}/revisions`,
  );
  let revisions = revisionsAnswer.data.revisions;
  const authorAnswer = await send<{ owner: { displayName: string } }>(`/api/parts/${slug}`);
  const authorName = authorAnswer.data.owner.displayName;

  const heading = el('h1', {}, ['Compare revisions']);
  const leader = find('[data-ui="dimension-leader"]');
  if (leader) heading.append(leader);

  const baseMenu = el('select', { 'aria-label': 'Base revision', class: 'enum-select' });
  const headMenu = el('select', { 'aria-label': 'Head revision', class: 'enum-select' });
  const viewGroup = el('div', { role: 'radiogroup', 'aria-label': 'View', class: 'radio-row' });
  const swipe = el('div', {
    role: 'slider',
    'aria-label': 'Swipe divider',
    tabindex: '0',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '50',
    class: 'swipe-slider',
    hidden: true,
  });
  const volumeRegion = el('section', {
    role: 'region',
    'aria-label': 'Volume change',
    class: 'volume-change',
  });
  const hunkList = el('ul', { role: 'list', 'aria-label': 'Hunks', class: 'hunk-list' });
  const changeList = el('ul', {
    role: 'list',
    'aria-label': 'Parameter changes',
    class: 'change-list',
  });
  const activity = el('p', { role: 'status', 'aria-label': 'Part activity', class: 'status-line' });

  const viewport = new Viewport({ epochKey: `tinework:epoch:compare:${slug}`, fallbackAlt: 'Compare' });

  const viewButtons = VIEWS.map((view) => {
    const button = el(
      'button',
      { type: 'button', role: 'radio', 'aria-checked': 'false', class: 'radio-option', 'data-view': view },
      [VIEW_LABELS[view]],
    );
    on(button, 'click', () => setView(view, true));
    on(button, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      const index = VIEWS.indexOf(view);
      if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowDown') {
        keyboard.preventDefault();
        setView(VIEWS[(index + 1) % VIEWS.length], true);
      } else if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowUp') {
        keyboard.preventDefault();
        setView(VIEWS[(index - 1 + VIEWS.length) % VIEWS.length], true);
      }
    });
    viewGroup.append(button);
    return button;
  });

  host.append(
    el('div', { class: 'compare-head' }, [heading]),
    el('div', { class: 'compare-tools' }, [baseMenu, headMenu, viewGroup, swipe]),
    el('div', { class: 'compare-layout' }, [
      el('div', { class: 'compare-main' }, []),
      el('div', { class: 'compare-side' }, [volumeRegion, hunkList, changeList, activity]),
    ]),
  );
  const main = find<HTMLElement>('.compare-main', host)!;
  viewport.mount(main);

  let base = '';
  let head = '';
  let view: View = 'overlay';
  let selectedHunk: number | null = null;
  let result: CompareResponse | null = null;
  let inflight: AbortController | null = null;
  let painted = 0;

  function paintMenus(): void {
    for (const [menu, selected] of [
      [baseMenu, base],
      [headMenu, head],
    ] as [HTMLSelectElement, string][]) {
      clear(menu);
      for (const revision of revisions) {
        menu.append(
          el('option', { value: revision.id }, [
            `${revision.label} · ${revision.message} · ${authorName}`,
          ]),
        );
      }
      menu.value = selected;
    }
  }

  function labelOf(id: string): string {
    return revisions.find((revision) => revision.id === id)?.label ?? '';
  }

  function paintHeading(): void {
    heading.textContent = `Compare ${labelOf(base)} and ${labelOf(head)}`;
    if (leader) heading.append(leader);
  }

  function writeAddress(replace: boolean): void {
    const next = new URL(window.location.href);
    next.searchParams.set('base', base);
    next.searchParams.set('head', head);
    next.searchParams.set('view', view);
    if (selectedHunk === null) next.searchParams.delete('hunk');
    else next.searchParams.set('hunk', String(selectedHunk));
    const address = `${next.pathname}?${next.searchParams.toString()}`;
    const state = { base, head, view, hunk: selectedHunk };
    if (replace) history.replaceState(state, '', address);
    else history.pushState(state, '', address);
  }

  function setView(next: View, fromControl: boolean): void {
    view = next;
    for (const button of viewButtons) {
      const chosen = button.getAttribute('data-view') === next;
      button.setAttribute('aria-checked', chosen ? 'true' : 'false');
      button.setAttribute('tabindex', chosen ? '0' : '-1');
      if (chosen && fromControl) button.focus();
    }
    swipe.hidden = next !== 'swipe';
    paintSolid();
    if (fromControl) writeAddress(true);
  }

  async function storedSolid(digest: string): Promise<Solid> {
    const answer = await send<Solid>(`/api/solids/${digest}`);
    return answer.data;
  }

  let baseSolid: Solid | null = null;
  let headSolid: Solid | null = null;

  function paintSolid(): void {
    if (!headSolid || !baseSolid) return;
    const height = bodyHeight(headSolid);
    const extra = [];
    if (view !== 'removed') {
      for (const op of headSolid.ops) {
        if (!baseSolid.ops.some((other) => JSON.stringify(other) === JSON.stringify(op))) {
          extra.push(viewport.accentLayer(opMesh(op, height)));
        }
      }
    }
    if (view !== 'added') {
      for (const op of baseSolid.ops) {
        if (!headSolid.ops.some((other) => JSON.stringify(other) === JSON.stringify(op))) {
          extra.push(viewport.ghostLayer(opMesh(op, bodyHeight(baseSolid))));
        }
      }
    }
    viewport.setSolid(view === 'removed' ? baseSolid : headSolid, { extraLayers: extra });
  }

  function paintHunks(): void {
    clear(hunkList);
    if (!result) return;
    for (const hunk of result.hunks) {
      const button = el('button', { type: 'button', class: 'hunk-button' }, [
        `Hunk ${hunk.index} of ${result.hunks.length} · ${
          hunk.kind === 'added' ? 'Added' : 'Removed'
        } · ${volumeMm3(hunk.volume)}`,
      ]);
      if (hunk.index === selectedHunk) button.setAttribute('aria-current', 'true');
      on(button, 'click', () => selectHunk(hunk.index, true));
      hunkList.append(el('li', {}, [button]));
    }
  }

  function selectHunk(index: number | null, fromControl: boolean): void {
    selectedHunk = index;
    paintHunks();
    const hunk = result?.hunks.find((candidate) => candidate.index === index);
    if (hunk) viewport.glideTo(hunk.pose as Pose);
    if (fromControl) writeAddress(true);
  }

  function paintVolumes(): void {
    clear(volumeRegion);
    if (!result) return;
    if (result.identical) {
      volumeRegion.append(
        el('p', {}, ['No geometric change: both revisions evaluate to the same solid.']),
      );
      return;
    }
    volumeRegion.append(
      el('p', {}, [`Added ${volumeMm3(result.added)}`]),
      el('p', {}, [`Removed ${volumeMm3(result.removed)}`]),
      el('p', {}, [`Unchanged ${volumeMm3(result.unchanged)}`]),
    );
  }

  function paintChanges(): void {
    clear(changeList);
    if (!result) return;
    for (const change of result.parameterChanges) {
      changeList.append(
        el('li', {}, [
          parameterChangeLine(
            {
              label: change.label,
              precision: change.unit === 'mm' || change.unit === '°' ? 1 : 0,
              unit: change.unit,
              kind: typeof change.base === 'number' ? 'length' : 'enum',
            },
            change.base,
            change.head,
          ),
        ]),
      );
    }
  }

  /** Only the newest selected pair is ever painted. */
  async function load(): Promise<void> {
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    const wanted = `${base}:${head}`;
    const ticket = ++painted;
    try {
      const answer = await send<CompareResponse>(
        `/api/compare?base=${base}&head=${head}`,
        { signal: controller.signal },
      );
      if (ticket !== painted || wanted !== `${base}:${head}`) return;
      result = answer.data;
      [baseSolid, headSolid] = await Promise.all([
        storedSolid(revisions.find((revision) => revision.id === base)!.geometryDigest),
        storedSolid(revisions.find((revision) => revision.id === head)!.geometryDigest),
      ]);
      if (ticket !== painted) return;
      paintVolumes();
      paintChanges();
      if (selectedHunk !== null && !result.hunks.some((hunk) => hunk.index === selectedHunk)) {
        selectedHunk = null;
        writeAddress(true);
      }
      paintHunks();
      paintSolid();
      viewport.setDefaultPose(
        viewport.poseForBox({
          min: [-1, -1, 0],
          max: [1, 1, 1],
        }),
        false,
      );
      viewport.paint();
      if (selectedHunk !== null) selectHunk(selectedHunk, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiCallError && error.failure.code === 'storage_unavailable') {
        showStorageBanner();
        viewport.setOutage(true, 'Last good solid: none yet');
        clear(volumeRegion);
        clear(hunkList);
      }
    }
  }

  function readAddress(): void {
    const url = new URL(window.location.href);
    const wantedBase = url.searchParams.get('base');
    const wantedHead = url.searchParams.get('head');
    const wantedView = url.searchParams.get('view');
    const wantedHunk = url.searchParams.get('hunk');
    const defaultHead = revisions[0]?.id ?? '';
    const defaultBase = revisions[1]?.id ?? defaultHead;
    head = revisions.some((revision) => revision.id === wantedHead) ? wantedHead! : defaultHead;
    base = revisions.some((revision) => revision.id === wantedBase) ? wantedBase! : defaultBase;
    view = VIEWS.includes(wantedView as View) ? (wantedView as View) : 'overlay';
    selectedHunk =
      wantedHunk !== null && /^(0|[1-9][0-9]*)$/.test(wantedHunk) && Number(wantedHunk) >= 1
        ? Number(wantedHunk)
        : null;
    paintMenus();
    paintHeading();
    setView(view, false);
  }

  on(baseMenu, 'change', () => {
    base = baseMenu.value;
    selectedHunk = null;
    paintHeading();
    writeAddress(false);
    void load();
  });
  on(headMenu, 'change', () => {
    head = headMenu.value;
    selectedHunk = null;
    paintHeading();
    writeAddress(false);
    void load();
  });

  /** J and K walk the hunks from any non-text control. */
  on(document, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing || !result) return;
    const target = keyboard.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (keyboard.key !== 'j' && keyboard.key !== 'J' && keyboard.key !== 'k' && keyboard.key !== 'K') return;
    const forward = keyboard.key === 'j' || keyboard.key === 'J';
    const count = result.hunks.length;
    if (count === 0) return;
    keyboard.preventDefault();
    if (selectedHunk === null) {
      if (forward) selectHunk(1, true);
      return;
    }
    const next = forward ? Math.min(count, selectedHunk + 1) : Math.max(1, selectedHunk - 1);
    selectHunk(next, true);
  });

  on(window, 'popstate', () => {
    readAddress();
    void load();
  });

  openLiveStream(slug, {
    revision: (data) => {
      const revision = data.revision as RevisionResponse;
      if (!revisions.some((candidate) => candidate.id === revision.id)) {
        revisions = [revision, ...revisions];
        paintMenus();
      }
      activity.textContent = `New revision ${revision.label} by ${String(data.authorDisplayName ?? '')}.`;
    },
  });

  readAddress();
  writeAddress(true);
  await load();
  void all;
}
