import { ApiFailure, api, type OrganiserRow, type RosterRow, type SpeakerView } from '../api.js';
import { EMPTY_COPY, FIELD_COPY, PENDING_COPY, SUCCESS_COPY, refusalCopy } from '../copy.js';
import { el, liveRegion, markup, say } from '../dom.js';
import { openDialog } from '../dialog.js';
import { navigate, type Page } from '../router.js';
import { currentAccount } from '../session.js';
import { instantDayClockLabel, rangeLabel } from '../venueTime.js';
import { startLiveRefresh } from '../live.js';
import { markField } from '../components/form.js';

export function organiserPage(): Page {
  const element = el('main', { class: 'page page-organiser', id: 'main' });
  const organiserRegion = liveRegion('Organiser messages');
  const tableHost = el('div', { class: 'organiser-table-host' });
  const rosterHost = el('div', { class: 'roster-host' });
  const biosHost = el('section', { class: 'bios-panel', role: 'region', 'aria-label': 'Speaker bios' });
  const contestHost = el('section', { class: 'contest-panel' });

  let rows: OrganiserRow[] = [];
  let speakers: SpeakerView[] = [];
  let chosenSpeaker: SpeakerView | null = null;
  let storedBio = '';
  let openRoster: string | null = null;
  let rosterRows: RosterRow[] = [];
  let nextPage: string | null = null;
  let bioBox: HTMLTextAreaElement | null = null;

  function draftUnsaved(): boolean {
    return bioBox !== null && chosenSpeaker !== null && bioBox.value !== storedBio;
  }

  function paintTable(): void {
    const head = el('tr', {}, [
      ...['Title', 'Day', 'Time', 'Capacity', 'Reserved', 'Held', 'Seats left', 'Waitlisted'].map((label) =>
        el('th', { scope: 'col', text: label }),
      ),
      el('th', { scope: 'col' }, [el('span', { class: 'visually-hidden', text: 'Roster' })]),
    ]);
    const body = el('tbody', {});
    for (const row of rows) {
      const view = el('button', {
        class: 'button',
        type: 'button',
        'aria-label': `View roster for ${row.title}`,
        text: 'View roster',
      });
      view.addEventListener('click', () => {
        void loadRoster(row.id, true);
      });
      body.appendChild(
        el('tr', {}, [
          el('td', { 'data-label': 'Title', text: row.title }),
          el('td', { 'data-label': 'Day', text: String(row.day) }),
          el('td', { 'data-label': 'Time', text: rangeLabel(row.start_local, row.end_local) }),
          el('td', { 'data-label': 'Capacity', text: String(row.seats.capacity) }),
          el('td', { 'data-label': 'Reserved', text: String(row.seats.reserved) }),
          el('td', { 'data-label': 'Held', text: String(row.seats.held) }),
          el('td', { 'data-label': 'Seats left', text: String(row.seats.left) }),
          el('td', { 'data-label': 'Waitlisted', text: String(row.waitlisted) }),
          el('td', {}, [view]),
        ]),
      );
    }
    tableHost.replaceChildren(
      el('table', { class: 'organiser-table', 'aria-label': 'Reservable sessions' }, [el('thead', {}, [head]), body]),
    );
  }

  async function loadRoster(sessionId: string, moveFocus: boolean): Promise<void> {
    openRoster = sessionId;
    try {
      const answer = await api.roster(`/api/v2/organiser/sessions/${encodeURIComponent(sessionId)}/roster?limit=50`);
      rosterRows = [...answer.value];
      nextPage = readNextPage(answer.headers.get('link'));
    } catch (error) {
      say(organiserRegion, refusalCopy(error instanceof ApiFailure ? error.code : 'outage'));
      return;
    }
    paintRoster(moveFocus, 0);
  }

  function readNextPage(link: string | null): string | null {
    if (link === null) return null;
    const match = /^<([^>]+)>;\s*rel="next"$/.exec(link.trim());
    return match?.[1] ?? null;
  }

  function paintRoster(moveFocus: boolean, appendedFrom: number): void {
    if (openRoster === null) return;
    const row = rows.find((candidate) => candidate.id === openRoster);
    const title = row?.title ?? openRoster;
    const heading = el('h2', { tabindex: '-1', text: `Roster for ${title}` });
    const panel = el('section', { class: 'roster-panel', role: 'region', 'aria-label': `Roster for ${title}` }, [heading]);
    if (rosterRows.length === 0) {
      panel.appendChild(el('p', { class: 'empty-line', text: EMPTY_COPY.roster }));
    } else {
      panel.appendChild(
        el('table', { class: 'roster-table' }, [
          el('thead', {}, [
            el('tr', {}, ['Name', 'Email', 'Reserved at'].map((label) => el('th', { scope: 'col', text: label }))),
          ]),
          el(
            'tbody',
            {},
            rosterRows.map((entry, index) =>
              el('tr', { tabindex: '-1', 'data-roster-index': String(index) }, [
                el('td', { 'data-label': 'Name', text: entry.name }),
                el('td', { 'data-label': 'Email', text: entry.email }),
                el('td', { 'data-label': 'Reserved at', text: instantDayClockLabel(entry.reserved_at) }),
              ]),
            ),
          ),
        ]),
      );
    }
    let showMore: HTMLButtonElement | null = null;
    if (nextPage !== null) {
      showMore = el('button', { class: 'button', type: 'button', text: 'Show more reserved attendees' });
      showMore.addEventListener('click', () => {
        void appendPage(showMore as HTMLButtonElement);
      });
      panel.appendChild(showMore);
    }
    const download = el('button', {
      class: 'button',
      type: 'button',
      'aria-label': `Download roster for ${title}`,
      text: 'Download roster',
    });
    download.addEventListener('click', () => {
      void downloadRoster(openRoster as string);
    });
    panel.appendChild(download);
    panel.appendChild(capacityForm(row));
    rosterHost.replaceChildren(panel);
    if (moveFocus) heading.focus();
    else if (appendedFrom > 0 && nextPage === null) {
      panel.querySelector<HTMLElement>(`tr[data-roster-index="${appendedFrom}"]`)?.focus();
    } else if (appendedFrom > 0) showMore?.focus();
  }

  async function appendPage(button: HTMLButtonElement): Promise<void> {
    if (nextPage === null) return;
    button.setAttribute('aria-disabled', 'true');
    say(organiserRegion, PENDING_COPY.showMore);
    const from = rosterRows.length;
    try {
      const answer = await api.roster(nextPage);
      rosterRows = [...rosterRows, ...answer.value];
      nextPage = readNextPage(answer.headers.get('link'));
      const added = answer.value.length;
      say(
        organiserRegion,
        added === 1 ? '1 more reserved attendee shown.' : `${added} more reserved attendees shown.`,
      );
      paintRoster(false, from);
    } catch (error) {
      say(organiserRegion, refusalCopy(error instanceof ApiFailure ? error.code : 'outage'));
      button.removeAttribute('aria-disabled');
    }
  }

  async function downloadRoster(sessionId: string): Promise<void> {
    say(organiserRegion, PENDING_COPY.download);
    try {
      const file = await api.rosterCsv(sessionId);
      const url = URL.createObjectURL(file.blob);
      const anchor = el('a', { href: url, download: file.filename });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      say(organiserRegion, SUCCESS_COPY.download);
    } catch (error) {
      say(organiserRegion, refusalCopy(error instanceof ApiFailure ? error.code : 'outage'));
    }
  }

  function capacityForm(row: OrganiserRow | undefined): HTMLElement {
    const input = el('input', {
      class: 'text-input',
      id: 'capacity-input',
      type: 'text',
      inputmode: 'numeric',
      value: row === undefined ? '' : String(row.seats.capacity),
    });
    const error = el('p', { class: 'field-error', id: 'capacity-error' });
    const form = el('form', { class: 'capacity-form', novalidate: true }, [
      el('div', { class: 'field' }, [el('label', { for: 'capacity-input', text: 'Capacity' }), input, error]),
      el('button', { class: 'button button-primary', type: 'submit', text: 'Save capacity' }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const typed = input.value.trim();
      const value = Number(typed);
      if (!/^\d+$/.test(typed) || value < 1 || value > 500) {
        markField(input, error, FIELD_COPY.capacity);
        return;
      }
      markField(input, error, null);
      void (async () => {
        say(organiserRegion, PENDING_COPY.capacity);
        try {
          await api.setCapacity(openRoster as string, value);
          say(organiserRegion, SUCCESS_COPY.capacity);
          await loadTable();
          await loadRoster(openRoster as string, false);
        } catch (failure) {
          const error_ = failure instanceof ApiFailure ? failure : new ApiFailure('outage', 0);
          say(organiserRegion, refusalCopy(error_.code, { reserved: error_.reserved ?? 0 }));
        }
      })();
    });
    return form;
  }

  function paintBios(): void {
    const picker = el('select', { class: 'filter-select', id: 'speaker-picker' });
    for (const speaker of speakers) {
      picker.appendChild(el('option', { value: speaker.slug, text: speaker.name }));
    }
    if (chosenSpeaker !== null) picker.value = chosenSpeaker.slug;
    picker.addEventListener('change', () => {
      const wanted = picker.value;
      const move = (): void => {
        chooseSpeaker(wanted);
      };
      if (draftUnsaved()) {
        picker.value = chosenSpeaker?.slug ?? wanted;
        askDiscard(picker, move);
        return;
      }
      move();
    });

    const box = el('textarea', { class: 'bio-box', id: 'bio-box', rows: '8' });
    box.value = chosenSpeaker?.bio ?? '';
    bioBox = box;
    const error = el('p', { class: 'field-error', id: 'bio-error' });
    const preview = el('div', { class: 'bio-preview', role: 'region', 'aria-label': 'Bio preview' });
    if (chosenSpeaker !== null) preview.appendChild(markup('div', 'bio-rendered', chosenSpeaker.bio_html));

    const form = el('form', { class: 'bio-form', novalidate: true }, [
      el('div', { class: 'field' }, [el('label', { for: 'bio-box', text: 'Bio' }), box, error]),
      el('button', { class: 'button button-primary', type: 'submit', text: 'Save bio' }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if ([...box.value].length > 2000) {
        markField(box, error, FIELD_COPY.bio);
        return;
      }
      markField(box, error, null);
      void (async () => {
        say(organiserRegion, PENDING_COPY.bio);
        try {
          const saved = await api.saveBio((chosenSpeaker as SpeakerView).slug, box.value);
          speakers = speakers.map((speaker) => (speaker.slug === saved.slug ? saved : speaker));
          chosenSpeaker = saved;
          storedBio = saved.bio;
          say(organiserRegion, SUCCESS_COPY.bio);
          paintBios();
        } catch (failure) {
          say(organiserRegion, refusalCopy(failure instanceof ApiFailure ? failure.code : 'outage'));
        }
      })();
    });

    biosHost.replaceChildren(
      el('h2', { text: 'Speaker bios' }),
      el('div', { class: 'field' }, [
        el('label', { for: 'speaker-picker', text: 'Speaker' }),
        el('div', { class: 'select-wrap' }, [picker, el('span', { class: 'icon icon-chevron', 'aria-hidden': 'true' })]),
      ]),
      el('div', { class: 'bio-columns' }, [form, preview]),
    );
  }

  function chooseSpeaker(slug: string): void {
    chosenSpeaker = speakers.find((speaker) => speaker.slug === slug) ?? null;
    storedBio = chosenSpeaker?.bio ?? '';
    paintBios();
  }

  function askDiscard(opener: HTMLElement, proceed: () => void): void {
    const name = chosenSpeaker?.name ?? 'this speaker';
    const keep = el('button', { class: 'button', type: 'button', text: 'Keep editing' });
    const discard = el('button', { class: 'button button-primary', type: 'button', text: 'Discard changes' });
    const panel = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Discard unsaved bio?' }, [
      el('h2', { text: 'Discard unsaved bio?' }),
      el('p', { text: `Your changes to ${name}'s bio are not saved.` }),
      el('div', { class: 'dialog-actions' }, [keep, discard]),
    ]);
    const handle = openDialog(panel, keep, opener, () => undefined);
    keep.addEventListener('click', () => handle.close());
    discard.addEventListener('click', () => {
      storedBio = bioBox?.value ?? storedBio;
      handle.close();
      proceed();
    });
  }

  function paintContest(): void {
    const input = el('input', { class: 'text-input', id: 'final-figure', type: 'text', inputmode: 'numeric' });
    const error = el('p', { class: 'field-error', id: 'final-figure-error' });
    const form = el('form', { class: 'stack-form', novalidate: true }, [
      el('div', { class: 'field' }, [el('label', { for: 'final-figure', text: 'Final figure' }), input, error]),
      el('button', { class: 'button button-primary', type: 'submit', text: 'Reveal result' }),
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const typed = input.value.trim();
      const value = Number(typed);
      if (!/^\d+$/.test(typed) || value < 1 || value > 100_000_000) {
        markField(input, error, FIELD_COPY.guess);
        return;
      }
      markField(input, error, null);
      void (async () => {
        say(organiserRegion, PENDING_COPY.reveal);
        try {
          await api.reveal(value);
          say(organiserRegion, SUCCESS_COPY.reveal);
        } catch (failure) {
          say(organiserRegion, refusalCopy(failure instanceof ApiFailure ? failure.code : 'outage'));
        }
      })();
    });
    contestHost.replaceChildren(el('h2', { text: 'Call the number' }), form);
  }

  async function loadTable(): Promise<void> {
    rows = await api.organiserSessions();
    paintTable();
  }

  let stopLive: (() => void) | null = null;

  return {
    element,
    confirmLeave: (proceed: () => void) => {
      if (!draftUnsaved()) return true;
      askDiscard(bioBox as HTMLElement, proceed);
      return false;
    },
    mount: () => {
      const account = currentAccount();
      if (account === null) {
        navigate(`/signin?next=${encodeURIComponent('/organiser')}`, { replace: true });
        return;
      }
      if (account.role !== 'organiser') {
        element.append(
          el('h1', { text: 'Organiser' }),
          el('p', { class: 'notice', text: refusalCopy('forbidden') }),
        );
        return;
      }
      element.appendChild(el('p', { class: 'loading', text: 'Loading' }));
      void (async () => {
        try {
          await loadTable();
          speakers = await api.speakers();
          chosenSpeaker = speakers[0] ?? null;
          storedBio = chosenSpeaker?.bio ?? '';
        } catch {
          rows = [];
        }
        element.replaceChildren(
          el('h1', { text: 'Organiser' }),
          el('p', { class: 'helper-line', text: 'Run the rooms, the speaker pages and the contest.' }),
          organiserRegion,
          tableHost,
          rosterHost,
          biosHost,
          contestHost,
        );
        paintTable();
        paintBios();
        paintContest();
        window.addEventListener('beforeunload', guardUnload);
        stopLive = startLiveRefresh(async () => {
          await loadTable();
        });
      })();
    },
    unmount: () => {
      stopLive?.();
      window.removeEventListener('beforeunload', guardUnload);
    },
  };

  function guardUnload(event: BeforeUnloadEvent): void {
    if (!draftUnsaved()) return;
    event.preventDefault();
  }
}
