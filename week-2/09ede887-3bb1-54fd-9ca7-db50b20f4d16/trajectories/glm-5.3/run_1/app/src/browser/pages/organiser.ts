/**
 * The organiser page: the reservable sessions table, the roster panel with
 * `Show more` paging and the CSV download, the capacity form, the speaker
 * bios panel with its unsaved-draft prompt, and the contest reveal panel.
 */

import * as api from '../api.js';
import type { OrganiserRow, Speaker } from '../api.js';
import { el, announce } from '../dom.js';
import { state } from '../state.js';
import { route } from '../router.js';
import { navigateToSignIn } from './auth-form.js';
import { trapTab } from '../chrome.js';
import { wallClockText, venueStamp } from '../venue-display.js';

route(/^\/organiser$/, async () => {
  const app = document.getElementById('app') as HTMLElement;
  const main = el('main', { id: 'main' });
  app.textContent = '';
  app.append(main);

  if (state.account === null) {
    navigateToSignIn();
    return;
  }
  if (state.account.role !== 'organiser') {
    main.append(
      el('h1', { class: 'page-title' }, 'Organiser'),
      el('p', { class: 'empty-line' }, 'This page is for the organiser only.'),
    );
    return;
  }

  main.append(el('p', { class: 'loading' }, 'Loading'));
  const messages = el('p', { id: 'organiser-messages', role: 'status', 'aria-live': 'polite', 'aria-label': 'Organiser messages', class: 'live-region' });
  state.organiserMessages = messages;

  const [rows, speakers] = await Promise.all([api.getOrganiserSessions(), api.listSpeakers()]);
  state.speakers = speakers;
  main.textContent = '';
  main.append(el('h1', { class: 'page-title' }, 'Organiser'));

  const table = buildSessionsTable(rows, (row) => openRoster(row));
  const rosterPanel = el('section', { class: 'roster-panel', role: 'region', 'aria-label': 'Roster', hidden: true });
  main.append(table, rosterPanel, buildBiosPanel(speakers), buildContestPanel(), messages);
  state.refresh = async (): Promise<void> => {
    const fresh = await api.getOrganiserSessions().catch(() => null);
    if (fresh === null) return;
    replaceTableBody(table, fresh, (row) => openRoster(row));
  };

  async function openRoster(row: OrganiserRow): Promise<void> {
    const panel = rosterPanel;
    const heading = el('h2', { class: 'roster-heading', tabindex: '-1' }, `Roster for ${row.title}`);
    const body = el('div', { class: 'roster-body' });
    const more = el('button', { type: 'button', class: 'action show-more' }, 'Show more reserved attendees');
    const download = el('button', { type: 'button', class: 'action', 'aria-label': `Download roster for ${row.title}` }, 'Download roster');
    const capacity = el('input', {
      type: 'number', 'aria-label': 'Capacity', class: 'text-input capacity-input',
      min: '1', max: '500', value: String(row.seats?.capacity ?? ''),
    });
    const capacityError = el('p', { class: 'field-error', id: 'capacity-error', hidden: true });
    const saveCapacity = el('button', { type: 'submit', class: 'action action-blue' }, 'Save capacity');
    const capacityForm = el('form', { class: 'capacity-form', novalidate: true },
      capacity, capacityError, saveCapacity);
    panel.removeAttribute('hidden');
    panel.setAttribute('aria-label', `Roster for ${row.title}`);
    panel.textContent = '';
    panel.append(heading, body, more, download, capacityForm);

    // The roster panel refreshes only when it is reopened, so paging stays steady.
    let cursor: string | null = null;
    let hasMore = true;
    const appendPage = async (announceRows: boolean): Promise<void> => {
      const page = await api.rosterPage(row.id, 50, cursor).catch(() => null);
      if (page === null) {
        announce(messages, 'Keel Outpost is not reachable right now. Try again in a moment.');
        return;
      }
      let tbody = body.querySelector('tbody');
      if (tbody === null && page.rows.length > 0) {
        body.append(el('table', { class: 'details-table roster-table', 'aria-label': 'Roster' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Email'), el('th', {}, 'Reserved at'))),
          el('tbody', {}),
        ));
        tbody = body.querySelector('tbody');
      }
      if (page.rows.length === 0 && cursor === null) {
        body.append(el('p', { class: 'empty-line' }, 'No seats reserved yet.'));
      }
      for (const r of page.rows) {
        tbody!.append(el('tr', { tabindex: '-1' },
          el('td', {}, r.name),
          el('td', {}, r.email),
          el('td', {}, venueStamp(r.reserved_at)),
        ));
      }
      if (announceRows && page.rows.length > 0) {
        const copy = page.rows.length === 1
          ? '1 more reserved attendee shown.'
          : `${page.rows.length} more reserved attendees shown.`;
        announce(messages, copy);
      }
      cursor = page.next;
      hasMore = page.next !== null;
      more.classList.toggle('is-hidden', !hasMore);
    };

    more.addEventListener('click', () => {
      more.setAttribute('aria-disabled', 'true');
      more.classList.add('is-pending');
      void appendPage(true).then(() => {
        more.setAttribute('aria-disabled', 'false');
        more.classList.remove('is-pending');
        if (!hasMore) {
          // The last page is in: focus moves to the first row this press added.
          const rowsInBody = Array.from(body.querySelectorAll('tbody tr'));
          rowsInBody[rowsInBody.length - 1]?.querySelector('td')?.focus();
        }
      });
    });

    download.addEventListener('click', async () => {
      download.setAttribute('aria-disabled', 'true');
      download.classList.add('is-pending');
      announce(messages, 'Preparing roster…');
      try {
        await api.downloadRoster(row.id);
        announce(messages, 'Roster downloaded.');
      } catch {
        announce(messages, 'Keel Outpost is not reachable right now. Try again in a moment.');
      }
      download.setAttribute('aria-disabled', 'false');
      download.classList.remove('is-pending');
    });

    capacityForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      capacityError.setAttribute('hidden', '');
      capacity.setAttribute('aria-invalid', 'false');
      const value = Number(capacity.value);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        capacityError.textContent = 'Enter a whole number from 1 to 500.';
        capacityError.removeAttribute('hidden');
        capacity.setAttribute('aria-invalid', 'true');
        return;
      }
      saveCapacity.setAttribute('aria-disabled', 'true');
      saveCapacity.classList.add('is-pending');
      announce(messages, 'Saving capacity…');
      try {
        await api.setCapacity(row.id, value);
        announce(messages, 'Capacity saved.');
        await state.refresh?.();
      } catch (err) {
        const failure = err instanceof api.ApiError ? err.failure : null;
        announce(messages, failure === null
          ? 'Keel Outpost is not reachable right now. Try again in a moment.'
          : failure.code === 'below_reserved'
            ? `Capacity cannot be lower than the ${failure.reserved ?? 0} seats already reserved or held.`
            : 'Keel Outpost is not reachable right now. Try again in a moment.');
      }
      saveCapacity.setAttribute('aria-disabled', 'false');
      saveCapacity.classList.remove('is-pending');
    });

    await appendPage(false);
    heading.focus();
  }
});

function buildSessionsTable(rows: OrganiserRow[], open: (row: OrganiserRow) => void): HTMLElement {
  const table = el('table', { class: 'details-table organiser-table', 'aria-label': 'Reservable sessions' },
    el('thead', {},
      el('tr', {},
        el('th', {}, 'Title'), el('th', {}, 'Day'), el('th', {}, 'Time'),
        el('th', {}, 'Capacity'), el('th', {}, 'Reserved'), el('th', {}, 'Held'),
        el('th', {}, 'Seats left'), el('th', {}, 'Waitlisted'), el('th', {}, ''),
      ),
    ),
    el('tbody', {}),
  );
  fillTableBody(table, rows, open);
  return table;
}

function fillTableBody(table: HTMLElement, rows: OrganiserRow[], open: (row: OrganiserRow) => void): void {
  const tbody = table.querySelector('tbody') as HTMLElement;
  tbody.textContent = '';
  for (const row of rows) {
    const button = el('button', {
      type: 'button', class: 'action',
      'aria-label': `View roster for ${row.title}`,
    }, 'View roster');
    button.addEventListener('click', () => {
      void open(row);
    });
    tbody.append(el('tr', { 'data-session-id': row.id },
      el('td', { class: 'cell-title' }, row.title),
      el('td', {}, String(row.day)),
      el('td', {}, `${wallClockText(row.start_local)} - ${wallClockText(row.end_local)}`),
      el('td', {}, String(row.seats?.capacity ?? '')),
      el('td', {}, String(row.seats?.reserved ?? '')),
      el('td', {}, String(row.seats?.held ?? '')),
      el('td', {}, String(row.seats?.left ?? '')),
      el('td', {}, String(row.waitlisted)),
      el('td', {}, button),
    ));
  }
}

function replaceTableBody(table: HTMLElement, rows: OrganiserRow[], open: (row: OrganiserRow) => void): void {
  fillTableBody(table, rows, open);
}

/** The speaker bios panel, with the unsaved-draft prompt on speaker change. */
function buildBiosPanel(speakers: Speaker[]): HTMLElement {
  const panel = el('section', { class: 'bios-panel', role: 'region', 'aria-label': 'Speaker bios' });
  const select = el('select', { 'aria-label': 'Speaker', class: 'filter-select bio-select' },
    ...speakers.map((s) => el('option', { value: s.slug }, s.name)),
  );
  const box = el('textarea', { 'aria-label': 'Bio', class: 'bio-box', rows: '8' });
  const error = el('p', { class: 'field-error', id: 'bio-error', hidden: true });
  const save = el('button', { type: 'button', class: 'action action-blue' }, 'Save bio');
  const preview = el('div', { class: 'bio-preview', role: 'region', 'aria-label': 'Bio preview' });
  panel.append(el('h2', { class: 'panel-heading' }, 'Speaker bios'), select, box, error, save, preview);

  let stored = '';
  let loading = true;
  /** The speaker whose bio the box shows, so Keep editing can restore them. */
  let chosenSlug = speakers[0]?.slug ?? '';
  const load = (slug: string): void => {
    const speaker = state.speakers.find((s) => s.slug === slug);
    if (speaker === undefined) return;
    chosenSlug = slug;
    stored = speaker.bio;
    box.value = stored;
    preview.textContent = '';
    preview.append(el('div', { class: 'speaker-bio', html: speaker.bio_html }));
  };

  select.addEventListener('change', () => {
    if (loading) return;
    if (box.value !== stored) {
      // Leaving with an unsaved draft asks first. Keep editing keeps the draft
      // and the chosen speaker; Discard changes carries the switch out.
      const chosen = select.value;
      unsavedBioPrompt(nameForSlug(chosenSlug), (keep) => {
        if (keep) {
          select.value = chosenSlug;
          box.focus();
        } else {
          load(chosen);
        }
      });
    } else {
      load(select.value);
    }
  });

  save.addEventListener('click', async () => {
    error.setAttribute('hidden', '');
    box.setAttribute('aria-invalid', 'false');
    if (box.value.length > 2000) {
      error.textContent = 'Use at most 2,000 characters.';
      error.removeAttribute('hidden');
      box.setAttribute('aria-invalid', 'true');
      return;
    }
    save.setAttribute('aria-disabled', 'true');
    save.classList.add('is-pending');
    const messages = state.organiserMessages;
    announce(messages, 'Saving bio…');
    try {
      const updated = await api.saveBio(select.value, box.value);
      stored = updated.bio;
      state.speakers = state.speakers.map((s) => (s.slug === updated.slug ? updated : s));
      preview.textContent = '';
      preview.append(el('div', { class: 'speaker-bio', html: updated.bio_html }));
      announce(messages, 'Bio saved.');
    } catch {
      announce(messages, 'Keel Outpost is not reachable right now. Try again in a moment.');
    }
    save.setAttribute('aria-disabled', 'false');
    save.classList.remove('is-pending');
  });

  // Warn before leaving the page or closing the tab with an unsaved draft.
  window.addEventListener('beforeunload', (event) => {
    if (!loading && box.value !== stored) {
      event.preventDefault();
    }
  });

  loading = false;
  load(select.value);
  return panel;
}

/** The speaker's name, for the unsaved-draft prompt copy. */
function nameForSlug(slug: string): string {
  return state.speakers.find((s) => s.slug === slug)?.name ?? 'the speaker';
}

/** The unsaved bio prompt: a focus-trapping dialog with two answers. */
function unsavedBioPrompt(name: string, answer: (keep: boolean) => void): void {
  const dialog = el('div', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Discard unsaved bio?', class: 'bio-dialog',
  });
  const keep = el('button', { type: 'button', class: 'action action-blue' }, 'Keep editing');
  const discard = el('button', { type: 'button', class: 'action' }, 'Discard changes');
  dialog.append(el('p', { class: 'dialog-copy' }, `Your changes to ${name}'s bio are not saved.`), keep, discard);
  const backdrop = el('div', { class: 'dialog-backdrop' }, dialog);
  document.body.append(backdrop);
  const close = (result: boolean): void => {
    backdrop.remove();
    answer(result);
    if (result) (document.querySelector('.bio-box') as HTMLElement | null)?.focus();
  };
  keep.addEventListener('click', () => close(true));
  discard.addEventListener('click', () => close(false));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
    trapTab(event, dialog);
  });
  keep.focus();
}

/** The contest panel: the final figure form and the one reveal. */
function buildContestPanel(): HTMLElement {
  const panel = el('section', { class: 'contest-panel', role: 'region', 'aria-label': 'Contest' });
  const input = el('input', {
    type: 'number', 'aria-label': 'Final figure', class: 'text-input figure-input',
    min: '1', max: '100000000', id: 'figure-field',
  });
  const error = el('p', { class: 'field-error', id: 'figure-error', hidden: true });
  const button = el('button', { type: 'submit', class: 'action action-blue' }, 'Reveal result');
  const form = el('form', { class: 'figure-form', novalidate: true }, input, error, button);
  panel.append(el('h2', { class: 'panel-heading' }, 'Contest'), form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.setAttribute('hidden', '');
    input.setAttribute('aria-invalid', 'false');
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > 100000000) {
      error.textContent = 'Enter a whole number from 1 to 100,000,000.';
      error.removeAttribute('hidden');
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    button.setAttribute('aria-disabled', 'true');
    button.classList.add('is-pending');
    const messages = state.organiserMessages;
    announce(messages, 'Revealing…');
    try {
      await api.reveal(value);
      announce(messages, 'Result revealed.');
    } catch (err) {
      const failure = err instanceof api.ApiError ? err.failure : null;
      announce(messages, failure?.code === 'already_revealed'
        ? 'The result has already been revealed.'
        : 'Keel Outpost is not reachable right now. Try again in a moment.');
      button.setAttribute('aria-disabled', 'false');
      button.classList.remove('is-pending');
    }
  });
  return panel;
}
