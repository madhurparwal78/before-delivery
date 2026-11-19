import { api } from '../api.js';
import { clear, el } from '../dom.js';
import { HEADING, heading } from '../shell.js';
import { button, statusRegion } from '../widgets.js';
import type { GatheringView } from '../types.js';
import type { PageContext } from '../main.js';

export async function renderGathering(ctx: PageContext): Promise<void> {
  const gatheringId = ctx.params['id'] ?? '';
  const first = await api.get<GatheringView>(`/api/gatherings/${gatheringId}`);
  if (!first.ok || first.data === null) {
    heading(ctx.main, HEADING.notFound);
    return;
  }
  heading(ctx.main, first.data.title);
  const summary = el('p', {});
  const occurrenceList = el('ul', { 'aria-label': 'Occurrences', class: 'rows' });
  const result = statusRegion('Gathering result');
  const actions = el('div', { class: 'row' });
  ctx.main.append(el('section', { class: 'panel' }, [summary, actions, result, occurrenceList]));

  const draw = (gathering: GatheringView): void => {
    summary.textContent = `${gathering.display} \u2014 ${gathering.status} \u2014 ${gathering.attendingCount} of ${gathering.limit} attending`;
    clear(occurrenceList);
    for (const occurrence of gathering.occurrences) {
      occurrenceList.append(
        el('li', { 'data-status': occurrence.status }, [
          el('span', { text: `${occurrence.display} \u2014 ${occurrence.status}` }),
          ...(occurrence.note === null ? [] : [el('span', { class: 'note', text: ` ${occurrence.note}` })])
        ])
      );
    }
    clear(actions);
    const attend = button(gathering.attending ? 'Stop attending' : 'Attend', 'primary');
    attend.addEventListener('click', () => {
      result.textContent = 'Saving...';
      const path = `/api/communities/${gathering.communityId}/gatherings/${gathering.id}/attend`;
      const call = gathering.attending ? api.remove<unknown>(path) : api.post<unknown>(path);
      void call.then((response) => {
        result.textContent = response.ok
          ? gathering.attending
            ? "You're no longer attending."
            : "You're attending."
          : (response.error ?? '');
        void api.get<GatheringView>(`/api/gatherings/${gatheringId}`).then((fresh) => {
          if (fresh.data !== null) draw(fresh.data);
        });
      });
    });
    actions.append(attend);
  };

  draw(first.data);
}
