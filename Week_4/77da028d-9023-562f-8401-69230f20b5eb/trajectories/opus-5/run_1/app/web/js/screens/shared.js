import { api } from '../api.js';
import { el } from '../dom.js';
import { duration } from '../format.js';

const UNAVAILABLE = 'This shared project link is no longer available.';

export async function renderShared(main, token) {
  let shared;
  try {
    shared = await api('GET', `/api/shared/${encodeURIComponent(token)}`);
  } catch (_) {
    main.append(el('div', { class: 'hero-empty' }, [el('p', { text: UNAVAILABLE })]));
    return;
  }
  main.append(
    el('div', { class: 'stack' }, [
      el('h1', { text: shared.project_name }),
      el('p', { class: 'muted', text: `${shared.target_name} \u00b7 ${shared.state}` }),
      el('div', { class: 'table-sheet' }, [
        el('table', { 'aria-label': 'Integration summary' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Filter' }),
              el('th', { text: 'Planned' }),
              el('th', { text: 'Logged' }),
              el('th', { text: 'Owed' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            shared.filters.map((entry) =>
              el('tr', {}, [
                el('td', { text: entry.filter }),
                el('td', { class: 'num', text: duration(entry.planned_seconds) }),
                el('td', { class: 'num', text: duration(entry.logged_seconds) }),
                el('td', { class: 'num', text: duration(entry.owed_seconds) }),
              ]),
            ),
          ),
        ]),
      ]),
      el('p', {
        class: 'num',
        text: `${duration(shared.total_integration_seconds)} total`,
      }),
      el('p', { class: 'num muted', text: `${shared.session_count} sessions` }),
      el('p', {
        text:
          `Imaged from near ${shared.site.latitude.toFixed(1)}, ` +
          `${shared.site.longitude.toFixed(1)}`,
      }),
    ]),
  );
}
