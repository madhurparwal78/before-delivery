import type { Part } from '../shared/types.js';
import { RequestFailed, request } from './api.js';
import { button, clear, el, isPhone, whilePending } from './dom.js';
import { fetchSystems, pageGroups, systemGroup } from './engraving.js';
import { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';
import { downloadPartPdf, statusChip } from './tools.js';
import { partMessage } from './workspace.js';

export function renderPartPage(
  state: ScoreState,
  partId: string,
  navigate: (path: string) => void,
): HTMLElement {
  const regions = new Regions(['Parts']);
  const part = (): Part => state.parts.find((candidate) => candidate.id === partId)!;
  const heading = el('h1', {}, [part().name]);
  const chipHolder = el('span', {});
  const pages = el('div', {
    class: 'part-pages',
    role: 'region',
    'aria-label': `${part().name} part`,
  });
  const extract = button(`Extract ${part().name}`);
  const head = el('div', { class: 'part-page-head' }, [
    heading,
    chipHolder,
    extract,
    button('Back to score', {}, () => navigate(`/score/${state.scoreId}`)),
  ]);
  const downloadHolder = el('span', {});
  head.append(downloadHolder);

  const paintChip = (): void => {
    clear(chipHolder);
    chipHolder.append(statusChip(part()));
    clear(downloadHolder);
    if (part().status === 'ready') {
      const link = el(
        'a',
        { href: `/api/scores/${state.scoreId}/parts/${partId}/pdf` },
        [`Download ${part().name} PDF`],
      );
      link.addEventListener('click', (event) => {
        event.preventDefault();
        void downloadPartPdf(state, part());
      });
      downloadHolder.append(link);
    }
  };

  const paintPages = async (): Promise<void> => {
    const engraved = await fetchSystems(state.scoreId, 'part', partId);
    clear(pages);
    if (isPhone()) {
      const strip = el('div', {
        class: 'system-strip',
        role: 'region',
        'aria-label': 'System strip',
      });
      for (const system of engraved.systems) strip.append(systemGroup(system));
      pages.append(el('div', { class: 'part-page' }, [strip]));
      return;
    }
    for (const page of pageGroups(engraved.systems)) pages.append(page);
  };

  extract.addEventListener('click', () => {
    void whilePending(extract, async () => {
      try {
        await request(`/api/scores/${state.scoreId}/parts/${partId}/extract`, { method: 'POST' });
        regions.say('Parts', `Engraving ${part().name}\u2026`);
      } catch (cause) {
        if (cause instanceof RequestFailed) regions.say('Parts', cause.failure.message);
      }
    });
  });

  const root = el('div', { class: 'part-root' }, [head, pages, regions.root]);

  if (state.me.role !== 'player') {
    const afterMeasure = el('input', {
      type: 'number',
      min: '1',
      value: '1',
      'aria-label': 'After measure',
    });
    const breaks = el('ul', { class: 'tool-list', role: 'list', 'aria-label': 'Breaks' });
    const paintBreaks = (): void => {
      clear(breaks);
      const layout = part().layout;
      const items = [
        ...layout.systemBreaks.map((measure) => ({ measure, kind: 'System break' })),
        ...layout.pageBreaks.map((measure) => ({ measure, kind: 'Page turn' })),
      ].sort((a, b) => a.measure - b.measure);
      for (const item of items) {
        breaks.append(
          el('li', {}, [
            `${item.kind} after measure ${item.measure}`,
            button(`Remove break after measure ${item.measure}`, {}, () => {
              void save(
                layout.systemBreaks.filter((measure) => measure !== item.measure),
                layout.pageBreaks.filter((measure) => measure !== item.measure),
                `Removed break after measure ${item.measure}.`,
              );
            }),
          ]),
        );
      }
    };

    const save = async (
      systemBreaks: number[],
      pageBreaks: number[],
      announcement: string,
    ): Promise<void> => {
      try {
        const payload = await request<{ part: Part }>(
          `/api/scores/${state.scoreId}/parts/${partId}/layout`,
          { method: 'PUT', body: { systemBreaks, pageBreaks } },
        );
        state.parts = state.parts.map((candidate) =>
          candidate.id === partId ? payload.part : candidate,
        );
        regions.say('Layout', announcement);
        paintBreaks();
        await paintPages();
      } catch (cause) {
        if (cause instanceof RequestFailed) regions.say('Layout', cause.failure.message);
      }
    };

    const addSystemBreak = button('Add system break', {}, () => {
      const measure = Number(afterMeasure.value);
      void save(
        [...new Set([...part().layout.systemBreaks, measure])],
        part().layout.pageBreaks,
        `System break after measure ${measure} added.`,
      );
    });
    const addPageTurn = button('Add page turn', {}, () => {
      const measure = Number(afterMeasure.value);
      void save(
        part().layout.systemBreaks,
        [...new Set([...part().layout.pageBreaks, measure])],
        `Page turn after measure ${measure} added.`,
      );
    });
    const controls = el('div', { class: 'break-controls' }, [
      el('div', { class: 'field' }, [el('label', {}, ['After measure']), afterMeasure]),
      addSystemBreak,
      addPageTurn,
    ]);
    head.append(controls);
    root.insertBefore(breaks, pages);
    paintBreaks();
  }

  let announced = '';
  state.on('parts', () => {
    heading.textContent = part().name;
    paintChip();
    const now = `${part().status}:${part().lastError ?? ''}`;
    if (announced !== '' && announced !== now) {
      const message = partMessage(part());
      if (message !== '') regions.say('Parts', message);
    }
    announced = now;
    void paintPages();
  });
  paintChip();
  void paintPages();
  return root;
}
