import { ApiFailure, Me, api, cachedIdentity, faultCopy, householdPath, newIdempotencyKey } from '../api';
import { LogEntry, Screen, onLiveEntry, say } from '../app';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from '../dom';
import {
  formatDmyHm,
  formatInstantDisplay,
  instantWallClock,
  parseDmy,
  parseTimeOfDay,
} from '../../../lib/format';
import { formatInstant, wallClockToInstant } from '../../../domain/time';

interface YearRecordJson {
  id: string;
  year: number;
  state: string;
  attempts: number;
  stepsDone: number;
  waitingOn: string | null;
  failure: string | null;
  yearDigest: string;
  bytes: number | null;
  sha256: string | null;
  requestedAt: string;
  storedAt: string | null;
}

interface ShareLinkJson {
  id: string;
  label: string;
  url: string;
  expiresAt: string;
  createdAt: string;
}

interface NoticeJson {
  id: string;
  kind: string;
  to: string;
  subject: string;
  status: string;
  attempts: number;
  queuedAt: string;
  sentAt: string | null;
}

const yearRecordWords: Record<string, string> = {
  requested: 'Queued',
  rendering: 'Being made',
  stored: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const noticeWords: Record<string, string> = {
  queued: 'Waiting to send',
  sent: 'Sent',
  superseded: 'Replaced',
};

const REFRESH_WHILE_OPEN_MS = 2000;
const LIST_LIMIT = 50;
const LOG_PAGE = 10;
const YEARS_EACH_SIDE = 2;

/** The one sentence in `Record status` for the newest year record. */
function statusCopy(record: YearRecordJson): string {
  switch (record.state) {
    case 'requested':
      if (record.waitingOn === 'renderer') return 'The PDF service is down. Your record is waiting and will retry.';
      if (record.waitingOn === 'storage') return 'Storage is down. Your record is waiting and will retry.';
      return 'Year record requested.';
    case 'rendering':
      return 'Rendering the year record...';
    case 'stored':
      return 'Year record stored. Download is ready.';
    case 'failed':
      return "The year record couldn't be made. Try again.";
    default:
      return 'Year record cancelled.';
  }
}

export function recordsScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let recordsTimer = 0;
  let noticesTimer = 0;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = cachedIdentity() as Me;
      const thisYear = Number.parseInt(me.household.today.slice(0, 4), 10);

      const yearSelect = el('select', { 'aria-label': 'Year' });
      for (let year = thisYear - YEARS_EACH_SIDE; year <= thisYear + YEARS_EACH_SIDE; year += 1) {
        yearSelect.append(el('option', { value: String(year), text: String(year) }));
      }
      yearSelect.value = String(thisYear);
      const makeRecord = el('button', { type: 'button', class: 'pill', text: 'Make year record' });
      const recordList = el('ul', { role: 'list', 'aria-label': 'Year record list', class: 'record-list' });
      const recordStatus = el('p', { role: 'status', 'aria-label': 'Record status', class: 'record-status' });
      const recordsRegion = el('section', { role: 'region', 'aria-label': 'Year records', class: 'card records-card' }, [
        el('h2', { class: 'card-title', text: 'Year records' }),
        labelled('Year', yearSelect),
        makeRecord,
        recordList,
        recordStatus,
      ]);

      const label = textbox('Label');
      const expires = textbox('Expires');
      const createLink = el('button', { type: 'button', class: 'plain-button', text: 'Create share link' });
      const shareLinkList = el('ul', { role: 'list', class: 'link-list' });
      const linksRegion = el('section', { role: 'region', 'aria-label': 'Share links', class: 'card links-card' }, [
        el('h2', { class: 'card-title', text: 'Share links' }),
        labelled('Label', label),
        labelled('Expires', expires),
        createLink,
        shareLinkList,
      ]);

      const noticeRows = el('tbody', {});
      const mailState = el('p', { class: 'mail-state' });
      const noticesRegion = el('section', { role: 'region', 'aria-label': 'Notices', class: 'card notices-card' }, [
        el('h2', { class: 'card-title', text: 'Notices' }),
        el('div', { class: 'ledger-scroller' }, [
          el('table', { 'aria-label': 'Notices', class: 'notices-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { text: 'Sent to' }),
                el('th', { text: 'Subject' }),
                el('th', { text: 'Status' }),
                el('th', { text: 'Queued' }),
                el('th', { text: 'Sent' }),
              ]),
            ]),
            noticeRows,
          ]),
        ]),
        mailState,
      ]);

      const logList = el('ul', { role: 'list', 'aria-label': 'Log entries', class: 'log-list' });
      const loadMore = el('button', { type: 'button', class: 'plain-button', text: 'Load more' });
      const logRegion = el('section', { role: 'region', 'aria-label': 'Record log', class: 'card log-card' }, [
        el('h2', { class: 'card-title', text: 'Record log' }),
        logList,
        loadMore,
      ]);

      main.append(el('div', { class: 'records-body' }, [recordsRegion, linksRegion, noticesRegion, logRegion]));

      /** Runs a button's request; the button says what it is doing, keeps focus and ignores further presses. */
      async function press(button: HTMLButtonElement, pendingText: string, work: () => Promise<void>): Promise<void> {
        if (isPending(button)) return;
        pendingButton(button, true, pendingText);
        try {
          await work();
        } catch (error) {
          say(faultCopy(error));
        } finally {
          pendingButton(button, false, '');
        }
      }

      function downloadButton(record: YearRecordJson): HTMLElement {
        const link = el('a', { href: '#', class: 'plain-link', text: 'Download PDF' });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void (async () => {
            try {
              const pdf = await api<ArrayBuffer>('GET', householdPath(`/records/${record.id}/pdf`), { raw: true });
              const url = URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
              el('a', { href: url, download: `year-record-${record.year}.pdf` }).click();
              URL.revokeObjectURL(url);
            } catch (error) {
              say(faultCopy(error));
            }
          })();
        });
        return link;
      }

      function actionButton(record: YearRecordJson, text: string, pendingText: string, verb: string, done: string): HTMLButtonElement {
        const button = el('button', { type: 'button', class: 'plain-button', text });
        button.addEventListener('click', () => {
          void press(button, pendingText, async () => {
            await api('POST', householdPath(`/records/${record.id}/${verb}`), { idempotencyKey: newIdempotencyKey() });
            say(done);
            await paintRecords();
          });
        });
        return button;
      }

      /** The controls a record offers in its state: download when stored, retry when failed, cancel while open. */
      function actionsFor(record: YearRecordJson): { kind: string; build: () => HTMLElement[] } {
        if (record.state === 'stored') return { kind: 'download', build: () => [downloadButton(record)] };
        if (record.state === 'failed') {
          return { kind: 'retry', build: () => [actionButton(record, 'Try again', 'Retrying...', 'retry', 'Year record requested.')] };
        }
        if (record.state === 'requested' || record.state === 'rendering') {
          return {
            kind: 'cancel',
            build: () => [actionButton(record, 'Cancel record', 'Cancelling...', 'cancel', 'Year record cancelled.')],
          };
        }
        return { kind: 'none', build: () => [] };
      }

      /** Updates a year record in place; its controls are rebuilt only when the controls themselves change. */
      function paintYearRecord(record: YearRecordJson): void {
        let row = recordList.querySelector<HTMLElement>(`[data-record-id="${record.id}"]`);
        if (!row) {
          row = el('li', { role: 'listitem', class: 'record-item', 'data-record-id': record.id, tabindex: '-1' }, [
            el('p', { class: 'record-line' }),
            el('div', { class: 'row-actions' }),
          ]);
          recordList.append(row);
        }
        (row.querySelector('.record-line') as HTMLElement).textContent =
          `Year ${record.year} — ${yearRecordWords[record.state] ?? record.state} — digest ${record.yearDigest}`;
        const actions = actionsFor(record);
        if (row.dataset.actions === `${actions.kind}:${record.id}:${record.state === 'stored' ? record.sha256 : ''}`) return;
        const holdsFocus = row.contains(document.activeElement);
        (row.querySelector('.row-actions') as HTMLElement).replaceChildren(...actions.build());
        row.dataset.actions = `${actions.kind}:${record.id}:${record.state === 'stored' ? record.sha256 : ''}`;
        if (holdsFocus && !row.contains(document.activeElement)) row.focus();
      }

      async function paintRecords(): Promise<void> {
        const result = await api<{ items: YearRecordJson[] }>('GET', householdPath(`/records?limit=${LIST_LIMIT}`));
        const records = result.data.items;
        const present = new Set(records.map((record) => record.id));
        for (const row of [...recordList.children] as HTMLElement[]) {
          if (!present.has(row.dataset.recordId ?? '')) row.remove();
        }
        records.forEach(paintYearRecord);
        const newest = records[0];
        if (newest) recordStatus.textContent = statusCopy(newest);
        else if (recordStatus.textContent === '') recordStatus.textContent = 'No year records yet.';
      }

      makeRecord.addEventListener('click', () => {
        void press(makeRecord, 'Requesting...', async () => {
          await api('POST', householdPath('/records'), {
            json: { year: Number.parseInt(yearSelect.value, 10) },
            idempotencyKey: newIdempotencyKey(),
          });
          recordStatus.textContent = 'Year record requested.';
          say('Year record requested.');
          await paintRecords();
        });
      });

      function shareLinkRow(link: ShareLinkJson): HTMLElement {
        const row = el('li', { role: 'listitem', class: 'link-item', tabindex: '-1', 'data-link-id': link.id }, [
          el('p', { text: `${link.label} — expires ${formatInstantDisplay(link.expiresAt, me.household.zone)}` }),
        ]);
        const actions = el('div', { class: 'row-actions' });
        const copy = el('button', { type: 'button', class: 'plain-button', text: 'Copy link' });
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(link.url);
          say('Link copied.');
        });
        actions.append(copy);
        if (me.role === 'planning') {
          const regenerate = el('button', { type: 'button', class: 'plain-button', text: 'Regenerate' });
          regenerate.addEventListener('click', () => {
            void press(regenerate, 'Regenerating...', async () => {
              await api('POST', householdPath(`/share-links/${link.id}/regenerate`), { idempotencyKey: newIdempotencyKey() });
              say('New link made. The old link no longer works.');
              await paintShareLinks();
            });
          });
          const revoke = el('button', { type: 'button', class: 'plain-button', text: 'Revoke' });
          revoke.addEventListener('click', () => {
            void press(revoke, 'Revoking...', async () => {
              await api('DELETE', householdPath(`/share-links/${link.id}`));
              say('Link revoked.');
              await paintShareLinks();
              if (!revoke.isConnected) shareLinkList.querySelector<HTMLElement>('.link-item')?.focus();
            });
          });
          actions.append(regenerate, revoke);
        }
        row.append(actions);
        return row;
      }

      async function paintShareLinks(): Promise<void> {
        const result = await api<{ items: ShareLinkJson[] }>('GET', householdPath(`/share-links?limit=${LIST_LIMIT}`));
        const focused = document.activeElement as HTMLElement | null;
        const focusedLinkId = focused?.closest('.link-item')?.getAttribute('data-link-id') ?? null;
        const focusedLabel = focused instanceof HTMLButtonElement ? focused.textContent : null;
        shareLinkList.replaceChildren(...result.data.items.map(shareLinkRow));
        if (focusedLinkId) {
          const row = shareLinkList.querySelector<HTMLElement>(`[data-link-id="${focusedLinkId}"]`);
          const again = [...(row?.querySelectorAll('button') ?? [])].find((button) => button.textContent === focusedLabel);
          (again ?? row)?.focus();
        }
      }

      /** `Expires` is a wall clock in the household zone: `DD/MM/YYYY HH:MM`. */
      function expiryInstant(): string | { message: string } {
        const match = /^(\S+) (\S+)$/.exec(expires.value.trim());
        const day = match ? parseDmy(match[1] as string) : null;
        if (!match || !day) return { message: 'Enter a real date as DD/MM/YYYY.' };
        const minuteOfDay = parseTimeOfDay(match[2] as string);
        if (minuteOfDay === null) return { message: 'Enter a time as HH:MM.' };
        const resolved = wallClockToInstant(me.household.zone, day, minuteOfDay);
        if (resolved.resolution === 'gap') return { message: "That time doesn't exist on that date. Choose another." };
        return formatInstant(me.household.zone, resolved.epochMs);
      }

      createLink.addEventListener('click', () => {
        fieldError(expires, null);
        fieldError(label, null);
        const expiresAt = expiryInstant();
        if (typeof expiresAt !== 'string') {
          fieldError(expires, expiresAt.message);
          return;
        }
        void (async () => {
          await press(createLink, 'Creating...', async () => {
            try {
              await api('POST', householdPath('/share-links'), {
                json: { label: label.value, expiresAt },
                idempotencyKey: newIdempotencyKey(),
              });
              say('Link created. Anyone with it can see handover times only.');
              await paintShareLinks();
            } catch (error) {
              const field = error instanceof ApiFailure ? error.firstFieldError : null;
              if (field) fieldError(field.field === 'label' ? label : expires, field.message);
              throw error;
            }
          });
        })();
      });

      async function paintNotices(): Promise<void> {
        const result = await api<{ items: NoticeJson[]; mail: string }>('GET', householdPath(`/notices?limit=${LIST_LIMIT}`));
        noticeRows.replaceChildren(
          ...result.data.items.map((notice) =>
            el('tr', {}, [
              el('td', { text: notice.to }),
              el('td', { text: notice.subject }),
              el('td', { text: noticeWords[notice.status] ?? notice.status }),
              el('td', { text: formatDmyHm(notice.queuedAt) }),
              el('td', { text: notice.sentAt ? formatDmyHm(notice.sentAt) : '' }),
            ]),
          ),
        );
        mailState.textContent =
          result.data.mail === 'degraded' ? 'Email is down. Notices are queued and go out when it is back.' : '';
      }

      function logRow(entry: LogEntry): HTMLElement {
        return el('li', {
          role: 'listitem',
          'data-seq': String(entry.seq),
          text: `${entry.seq} ${entry.type} ${instantWallClock(entry.at).time}`,
        });
      }

      let loadedTo = 0;

      async function loadLogPage(): Promise<void> {
        const result = await api<{ items: LogEntry[]; next: string | null }>(
          'GET',
          householdPath(`/log?after=${loadedTo}&limit=${LOG_PAGE}`),
        );
        for (const entry of result.data.items) {
          loadedTo = Math.max(loadedTo, entry.seq);
          logList.append(logRow(entry));
        }
        loadMore.hidden = result.data.next === null;
      }

      loadMore.addEventListener('click', () => {
        void press(loadMore, 'Loading...', loadLogPage);
      });

      await paintRecords();
      await paintShareLinks();
      await paintNotices();
      await loadLogPage();

      recordsTimer = window.setInterval(() => void paintRecords(), REFRESH_WHILE_OPEN_MS);
      noticesTimer = window.setInterval(() => void paintNotices(), REFRESH_WHILE_OPEN_MS);
      stopLive = onLiveEntry((entry) => {
        if (entry.seq === loadedTo + 1) {
          loadedTo = entry.seq;
          logList.append(logRow(entry));
        } else if (entry.seq > loadedTo + 1) {
          loadMore.hidden = false;
        }
        void paintRecords();
        void paintShareLinks();
        void paintNotices();
      });

      this.dispose = (): void => {
        window.clearInterval(recordsTimer);
        window.clearInterval(noticesTimer);
        stopLive?.();
      };
    },
  };
}
