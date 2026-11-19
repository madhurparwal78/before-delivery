/** The partner's read-only page: the home, its view and when the hold ends. */

import { get } from '../api';
import { el } from '../dom';
import { salesTime, unitFacts } from '../display';
import type { SharedUnit } from '../../shared/types';
import type { Page } from '../router';

export function createSharedPage(url: URL): Page {
  const token = url.pathname.split('/')[2] ?? '';
  const field = el('main', { class: 'shared-field' }, [el('div', { class: 'loading-block' })]);
  const node = el('div', { class: 'page page-shared' }, [field]);

  const paintDead = (): void => {
    field.replaceChildren(
      el('h1', { class: 'shared-heading', text: 'This shared link no longer works.' }),
      el('a', { class: 'action action-quiet', href: '/finder', text: 'Open the finder' }),
    );
  };

  void (async () => {
    const result = await get<{ unit: SharedUnit; endsAt: string }>(`/api/shared/${encodeURIComponent(token)}`);
    if (!result.ok || !result.data) {
      paintDead();
      return;
    }
    const { unit, endsAt } = result.data;
    const circle = el('div', { class: 'lens-circle shared-circle' });
    if (unit.viewPhotographed && unit.viewUrl) {
      circle.append(el('img', { class: 'lens-image', src: unit.viewUrl, alt: `View from ${unit.code}` }));
    } else {
      circle.append(el('p', { class: 'lens-note', text: 'No view photograph yet.' }));
    }
    field.replaceChildren(
      el('h1', { class: 'shared-heading', text: `Home ${unit.code}` }),
      el('figure', { class: 'shared-view' }, [circle]),
      el('ul', { class: 'shared-facts', role: 'list' }, [
        ...unitFacts(unit).map((fact) => el('li', { text: fact })),
        el('li', { text: unit.viewPhotographed ? 'View photographed' : 'No view photograph yet' }),
      ]),
      el('p', { class: 'shared-until tabular', text: `Held until ${salesTime(endsAt)}.` }),
    );
  })();

  return { node };
}
