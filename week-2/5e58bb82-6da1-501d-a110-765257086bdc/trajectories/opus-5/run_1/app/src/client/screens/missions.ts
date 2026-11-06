import { fixed } from '../../shared/numbers.js';
import type { MissionSummary } from '../../shared/types.js';
import { isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { el } from '../dom.js';

/** Every mission in the published mission order. */
export const missionsScreen: ScreenFactory = (shell): Mounted => {
  const body = el('tbody', {});
  const table = el('table', { 'aria-label': 'Missions', class: 'data-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Name']),
        el('th', { scope: 'col' }, ['Client']),
        el('th', { scope: 'col' }, ['Survey date']),
        el('th', { scope: 'col' }, ['Status']),
        el('th', { scope: 'col' }, ['Coverage']),
      ]),
    ]),
    body,
  ]);

  const node = el('section', { class: 'missions' }, [el('h1', {}, ['Missions']), table]);

  const at = shell.generation;
  void request<MissionSummary[]>('/api/missions')
    .then((missions) => {
      if (!isCurrent(at)) return;
      body.replaceChildren(
        ...missions.map((mission) => {
          const link = el('a', { href: `/missions/${mission.id}` }, [mission.name]);
          link.addEventListener('click', (event) => {
            event.preventDefault();
            shell.navigate(`/missions/${mission.id}`);
          });
          return el('tr', {}, [
            el('td', {}, [link]),
            el('td', {}, [mission.client_name]),
            el('td', { class: 'mono' }, [mission.survey_date]),
            el('td', {}, [mission.status]),
            el('td', { class: 'mono' }, [`${fixed(mission.counters.coverage_pct, 1)}%`]),
          ]);
        }),
      );
    })
    .catch(() => undefined);

  return { node };
};
