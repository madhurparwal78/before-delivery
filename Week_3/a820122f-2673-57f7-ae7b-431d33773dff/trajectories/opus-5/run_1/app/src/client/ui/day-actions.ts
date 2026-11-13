import { postJson, serverText, type ApiErrorBody } from '../api.js';
import { COPY } from '../copy.js';
import { button, el, setStatus, textField } from '../dom.js';
import { offline, onConnectionChange } from '../offline.js';
import { openDialog } from '../ui/dialog.js';

export type DayActionTargets = {
  crewId: string;
  role: 'owner_master' | 'crew';
  shipDate: () => string;
  month: () => string;
  dayStatus: HTMLElement;
  monthStatus: HTMLElement;
  feedback: HTMLElement;
  refresh: () => Promise<void>;
};

const connectionGated: { node: HTMLElement }[] = [];

function gate(node: HTMLElement): HTMLElement {
  connectionGated.push({ node });
  node.setAttribute('aria-disabled', offline() ? 'true' : 'false');
  return node;
}

export function refreshConnectionGates(): void {
  const blocked = offline();
  for (const item of connectionGated) {
    if (!item.node.isConnected) continue;
    item.node.setAttribute('aria-disabled', blocked ? 'true' : 'false');
  }
}

onConnectionChange(refreshConnectionGates);

function noteRegion(targets: DayActionTargets): HTMLElement {
  return targets.role === 'owner_master' ? targets.feedback : targets.dayStatus;
}

export function signButton(targets: DayActionTargets): HTMLButtonElement {
  const node = button('Sign this day', { class: 'primary' });
  gate(node);
  node.addEventListener('click', () => {
    if (offline()) {
      setStatus(targets.dayStatus, COPY.signingOffline);
      return;
    }
    const shipDate = targets.shipDate();
    openDialog({
      title: 'Sign this day',
      content: [el('p', { text: COPY.signDialogText(shipDate) })],
      submitLabel: 'Confirm signature',
      onSubmit: async () => {
        setStatus(targets.dayStatus, COPY.signing);
        const result = await postJson<ApiErrorBody>(`/api/crew/${targets.crewId}/days/sign`, {
          ship_dates: [shipDate],
        });
        if (result.ok) {
          await targets.refresh();
          setStatus(targets.dayStatus, COPY.signed);
          return;
        }
        if (result.networkFailure) {
          setStatus(targets.dayStatus, COPY.signingOffline);
          return;
        }
        if (result.body.error === 'day_not_closed') {
          setStatus(targets.dayStatus, COPY.dayStillOpen);
          return;
        }
        setStatus(targets.dayStatus, serverText(result.body));
      },
    });
  });
  return node;
}

export function countersignButton(targets: DayActionTargets): HTMLButtonElement {
  const node = button('Countersign this day', { class: 'primary' });
  gate(node);
  node.addEventListener('click', () => {
    if (offline()) {
      setStatus(targets.dayStatus, COPY.countersigningOffline);
      return;
    }
    void (async () => {
      setStatus(targets.dayStatus, COPY.countersigning);
      const result = await postJson<ApiErrorBody>(
        `/api/crew/${targets.crewId}/days/countersign`,
        { ship_dates: [targets.shipDate()] },
      );
      if (result.ok) {
        await targets.refresh();
        setStatus(targets.dayStatus, COPY.countersigned);
        return;
      }
      if (result.networkFailure) {
        setStatus(targets.dayStatus, COPY.countersigningOffline);
        return;
      }
      if (result.body.error === 'day_not_signed') {
        setStatus(targets.dayStatus, COPY.notSignedYet);
        return;
      }
      setStatus(targets.dayStatus, serverText(result.body));
    })();
  });
  return node;
}

export function addNoteButton(
  targets: DayActionTargets,
  options: { label?: string; eventId?: string } = {},
): HTMLButtonElement {
  const node = button(options.label ?? 'Add a note');
  gate(node);
  node.addEventListener('click', () => {
    const region = noteRegion(targets);
    if (offline()) {
      setStatus(region, COPY.notesOffline);
      return;
    }
    const note = textField('Note');
    openDialog({
      title: 'Add a note',
      content: [note.wrapper],
      submitLabel: 'Save note',
      onSubmit: async () => {
        if (note.input.value.trim() === '') {
          setStatus(region, COPY.writeNoteFirst);
          return;
        }
        setStatus(region, COPY.savingNote);
        const result = await postJson<ApiErrorBody>(
          `/api/crew/${targets.crewId}/days/${targets.shipDate()}/notes`,
          { text: note.input.value, event_id: options.eventId ?? null },
        );
        if (result.ok) {
          await targets.refresh();
          setStatus(region, COPY.noteSaved);
          return;
        }
        if (result.networkFailure) {
          setStatus(region, COPY.notesOffline);
          return;
        }
        setStatus(region, serverText(result.body));
      },
    });
  });
  return node;
}

export function sealButton(targets: DayActionTargets): HTMLButtonElement {
  const node = button('Seal this month', { class: 'primary' });
  node.addEventListener('click', () => {
    void (async () => {
      const result = await postJson<ApiErrorBody & { label?: string }>(
        `/api/crew/${targets.crewId}/months/${targets.month()}/seal`,
      );
      if (result.ok) {
        setStatus(targets.monthStatus, result.body.label ?? COPY.awaitingArchive);
        await targets.refresh();
        return;
      }
      if (result.status === 409) {
        setStatus(targets.monthStatus, COPY.monthNotReady);
        return;
      }
      setStatus(targets.monthStatus, COPY.somethingWrong);
    })();
  });
  return node;
}

export function downloadCopyLink(targets: DayActionTargets): HTMLAnchorElement {
  const href = `/api/crew/${targets.crewId}/months/${targets.month()}/copy.pdf`;
  const node = el('a', { href, download: `seafarer-copy-${targets.month()}.pdf` }, [
    'Download my copy',
  ]);
  gate(node);
  const region = targets.role === 'owner_master' ? targets.feedback : targets.dayStatus;
  node.addEventListener('click', (event) => {
    event.preventDefault();
    if (offline()) {
      setStatus(region, COPY.downloadOffline);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(href);
        if (response.status === 503) {
          setStatus(region, COPY.documentArchiveDown);
          return;
        }
        if (!response.ok) {
          setStatus(region, COPY.somethingWrong);
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = el('a', { href: url, download: `seafarer-copy-${targets.month()}.pdf` });
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      } catch {
        setStatus(region, COPY.downloadOffline);
      }
    })();
  });
  return node;
}
