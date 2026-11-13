import { ApiFailure, Me, api, cachedIdentity, householdPath, loadIdentity, newIdempotencyKey } from '../api';
import { Screen, onLiveEntry, say } from '../app';
import { el, fieldError, isPending, labelled, pendingButton, textbox } from '../dom';
import { formatDmyHm, formatInstantDisplay, instantWallClock, parseDmy } from '../../../lib/format';
import { formatInstant, wallClockToInstant } from '../../../domain/time';

interface RecordJson {
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

const recordWords: Record<string, string> = {
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

export function recordsScreen(): Screen {
  let stopLive: (() => void) | null = null;
  let recordsTimer = 0;
  let noticesTimer = 0;

  return {
    async mount(main: HTMLElement): Promise<void> {
      const me = (cachedIdentity() ?? (await loadIdentity())) as Me;
      const thisYear = Number.parseInt(me.household.today.slice(0, 4), 10);

      const yearSelect = el('select', { 'aria-label': 'Year' });
      for (let year = thisYear - 2; year <= thisYear + 2; year += 1) {
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
      const createLink = el('button', { type: 'button', class: 'pill', text: 'Create share link' });
      const linkList = el('ul', { role: 'list', class: 'link-list' });
      const linksRegion = el('section', { role: 'region', 'aria-label': 'Share links', class: 'card links-card' }, [
        el('h2', { class: 'card-title', text: 'Share links' }),
        labelled('Label', label),
        labelled('Expires', expires),
        createLink,
        linkList,
      ]);

      const noticeBody = el('tbody', {});
      const noticesRegion = el('section', { role: 'region', 'aria-label': 'Notices', class: 'card notices-card' }, [
        el('h2', { class: 'card-title', text: 'Notices' }),
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
          noticeBody,
        ]),
        el('p', { class: 'mail-state' }),
      ]);

      const logList = el('ul', { role: 'list', 'aria-label': 'Log entries', class: 'log-list' });
      const loadMore = el('button', { type: 'button', class: 'plain-button', text: 'Load more' });
      const logRegion = el('section', { role: 'region', 'aria-label': 'Record log', class: 'card log-card' }, [
        el('h2', { class: 'card-title', text: 'Record log' }),
        logList,
        loadMore,
      ]);

      main.append(el('div', { class: 'records-body' }, [recordsRegion, linksRegion, noticesRegion, logRegion]));

      async function paintRecords(): Promise<void> {
        const result = await api<{ items: RecordJson[] }>('GET', householdPath('/records?limit=50'));
        const items = result.data.items;
        if (items.length === 0) {
          recordList.replaceChildren();
          if (recordStatus.textContent === '') recordStatus.textContent = 'No year records yet.';
        }
        const wanted = new Map(items.map((item) => [item.id, item]));
        for (const node of [...recordList.children] as HTMLElement[]) {
          if (!wanted.has(node.dataset.recordId ?? '')) node.remove();
        }
        for (const item of items) {
          let node = recordList.querySelector<HTMLElement>(`[data-record-id="${item.id}"]`);
          if (!node) {
            node = el('li', { role: 'listitem', class: 'record-item', 'data-record-id': item.id, tabindex: '-1' });
            recordList.append(node);
          }
          const line = `Year ${item.year} — ${recordWords[item.state] ?? item.state} — digest ${item.yearDigest}`;
          const text = node.querySelector('.record-line');
          if (text) text.textContent = line;
          else node.append(el('p', { class: 'record-line', text: line }));
          const focusedAction = node.querySelector<HTMLElement>('button:focus')?.textContent ?? null;
          const actions = node.querySelector('.row-actions') ?? el('div', { class: 'row-actions' });
          actions.replaceChildren();
          if (item.state === 'stored') {
            const download = el('a', { href: '#', class: 'plain-link', text: 'Download PDF' });
            download.addEventListener('click', (event) => {
              event.preventDefault();
              void (async () => {
                const pdf = await api<ArrayBuffer>('GET', householdPath(`/records/${item.id}/pdf`), { raw: true });
                const url = URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
                const anchor = el('a', { href: url, download: `year-record-${item.year}.pdf` });
                anchor.click();
                URL.revokeObjectURL(url);
              })();
            });
            actions.append(download);
          }
          if (item.state === 'failed') {
            const again = el('button', { type: 'button', class: 'plain-button', text: 'Try again' });
            again.addEventListener('click', () => {
              if (isPending(again)) return;
              pendingButton(again, true, 'Retrying...');
              void api('POST', householdPath(`/records/${item.id}/retry`), { idempotencyKey: newIdempotencyKey() })
                .then(() => say('Year record requested.'))
                .catch(() => undefined)
                .finally(() => {
                  pendingButton(again, false, '');
                  void paintRecords();
                });
            });
            actions.append(again);
          }
          if (item.state === 'requested' || item.state === 'rendering') {
            const cancel = el('button', { type: 'button', class: 'plain-button', text: 'Cancel record' });
            cancel.addEventListener('click', () => {
              if (isPending(cancel)) return;
              pendingButton(cancel, true, 'Cancelling...');
              void api('POST', householdPath(`/records/${item.id}/cancel`), { idempotencyKey: newIdempotencyKey() })
                .then(() => {
                  recordStatus.textContent = '';
                  say('Year record cancelled.');
                })
                .catch(() => undefined)
                .finally(() => {
                  pendingButton(cancel, false, '');
                  void paintRecords();
                });
            });
            actions.append(cancel);
          }
          if (!actions.isConnected) node.append(actions);
          if (focusedAction) {
            const again = [...actions.querySelectorAll('button')].find((button) => button.textContent === focusedAction);
            again?.focus();
          }
        }
        const newest = items[0];
        if (newest) {
          if (newest.state === 'requested') {
            recordStatus.textContent =
              newest.waitingOn === 'renderer'
                ? 'The PDF service is down. Your record is waiting and will retry.'
                : newest.waitingOn === 'storage'
                  ? 'Storage is down. Your record is waiting and will retry.'
                  : 'Year record requested.';
          } else if (newest.state === 'rendering') {
            recordStatus.textContent = 'Rendering the year record...';
          } else if (newest.state === 'stored') {
            recordStatus.textContent = 'Year record stored. Download is ready.';
          } else if (newest.state === 'failed') {
            recordStatus.textContent = "The year record couldn't be made. Try again.";
          } else if (newest.state === 'cancelled') {
            recordStatus.textContent = 'Year record cancelled.';
          }
        }
      }

      makeRecord.addEventListener('click', () => {
        if (isPending(makeRecord)) return;
        pendingButton(makeRecord, true, 'Requesting...');
        void api('POST', householdPath('/records'), {
          json: { year: Number.parseInt(yearSelect.value, 10) },
          idempotencyKey: newIdempotencyKey(),
        })
          .then(() => {
            recordStatus.textContent = 'Year record requested.';
            say('Year record requested.');
          })
          .catch((error: unknown) => {
            if (error instanceof ApiFailure) {
              if (error.code === 'record_in_progress') say('A record for that year is already being made.');
              else {
                const field = error.firstFieldError;
                say(field ? field.message : error.problem.title);
              }
            }
          })
          .finally(() => {
            pendingButton(makeRecord, false, '');
            void paintRecords();
          });
      });

      async function paintLinks(): Promise<void> {
        const result = await api<{ items: ShareLinkJson[] }>('GET', householdPath('/share-links?limit=50'));
        const focusedLabel = document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : null;
        const focusedLink = (document.activeElement as HTMLElement | null)?.closest('.link-item')?.getAttribute('data-link-id') ?? null;
        linkList.replaceChildren(
          ...result.data.items.map((link) => {
            const item = el('li', { role: 'listitem', class: 'link-item', tabindex: '-1', 'data-link-id': link.id }, [
              el('p', { text: `${link.label} — expires ${formatInstantDisplay(link.expiresAt, me.household.zone)}` }),
            ]);
            const actions = el('div', { class: 'row-actions' });
            const copy = el('button', { type: 'button', class: 'plain-button', text: 'Copy link' });
            copy.addEventListener('click', () => {
              void navigator.clipboard?.writeText(link.url);
              say('Link created. Anyone with it can see handover times only.');
            });
            const regenerate = el('button', { type: 'button', class: 'plain-button', text: 'Regenerate' });
            regenerate.addEventListener('click', () => {
              if (isPending(regenerate)) return;
              pendingButton(regenerate, true, 'Regenerating...');
              void api('POST', householdPath(`/share-links/${link.id}/regenerate`), {
                idempotencyKey: newIdempotencyKey(),
              })
                .then(() => say('New link made. The old link no longer works.'))
                .catch(() => undefined)
                .finally(() => {
                  pendingButton(regenerate, false, '');
                  void paintLinks();
                });
            });
            const revoke = el('button', { type: 'button', class: 'plain-button', text: 'Revoke' });
            revoke.addEventListener('click', () => {
              if (isPending(revoke)) return;
              pendingButton(revoke, true, 'Revoking...');
              void api('DELETE', householdPath(`/share-links/${link.id}`))
                .then(() => say('Link revoked.'))
                .catch(() => undefined)
                .finally(() => {
                  pendingButton(revoke, false, '');
                  void paintLinks().then(() => {
                    if (!revoke.isConnected) item.focus();
                  });
                });
            });
            if (me.role === 'planning') actions.append(copy, regenerate, revoke);
            else actions.append(copy);
            item.append(actions);
            return item;
          }),
        );
        if (focusedLink && focusedLabel) {
          const item = linkList.querySelector<HTMLElement>(`[data-link-id="${focusedLink}"]`);
          const again = [...(item?.querySelectorAll('button') ?? [])].find((button) => button.textContent === focusedLabel);
          (again ?? item)?.focus();
        }
      }

      createLink.addEventListener('click', () => {
        if (isPending(createLink)) return;
        fieldError(expires, null);
        const match = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}):(\d{2})$/.exec(expires.value.trim());
        const date = match ? parseDmy(match[1] as string) : null;
        if (!match || !date) {
          fieldError(expires, 'Enter a real date as DD/MM/YYYY.');
          return;
        }
        const minuteOfDay = Number.parseInt(match[2] as string, 10) * 60 + Number.parseInt(match[3] as string, 10);
        const resolved = wallClockToInstant(me.household.zone, date, minuteOfDay);
        pendingButton(createLink, true, 'Creating...');
        void api('POST', householdPath('/share-links'), {
          json: { label: label.value, expiresAt: formatInstant(me.household.zone, resolved.epochMs) },
          idempotencyKey: newIdempotencyKey(),
        })
          .then(() => say('Link created. Anyone with it can see handover times only.'))
          .catch((error: unknown) => {
            if (error instanceof ApiFailure) {
              if (error.code === 'planning_parent_only') say('Only the planning parent can do that.');
              else {
                const field = error.firstFieldError;
                if (field) {
                  fieldError(field.field === 'label' ? label : expires, field.message);
                  say(field.message);
                } else {
                  say(error.problem.title);
                }
              }
            }
          })
          .finally(() => {
            pendingButton(createLink, false, '');
            void paintLinks();
          });
      });

      async function paintNotices(): Promise<void> {
        const result = await api<{ items: NoticeJson[]; mail: string }>('GET', householdPath('/notices?limit=50'));
        noticeBody.replaceChildren(
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
        const mailState = noticesRegion.querySelector('.mail-state') as HTMLElement;
        mailState.textContent =
          result.data.mail === 'degraded' ? 'Email is down. Notices are queued and go out when it is back.' : '';
      }

      let loadedTo = 0;
      let moreAvailable = true;

      async function loadLogPage(): Promise<void> {
        const result = await api<{ items: { seq: string; at: string; type: string }[]; next: string | null }>(
          'GET',
          householdPath(`/log?after=${loadedTo}&limit=10`),
        );
        for (const entry of result.data.items) {
          loadedTo = Math.max(loadedTo, Number.parseInt(entry.seq, 10));
          logList.append(
            el('li', {
              role: 'listitem',
              'data-seq': entry.seq,
              text: `${entry.seq} ${entry.type} ${instantWallClock(entry.at).time}`,
            }),
          );
        }
        moreAvailable = result.data.next !== null;
        loadMore.hidden = !moreAvailable;
      }

      loadMore.addEventListener('click', () => {
        void loadLogPage();
      });

      await paintRecords();
      await paintLinks();
      await paintNotices();
      await loadLogPage();

      recordsTimer = window.setInterval(() => {
        void paintRecords();
      }, 2000);
      noticesTimer = window.setInterval(() => {
        void paintNotices();
      }, 2000);
      stopLive = onLiveEntry((entry) => {
        const seq = Number.parseInt(entry.seq, 10);
        if (seq === loadedTo + 1) {
          loadedTo = seq;
          logList.append(
            el('li', {
              role: 'listitem',
              'data-seq': entry.seq,
              text: `${entry.seq} ${entry.type} ${instantWallClock(entry.at).time}`,
            }),
          );
        } else if (seq > loadedTo + 1) {
          moreAvailable = true;
          loadMore.hidden = false;
        }
        void paintRecords();
        void paintLinks();
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
