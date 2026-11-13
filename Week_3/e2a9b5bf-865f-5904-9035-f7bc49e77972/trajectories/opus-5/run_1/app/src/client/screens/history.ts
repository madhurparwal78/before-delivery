import type { CatalogueObject, Observation } from '../../shared/types.js';
import { api } from '../api.js';
import { internalLink, missingScreen, notFoundScreen, workingScreen } from '../chrome.js';
import { viewHistory } from '../derive.js';
import { el } from '../dom.js';
import { askToDeleteObservation, observationDetails } from '../observation-actions.js';
import { prefetchAccount } from '../prefetch.js';
import { onLeaveScreen, type ScreenContext } from '../router.js';
import { appState, subscribe, updateCopy } from '../state.js';

function historyRow(
  observation: Observation,
  focusNext: (row: HTMLElement) => void,
): HTMLElement {
  const open = internalLink('Open', `/sessions/${observation.session_id}?observation=${observation.id}`);
  const remove = el('button', {
    class: 'button row-button',
    text: 'Delete',
    attrs: { type: 'button' },
  });
  const parts: Array<Node | string | null> = [
    el('span', { class: 'row-name', text: observation.designation }),
    el('span', { class: 'row-detail', text: observationDetails(observation) }),
  ];
  if (observation.description !== '') {
    parts.push(el('p', { class: 'row-description', text: observation.description }));
  }
  parts.push(el('div', { class: 'row-actions' }, [open, remove]));
  const row = el('li', { class: 'row' }, parts);
  remove.addEventListener('click', () => {
    askToDeleteObservation({
      observation,
      opener: remove,
      afterQueued: () => focusNext(row),
    });
  });
  return row;
}

export async function renderObjectHistory(context: ScreenContext): Promise<HTMLElement> {
  const objectId = context.params.id ?? '';
  const state = appState();
  let object: CatalogueObject | null =
    state.copy.objects.find((entry) => entry.id === objectId) ?? null;

  const answer = await api.get<{ object: CatalogueObject; observations: Observation[] }>(
    `/api/objects/${encodeURIComponent(objectId)}/history`,
  );
  if (answer.status === 404) return notFoundScreen();
  if (answer.ok && answer.body) {
    object = answer.body.object;
    const observations = answer.body.observations;
    updateCopy((copy) => {
      for (const observation of observations) copy.observations[observation.id] = observation;
      if (!copy.objects.some((entry) => entry.id === objectId) && answer.body.object) {
        copy.objects = [...copy.objects, answer.body.object];
      }
    });
  }

  if (!object) return missingScreen();

  const { root, content } = workingScreen(`${object.designation} ${object.name}`);

  const list = el('ul', {
    class: 'list',
    attrs: { role: 'list', 'aria-label': `Observations of ${object.designation}` },
  });

  /** Focus the next row's Open, else the previous row's, else Tonight. */
  const focusAfterDelete = (row: HTMLElement): void => {
    const index = [...list.children].indexOf(row);
    paint();
    const rows = [...list.children];
    const target = (rows[index] ?? rows[index - 1]) as HTMLElement | undefined;
    const open = target?.querySelector<HTMLElement>('a.link');
    if (open) open.focus();
    else root.querySelector<HTMLElement>('nav.nav a.nav-link')?.focus();
  };

  function paint(): void {
    list.replaceChildren(
      ...viewHistory(objectId).map((observation) => historyRow(observation, focusAfterDelete)),
    );
  }

  paint();
  const unsubscribe = subscribe(paint);
  onLeaveScreen(unsubscribe);
  content.append(list);
  void prefetchAccount().then(paint);
  return root;
}
