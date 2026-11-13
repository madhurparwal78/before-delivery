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

const OUT_OF_STEP = 'This sheet is out of step with the layout. Ask the artist before rigging.';

function circuitsSentence(count: number): string {
  return `THIS RIG HAS ${count} ${count === 1 ? 'CIRCUIT' : 'CIRCUITS'} TO PROVE`;
}

export async function renderTechnician(screen: HTMLElement, chrome: HTMLElement, token: string): Promise<() => void> {
  clear(chrome);
  const sentenceHost = el('div');
  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Circuits' });
  const rigStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Rig' });
  let announcedOutOfStep = false;

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

  const rows = new Map<string, { readonly item: HTMLLIElement; readonly box: HTMLInputElement; readonly detail: HTMLSpanElement }>();
  let shownCount: number | null = null;

  const showSentence = (count: number): void => {
    if (shownCount === count) return;
    shownCount = count;
    clear(sentenceHost);
    sentenceHost.appendChild(heading({ sentence: circuitsSentence(count), slot: wallFragment() }));
  };

  const circuitRow = (circuit: RigCircuit): { item: HTMLLIElement; box: HTMLInputElement; detail: HTMLSpanElement } => {
    const box = el('input', { type: 'checkbox', 'aria-label': `${circuit.name} is live` });
    box.addEventListener('change', () => void tick(circuit, box.checked));
    const detail = el('span');
    const item = el('li', {}, [el('label', {}, [`${circuit.name} is live`, box]), detail]);
    return { item, box, detail };
  };

  const draw = async (): Promise<void> => {
    let view: RigView;
    try {
      view = await call<RigView>(`/api/rig/${token}`);
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showSentence(0);
      showBand(error.body.detail);
      rows.clear();
      clear(list);
      return;
    }
    showSentence(view.circuits.length);
    if (view.sheetStatus === 'Out of step') {
      if (!announcedOutOfStep) {
        showBand(OUT_OF_STEP);
        rigStatus.textContent = OUT_OF_STEP;
      }
      announcedOutOfStep = true;
    }
    const present = new Set(view.circuits.map((circuit) => circuit.id));
    for (const [id, row] of rows) {
      if (present.has(id)) continue;
      row.item.remove();
      rows.delete(id);
    }
    view.circuits.forEach((circuit, position) => {
      let row = rows.get(circuit.id);
      if (row === undefined) {
        row = circuitRow(circuit);
        rows.set(circuit.id, row);
      }
      row.box.checked = circuit.live;
      row.detail.textContent = `${circuit.kind}, ${circuit.loadWatts} W of ${circuit.capacityWatts} W`;
      if (list.children[position] !== row.item) list.insertBefore(row.item, list.children[position] ?? null);
    });
  };

  clear(screen);
  append(screen, [
    sentenceHost,
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
