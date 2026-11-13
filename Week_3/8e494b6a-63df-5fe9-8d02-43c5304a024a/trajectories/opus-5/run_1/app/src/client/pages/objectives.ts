import { clear, el } from '../dom.js';
import { get, setLiveHandler, type LiveMessage } from '../state.js';
import { emptyBand, loadFailed } from '../widgets.js';

type Objective = {
  id: string;
  service: string;
  name: string;
  target: number;
  budget_remaining: string;
  objective: { bad: number; total: number };
  long: { bad: number; total: number; burn: string };
  short: { bad: number; total: number; burn: string };
  status: string;
};

export async function renderObjectives(main: HTMLElement): Promise<void> {
  let data: { objectives: Objective[] };
  try {
    data = await get<{ objectives: Objective[] }>('/api/objectives');
  } catch {
    main.append(loadFailed(() => void renderObjectives(main)));
    return;
  }
  main.append(el('h1', { class: 'view-title', text: 'Objectives' }));
  if (data.objectives.length === 0) {
    main.append(
      emptyBand(
        'No objectives yet.',
        el('a', { href: '/rules', text: 'Published rules', 'aria-label': 'Published rules' }),
      ),
    );
    return;
  }
  let selected = data.objectives[0].service;
  const strip = el('ul', { role: 'list', 'aria-label': 'Services', class: 'service-strip' });
  const panel = el('div', { role: 'region', 'aria-label': 'Objective', class: 'objective-panel card' });

  const renderPanel = (): void => {
    const objective = data.objectives.find((item) => item.service === selected);
    clear(panel);
    if (!objective) return;
    panel.append(
      el('h2', { text: objective.name }),
      el('p', { class: 'mono', text: `Budget remaining ${objective.budget_remaining}%` }),
      el('p', { class: 'mono', text: `Long burn ${objective.long.burn}` }),
      el('p', { class: 'mono', text: `Short burn ${objective.short.burn}` }),
      el('p', { class: `mono status-${objective.status.replace(/\s/g, '-')}`, text: `Status ${objective.status}` }),
      el('p', { class: 'mono', text: `${objective.objective.bad} bad of ${objective.objective.total}` }),
      el('p', { class: 'mono', text: `${objective.long.bad} bad of ${objective.long.total}` }),
      el('p', { class: 'mono', text: `${objective.short.bad} bad of ${objective.short.total}` }),
    );
  };

  const renderStrip = (): void => {
    clear(strip);
    for (const objective of data.objectives) {
      const tile = el('button', {
        type: 'button',
        'aria-label': objective.service,
        class: objective.service === selected ? 'service-tile selected' : 'service-tile',
        text: objective.service,
      });
      tile.addEventListener('click', () => {
        selected = objective.service;
        renderStrip();
        renderPanel();
      });
      strip.append(el('li', {}, [tile]));
    }
  };

  renderStrip();
  renderPanel();
  main.append(strip, panel);
  setLiveHandler((message: LiveMessage) => {
    if (message.type !== 'clock' && message.type !== 'upload') return;
    void (async () => {
      data = await get<{ objectives: Objective[] }>('/api/objectives');
      renderPanel();
    })();
  });
}
