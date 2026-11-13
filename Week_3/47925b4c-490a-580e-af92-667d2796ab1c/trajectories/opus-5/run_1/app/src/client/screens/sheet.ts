import { ApiProblem, call, newKey } from '../api.js';
import { append, button, clear, el, textbox } from '../dom.js';
import { listen } from '../events.js';
import { clearBand, heading, navigation, showBand } from '../shell.js';
import { wallFragment } from '../wall.js';

interface SheetCircuit {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly loadWatts: number;
  readonly capacityWatts: number;
  readonly live: boolean;
  readonly confirmedAt: string | null;
}

interface Sheet {
  readonly id: string;
  readonly layoutId: string;
  readonly version: number;
  readonly status: string;
  readonly issuedAt: string;
  readonly techUrl: string | null;
  readonly linkEndsAt: string;
  readonly linkActive: boolean;
  readonly lowestContrast: number | null;
  readonly circuits: readonly SheetCircuit[];
}

interface Job {
  readonly id: string;
  readonly phase: string;
  readonly stepsDone: number;
  readonly stepsTotal: number;
}

export async function renderSheet(screen: HTMLElement, chrome: HTMLElement, sheetId: string): Promise<() => void> {
  clear(chrome);
  chrome.appendChild(navigation('/sites'));

  const sentenceHost = el('div');
  const circuits = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Circuits' });
  const linkBox = textbox('Technician link', '', { readonly: true });
  const maskStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Masks' });
  const progress = el('progress', { role: 'progressbar', 'aria-label': 'Mask bundle', max: 1, value: 0 });
  const downloadHost = el('p');
  const bandHost = el('div');
  let job: Job | null = null;

  const draw = async (): Promise<void> => {
    const sheet = await call<Sheet>(`/api/sheets/${sheetId}`);
    clear(sentenceHost);
    sentenceHost.appendChild(
      heading({ sentence: `THIS SHEET IS ${sheet.status.toUpperCase()}`, slot: wallFragment() }),
    );
    clear(bandHost);
    if (sheet.status === 'Out of step') {
      bandHost.appendChild(
        el('p', {
          class: 'band',
          role: 'status',
          text: 'This sheet is out of step with the layout. Ask the artist before rigging.',
        }),
      );
    }
    clear(circuits);
    append(
      circuits,
      sheet.circuits.map((circuit) =>
        el('li', {}, [
          el('span', { text: `${circuit.name} ${circuit.kind}` }),
          el('span', { text: `${circuit.loadWatts} W of ${circuit.capacityWatts} W` }),
          el('span', { text: circuit.live ? 'Live' : 'Not live' }),
        ]),
      ),
    );
    linkBox.value = sheet.techUrl === null ? '' : `${window.location.origin}${sheet.techUrl}`;
  };

  const newLink = async (): Promise<void> => {
    clearBand();
    try {
      await call(`/api/sheets/${sheetId}/link`, { method: 'POST', body: {} });
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const endLink = async (): Promise<void> => {
    await call(`/api/sheets/${sheetId}/link`, { method: 'DELETE' });
    await draw();
  };

  const withdraw = async (): Promise<void> => {
    clearBand();
    try {
      await call(`/api/sheets/${sheetId}/withdraw`, { method: 'POST', body: {} });
      await draw();
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const showJob = (current: Job): void => {
    job = current;
    progress.setAttribute('max', String(current.stepsTotal));
    progress.setAttribute('value', String(current.stepsDone));
    maskStatus.textContent =
      current.phase === 'waiting_for_store'
        ? "The sheet store isn't answering. The mask bundle will carry on when it returns."
        : `${current.phase}: ${current.stepsDone} of ${current.stepsTotal}`;
    clear(downloadHost);
    if (current.phase === 'done') {
      downloadHost.appendChild(
        el('a', { href: `/api/mask-jobs/${current.id}/bundle`, text: 'Download masks', download: 'masks.zip' }),
      );
    }
  };

  const buildMasks = async (): Promise<void> => {
    clearBand();
    const sheet = await call<Sheet>(`/api/sheets/${sheetId}`);
    try {
      showJob(
        await call<Job>(`/api/layouts/${sheet.layoutId}/mask-jobs`, { method: 'POST', key: newKey(), body: {} }),
      );
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  const cancelMasks = async (): Promise<void> => {
    if (job === null) return;
    clearBand();
    try {
      showJob(await call<Job>(`/api/mask-jobs/${job.id}`, { method: 'DELETE' }));
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      showBand(error.body.detail);
    }
  };

  clear(screen);
  append(screen, [
    sentenceHost,
    bandHost,
    el('div', { class: 'columns' }, [
      el('div', { class: 'lede' }, [
        el('p', {}, [el('a', { href: `/api/sheets/${sheetId}/pdf`, text: 'Open the PDF', target: '_blank' })]),
        el('form', { 'aria-label': 'Technician link', onsubmit: (event: Event) => event.preventDefault() }, [
          el('label', {}, ['Technician link', linkBox]),
          el('div', { class: 'row-actions' }, [
            button('New link', () => void newLink()),
            button('End link', () => void endLink(), { class: 'quiet' }),
            button('Withdraw sheet', () => void withdraw(), { class: 'quiet' }),
          ]),
        ]),
        el('form', { 'aria-label': 'Masks', onsubmit: (event: Event) => event.preventDefault() }, [
          el('div', { class: 'row-actions' }, [
            button('Build masks', () => void buildMasks()),
            button('Cancel masks', () => void cancelMasks(), { class: 'quiet' }),
          ]),
          progress,
          maskStatus,
          downloadHost,
        ]),
      ]),
      el('div', { class: 'evidence' }, [circuits]),
    ]),
  ]);

  await draw();
  return listen('/api/events', (event) => {
    if (event.type === 'sheet.changed' && event.aggregateId === sheetId) void draw();
    if (event.type === 'circuit.confirmed' && event.aggregateId === sheetId) void draw();
    if (event.type === 'mask_job.changed' && (job === null || event.aggregateId === job.id)) {
      showJob({
        id: event.aggregateId,
        phase: event.data['phase'] as string,
        stepsDone: event.data['stepsDone'] as number,
        stepsTotal: event.data['stepsTotal'] as number,
      });
    }
  });
}
