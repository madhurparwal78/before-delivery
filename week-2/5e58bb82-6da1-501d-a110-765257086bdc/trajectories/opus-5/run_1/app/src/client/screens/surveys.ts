import { fixed } from '../../shared/numbers.js';
import type { MissionSummary } from '../../shared/types.js';
import { isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { button, el, setText } from '../dom.js';

const PAGE_SIZE = 20;

/** The reviewer's own surveys, 20 at a time in the published order. */
export const surveysScreen: ScreenFactory = (shell): Mounted => {
  const count = el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Survey list',
    class: 'survey-count',
  });
  shell.registerRegion('Survey list', count);

  const body = el('tbody', {});
  const table = el('table', { 'aria-label': 'Surveys', class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Name']),
        el('th', { scope: 'col' }, ['Survey date']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['Coverage']),
      ]),
    ]),
    body,
  ]);
  const loadMore = button('Load more surveys');
  loadMore.hidden = true;

  const node = el('section', { class: 'surveys' }, [
    el('h1', {}, ['Your surveys']),
    count,
    table,
    loadMore,
  ]);

  let all: MissionSummary[] = [];
  let shown = 0;

  function row(mission: MissionSummary): HTMLElement {
    const link = el('a', { href: `/surveys/${mission.id}` }, [mission.name]);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      shell.navigate(`/surveys/${mission.id}`);
    });
    return el('tr', {}, [
      el('td', {}, [link]),
      el('td', { class: 'mono' }, [mission.survey_date]),
      el('td', {}, [mission.status]),
      el('td', { class: 'mono' }, [`${fixed(mission.counters.coverage_pct, 1)}%`]),
    ]);
  }

  function appendPage(focusFirstNew: boolean): void {
    const next = all.slice(shown, shown + PAGE_SIZE);
    const nodes = next.map((mission) => row(mission));
    for (const added of nodes) body.append(added);
    shown += next.length;
    setText(count, `Showing ${shown} of ${all.length} surveys`);
    loadMore.hidden = shown >= all.length;
    if (focusFirstNew) nodes[0]?.querySelector('a')?.focus();
  }

  loadMore.addEventListener('click', () => appendPage(true));

  const at = shell.generation;
  void request<MissionSummary[]>('/api/missions')
    .then((missions) => {
      if (!isCurrent(at)) return;
      all = missions;
      appendPage(false);
    })
    .catch(() => undefined);

  return { node, dispose: () => shell.unregisterRegion('Survey list') };
};
