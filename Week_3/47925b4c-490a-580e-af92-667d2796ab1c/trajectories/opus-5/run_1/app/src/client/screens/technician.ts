import { ApiProblem, call } from '../api.js';
import { append, clear, el } from '../dom.js';
import { heading, showBand } from '../shell.js';
import { wallFragment } from '../wall.js';

interface RigCircuit {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly loadWatts: number;
  readonly capacityWatts: number;
  readonly live: boolean;
  readonly confirmedAt: string | null;
}

interface RigView {
  readonly siteName: string;
  readonly layoutName: string;
  readonly sheetStatus: string;
  readonly issuedAt: string;
  readonly linkEndsAt: string;
  readonly showAt: string;
  readonly lowestContrast: number | null;
  readonly circuits: readonly RigCircuit[];
}

export async function renderTechnician(screen: HTMLElement, chrome: HTMLElement, token: string): Promise<() => void> {
  clear(chrome);
  const sentenceHost = el('div');
  const bandHost = el('div');
  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Circuits' });
  const rigStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Rig' });

  const tick = async (circuit: RigCircuit, live: boolean): Promise<void> => {
    try {
      await call(`/api/rig/${token}/circuits/${circuit.id}/live`, { method: 'POST', body: { live } });
      rigStatus.textContent = live ? `${circuit.name} marked live.` : `${circuit.name} marked not live.`;
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const draw = async (): Promise<void> => {
    let view: RigView;
    try {
      view = await call<RigView>(`/api/rig/${token}`);
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      clear(sentenceHost);
      sentenceHost.appendChild(heading({ sentence: 'THIS RIG HAS 0 CIRCUITS TO PROVE', slot: wallFragment() }));
      showBand(error.body.detail);
      clear(list);
      return;
    }
    const count = view.circuits.length;
    clear(sentenceHost);
    sentenceHost.appendChild(
      heading({
        sentence:
          count === 1 ? 'THIS RIG HAS 1 CIRCUIT TO PROVE' : `THIS RIG HAS ${count} CIRCUITS TO PROVE`,
        slot: wallFragment(),
      }),
    );
    clear(bandHost);
    if (view.sheetStatus === 'Out of step') {
      bandHost.appendChild(
        el('p', {
          class: 'band',
          role: 'status',
          text: 'This sheet is out of step with the layout. Ask the artist before rigging.',
        }),
      );
    }
    clear(list);
    for (const circuit of view.circuits) {
      const box = el('input', {
        type: 'checkbox',
        'aria-label': `${circuit.name} is live`,
        checked: circuit.live,
      });
      box.addEventListener('change', () => void tick(circuit, box.checked));
      list.appendChild(
        el('li', {}, [
          el('label', {}, [`${circuit.name} is live`, box]),
          el('span', { text: `${circuit.kind}, ${circuit.loadWatts} W of ${circuit.capacityWatts} W` }),
        ]),
      );
    }
  };

  clear(screen);
  append(screen, [
    sentenceHost,
    bandHost,
    el('div', { class: 'columns' }, [
      el('div', { class: 'lede' }, [
        el('p', {}, [el('a', { href: `/api/rig/${token}/sheet.pdf`, text: 'Open the PDF', target: '_blank' })]),
        rigStatus,
      ]),
      el('div', { class: 'evidence' }, [list]),
    ]),
  ]);

  await draw();

  const stream = new EventSource(`/api/rig/${token}/events`);
  stream.addEventListener('circuit.confirmed', () => void draw());
  stream.addEventListener('sheet.changed', () => void draw());
  stream.addEventListener('error', () => {
    if (stream.readyState === EventSource.CLOSED) void draw();
  });
  return () => stream.close();
}
