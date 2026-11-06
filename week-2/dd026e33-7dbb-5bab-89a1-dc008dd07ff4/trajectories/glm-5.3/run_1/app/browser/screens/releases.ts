/**
 * Releases — open and recent releases with the legal actions and the hold
 * label. Rows update in place on a 10-second re-read.
 */
import { api, ApiFailure } from '../api.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { Reread } from '../reread.ts';
import { registerReread } from '../app.ts';
import {
  RELEASES_ROW_HOLD, RELEASE_CANCELLED, SAVING, invoiceUnpaidCopy, belongingsCheckedInCopy,
  mailDownReleaseCopy, releaseBookedCopy, releaseCompletedCopy, releaseStagedCopy,
} from '../../shared/copy.ts';
import type { Screen } from './screen.ts';

interface ReleaseData {
  id: string;
  car: { id: string; name: string };
  owner: { name: string };
  slot_label: string;
  status: string;
  bay_code: string | null;
  held_by: { number: string }[];
}

export function renderReleases(main: HTMLElement): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'release-updates' });
  const body = h('tbody');

  const actionsFor = (release: ReleaseData): HTMLElement[] => {
    const buttons: HTMLElement[] = [];
    const act = (label: string, path: string, run: (fresh: ReleaseData) => string): HTMLButtonElement => {
      const button = h('button', { text: label });
      button.addEventListener('click', async () => {
        announce(region, SAVING);
        try {
          const response = (await api.post(path)) as { release: ReleaseData };
          announce(region, run(response.release));
        } catch (err) {
          if (err instanceof ApiFailure) {
            const detail = err.detail;
            if (detail.code === 'invoice_unpaid') {
              const invoices = (detail.body as { invoices?: { number: string }[] }).invoices ?? [];
              announce(region, invoiceUnpaidCopy(invoices.map((invoice) => invoice.number)));
            } else if (detail.code === 'belongings_checked_in') {
              const items = (detail.body as { items?: { label: string }[] }).items ?? [];
              announce(region, belongingsCheckedInCopy(items.map((item) => item.label)));
            } else if (detail.code === 'mail_unavailable') {
              announce(region, mailDownReleaseCopy());
            } else if (detail.code === 'invalid_transition') {
              announce(region, 'This release has moved on. Reload to see its current state.');
            } else {
              announce(region, detail.code ?? 'Saving failed.');
            }
            void path;
          }
        }
      });
      return button;
    };
    if (release.status === 'requested') {
      buttons.push(act('Book release', `/api/releases/${release.id}/book`, (fresh) => releaseBookedCopy(fresh.car.name, fresh.slot_label)));
    }
    if (release.status === 'booked') {
      buttons.push(act('Car staged', `/api/releases/${release.id}/stage`, (fresh) => releaseStagedCopy(fresh.car.name)));
    }
    if (release.status === 'staged') {
      buttons.push(act('Complete release', `/api/releases/${release.id}/complete`, (fresh) => releaseCompletedCopy(fresh.car.name, fresh.bay_code ?? '')));
    }
    if (['requested', 'booked', 'staged'].includes(release.status)) {
      buttons.push(act('Cancel release', `/api/releases/${release.id}/cancel`, () => RELEASE_CANCELLED));
    }
    return buttons;
  };

  const rowFor = (release: ReleaseData): HTMLElement => {
    const actionsArea = h('div', { class: 'row-flex', 'data-area': 'actions' });
    for (const button of actionsFor(release)) actionsArea.append(button);
    const hold = h('span', { class: 'hold', 'data-area': 'hold' });
    if (release.held_by.length > 0 && !['released', 'cancelled'].includes(release.status)) {
      hold.append(h('span', { class: 'icon', 'aria-hidden': 'true', text: '▲' }), RELEASES_ROW_HOLD);
    }
    return h('tr', null,
      h('td', { text: release.car.name }),
      h('td', { text: release.owner.name }),
      h('td', { 'data-cell': 'slot', text: release.slot_label }),
      h('td', { 'data-cell': 'status', text: release.status }),
      h('td', { 'data-cell': 'bay', text: release.bay_code ?? '' }),
      h('td', null, hold, actionsArea));
  };

  const patchRow = (row: HTMLElement, release: ReleaseData): void => {
    patchText(row.querySelector('[data-cell="slot"]') as HTMLElement, release.slot_label);
    patchText(row.querySelector('[data-cell="status"]') as HTMLElement, release.status);
    patchText(row.querySelector('[data-cell="bay"]') as HTMLElement, release.bay_code ?? '');
    const hold = row.querySelector('[data-area="hold"]') as HTMLElement;
    const held = release.held_by.length > 0 && !['released', 'cancelled'].includes(release.status);
    if (held && hold.textContent === '') {
      hold.append(h('span', { class: 'icon', 'aria-hidden': 'true', text: '▲' }), RELEASES_ROW_HOLD);
    } else if (!held && hold.textContent !== '') {
      hold.replaceChildren();
    }
    // replace the actions to match the legal state, keeping focus in the row
    const hadFocus = row.contains(document.activeElement);
    const focusIndex = hadFocus ? Array.from(row.querySelectorAll('button')).indexOf(document.activeElement as HTMLButtonElement) : -1;
    const actionsArea = row.querySelector('[data-area="actions"]') as HTMLElement;
    actionsArea.replaceChildren(...actionsFor(release));
    if (focusIndex >= 0) {
      const buttons = Array.from(actionsArea.querySelectorAll('button'));
      buttons[Math.min(focusIndex, buttons.length - 1)]?.focus();
    } else if (hadFocus) {
      (row.firstElementChild as HTMLElement).focus?.();
    }
  };

  const fetchReleases = async (): Promise<ReleaseData[] | null> => {
    try {
      const response = (await api.get('/api/releases')) as { releases: ReleaseData[] };
      return response.releases;
    } catch {
      return null;
    }
  };

  const reread = new Reread(async () => {
    const releases = await fetchReleases();
    if (releases) reconcile(body, releases, (release) => release.id, rowFor, patchRow);
  }, 10_000);

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('h1', { text: 'Releases' }),
      region,
      h('table', { class: 'sheet', 'aria-label': 'Releases' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Car' }), h('th', { text: 'Owner' }), h('th', { text: 'Slot' }),
          h('th', { text: 'Status' }), h('th', { text: 'Bay' }), h('th', { text: '' }))),
        body));
    const releases = await fetchReleases();
    if (!releases) return;
    reconcile(body, releases, (release) => release.id, rowFor, patchRow);
    registerReread(reread);
    reread.start();
  };

  return {
    render,
    destroy() {
      reread.stop();
    },
  };
}
