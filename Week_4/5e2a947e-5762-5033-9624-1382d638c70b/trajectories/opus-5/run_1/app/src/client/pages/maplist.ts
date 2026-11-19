import { copy } from '../../shared/copy.js';
import type { MapPayload, Role } from '../../shared/types.js';
import { docFromPayload } from '../../shared/api.js';
import { api, RequestFailed } from '../api.js';
import { el, on } from '../dom.js';
import { renderMiniature } from '../miniature.js';
import { navigate } from '../router.js';
import { inboxButton, openDialog, resetScreen } from '../shell.js';

interface MapSummary {
  id: string;
  title: string;
  role: Role;
  updated_at: string;
  revision: number;
  topic_count: number;
}

async function miniatureFor(id: string): Promise<SVGElement | null> {
  try {
    const payload = await api.get<MapPayload>(`/api/maps/${id}`);
    return renderMiniature(docFromPayload(payload), payload.map.layout);
  } catch {
    return null;
  }
}

function card(map: MapSummary): HTMLElement {
  const holder = el('div', { class: 'map-card-picture' });
  void miniatureFor(map.id).then((picture) => {
    if (picture) holder.append(picture);
  });
  return el('li', { class: 'map-card' }, [
    holder,
    el('a', { href: `/m/${map.id}`, text: map.title }),
    el('p', { class: 'map-card-meta', text: `${map.topic_count} topics \u00b7 ${map.role}` }),
  ]);
}

function newMapDialog(opener: HTMLElement): void {
  openDialog({ title: 'New map', returnFocusTo: opener }, (close, body) => {
    const idea = el('input', { id: 'central-idea', type: 'text', value: '' });
    const options: [string, string][] = [
      ['Blank', ''],
      ['Street fair', 'street-fair'],
      ['Exam revision', 'exam-revision'],
      ['House move', 'house-move'],
    ];
    const radios = options.map(([label, value], index) =>
      el('label', { class: 'radio' }, [
        el('input', {
          type: 'radio',
          name: 'start-from',
          value,
          checked: index === 0,
        }),
        el('span', { text: label }),
      ]),
    );
    const group = el('div', { role: 'radiogroup', 'aria-label': 'Start from' }, radios);
    const error = el('p', { class: 'field-error' });
    const create = el('button', { type: 'button', class: 'primary', text: 'Create map' });
    on(create, 'click', () => {
      const chosen = radios
        .map((radio) => radio.querySelector('input') as HTMLInputElement)
        .find((input) => input.checked);
      const template = chosen && chosen.value !== '' ? chosen.value : null;
      void api
        .post<{ map: { id: string } }>('/api/maps', { title: idea.value.trim(), template })
        .then((answer) => {
          close();
          navigate(`/m/${answer.map.id}`);
        })
        .catch((failure: unknown) => {
          if (failure instanceof RequestFailed) error.textContent = failure.body.message;
        });
    });
    body.append(
      el('h2', { text: 'New map' }),
      el('div', { class: 'field' }, [
        el('label', { for: 'central-idea', text: 'Central idea' }),
        idea,
        error,
      ]),
      el('fieldset', {}, [el('legend', { text: 'Start from' }), group]),
      el('div', { class: 'dialog-actions' }, [create]),
    );
  });
}

export async function mapListScreen(): Promise<void> {
  const root = resetScreen();
  document.title = 'Your maps';
  let maps: MapSummary[] = [];
  try {
    const answer = await api.get<{ maps: MapSummary[] }>('/api/maps');
    maps = answer.maps;
  } catch (error) {
    if (error instanceof RequestFailed && error.status === 401) {
      navigate('/signin', true);
      return;
    }
    throw error;
  }
  const newMap = el('button', { type: 'button', class: 'primary', text: 'New map' });
  on(newMap, 'click', () => newMapDialog(newMap));
  const recent = el(
    'section',
    { class: 'recent-maps', role: 'region', 'aria-label': 'Recent maps' },
    [
      el('h2', { text: 'Recent maps' }),
      el(
        'ul',
        { class: 'recent-trio' },
        maps.slice(0, 3).map((map) => card(map)),
      ),
    ],
  );
  const grid = el(
    'ul',
    { class: 'map-grid', 'aria-label': 'All maps' },
    maps.map((map) => card(map)),
  );
  root.append(
    el('header', { class: 'top-bar compact', role: 'banner' }, [
      el('a', { href: '/', class: 'logo', 'aria-label': 'Sprigmap' }, [
        el('span', { class: 'logo-mark', 'aria-hidden': 'true' }),
        el('span', { text: 'Sprigmap' }),
      ]),
      el('div', { class: 'top-bar-links' }, [inboxButton()]),
    ]),
    el('main', { class: 'map-list' }, [
      el('div', { class: 'map-list-head' }, [el('h1', { text: 'Your maps' }), newMap]),
      maps.length === 0 ? el('p', { class: 'empty-list', text: copy.emptyMapList }) : recent,
      maps.length === 0 ? el('div') : grid,
    ]),
  );
}
