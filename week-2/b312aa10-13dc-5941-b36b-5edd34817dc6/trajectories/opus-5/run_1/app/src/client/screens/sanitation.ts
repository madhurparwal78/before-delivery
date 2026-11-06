import { monthLabel } from '../../shared/calendar.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, del, get, post } from '../api.js';
import { el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';

type Entry = {
  id: string;
  area: string;
  task: string;
  sanitizerPpm: number | null;
  initials: string;
  notes: string;
  localDate: string;
  localTime: string;
  loggedBy: string;
};

type Report = { month: string; status: 'stored' | 'queued'; storedAt: string | null };

type Link = {
  id: string;
  email: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  lastAccessAt: string | null;
  views: number;
  downloads: number;
};

const areas = [
  'Prep stations',
  'Ovens and ranges',
  'Walk-in cooler',
  'Dish area',
  'Floors and drains',
];

function instantLabel(instant: string): string {
  return `${instant.slice(0, 10)} ${instant.slice(11, 16)}`;
}

export function sanitationScreen(context: ScreenContext): Screen {
  const isOperator = context.session!.user.role === 'operator';
  let destroyed = false;
  const busy = new Set<string>();

  const areaSelect = el('select', {}, areas.map((area) => el('option', { value: area, text: area })));
  areaSelect.setAttribute('aria-label', 'Area');
  const taskInput = el('input', { type: 'text' });
  const ppmInput = el('input', { type: 'number', min: '0', max: '400' });
  const initialsInput = el('input', { type: 'text' });
  const notesInput = el('input', { type: 'text' });
  const logButton = el('button', { type: 'button', text: 'Log entry' });
  const errors = {
    area: fieldError(),
    task: fieldError(),
    sanitizerPpm: fieldError(),
    initials: fieldError(),
    notes: fieldError(),
  };
  const logTable = el('table', { 'aria-label': 'Sanitation log' });

  const element = el('div', { class: 'sanitation-screen' }, [
    el('div', { class: 'log-form' }, [
      labelled('Area', areaSelect, errors.area),
      labelled('Task', taskInput, errors.task),
      labelled('Sanitizer ppm', ppmInput, errors.sanitizerPpm),
      labelled('Initials', initialsInput, errors.initials),
      labelled('Notes', notesInput, errors.notes),
      logButton,
    ]),
    logTable,
  ]);

  on(logButton, 'click', () => {
    void (async () => {
      for (const holder of Object.values(errors)) {
        holder.hidden = true;
        holder.textContent = '';
      }
      const body: Record<string, unknown> = {
        area: areaSelect.value,
        task: taskInput.value,
        initials: initialsInput.value,
      };
      if (ppmInput.value.trim().length > 0) {
        body['sanitizerPpm'] = Number.parseInt(ppmInput.value, 10);
      }
      if (notesInput.value.length > 0) body['notes'] = notesInput.value;
      logButton.setAttribute('disabled', '');
      logButton.setAttribute('aria-busy', 'true');
      context.announce('Logging\u2026');
      try {
        await post('/api/sanitation-entries', body);
        context.announce('Logged.');
        taskInput.value = '';
        notesInput.value = '';
        await loadEntries();
      } catch (error) {
        if (error instanceof AbandonedError) return;
        if (error instanceof ApiError) {
          const fields = error.fieldErrors();
          const controls: Record<string, HTMLElement> = {
            area: areaSelect,
            task: taskInput,
            sanitizerPpm: ppmInput,
            initials: initialsInput,
            notes: notesInput,
          };
          for (const [key, holder] of Object.entries(errors)) {
            const message = fields[key];
            if (message) setFieldError(controls[key]!, holder, message);
          }
          context.showAlert(
            error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
          );
        } else if (error instanceof NetworkError) {
          context.showAlert(networkCopy);
        }
      } finally {
        logButton.removeAttribute('disabled');
        logButton.removeAttribute('aria-busy');
      }
    })();
  });

  async function loadEntries(): Promise<void> {
    try {
      const result = await get<{ entries: Entry[] }>('/api/sanitation-entries');
      if (destroyed) return;
      replace(logTable, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Date' }),
          el('th', { text: 'Time' }),
          el('th', { text: 'Area' }),
          el('th', { text: 'Task' }),
          el('th', { text: 'Sanitizer' }),
          el('th', { text: 'Initials' }),
          el('th', { text: 'Notes' }),
          el('th', { text: 'Logged by' }),
        ])),
        el(
          'tbody',
          {},
          result.body.entries.map((entry) =>
            el('tr', {}, [
              el('td', { text: entry.localDate }),
              el('td', { text: entry.localTime }),
              el('td', { text: entry.area }),
              el('td', { text: entry.task }),
              el('td', { text: entry.sanitizerPpm === null ? '' : `${entry.sanitizerPpm} ppm` }),
              el('td', { text: entry.initials }),
              el('td', { text: entry.notes }),
              el('td', { text: entry.loggedBy }),
            ]),
          ),
        ),
      ]);
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof NetworkError) context.showAlert(networkCopy);
    }
  }

  let reportTable: HTMLElement | null = null;
  let linksTable: HTMLElement | null = null;
  let linkTimer: number | null = null;

  if (isOperator) {
    const reportMonth = el('input', { type: 'text' });
    const reportError = fieldError();
    const generateButton = el('button', { type: 'button', text: 'Generate monthly PDF' });
    reportTable = el('table', { 'aria-label': 'Monthly PDFs' });
    element.appendChild(
      el('div', { class: 'pdf-panel' }, [
        labelled('Report month', reportMonth, reportError),
        generateButton,
        reportTable,
      ]),
    );
    on(generateButton, 'click', () => {
      void (async () => {
        setFieldError(reportMonth, reportError, null);
        const month = reportMonth.value.trim();
        generateButton.setAttribute('disabled', '');
        generateButton.setAttribute('aria-busy', 'true');
        context.announce('Saving PDF\u2026');
        try {
          const result = await post<{ report: Report }>('/api/sanitation-reports', { month });
          context.announce(
            result.body.report.status === 'stored'
              ? `Sanitation PDF for ${monthLabel(month)} saved.`
              : `Storage is unavailable. The sanitation PDF for ${monthLabel(month)} is queued and will be saved when storage returns.`,
          );
          if (result.status === 202) void context.refreshBanner();
          await loadReports();
        } catch (error) {
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const message = error.fieldErrors()['month'];
            if (message) setFieldError(reportMonth, reportError, message);
            context.showAlert(message ?? error.copy);
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          generateButton.removeAttribute('disabled');
          generateButton.removeAttribute('aria-busy');
        }
      })();
    });

    const emailInput = el('input', { type: 'text' });
    const expiryInput = el('input', { type: 'text' });
    const emailError = fieldError();
    const expiryError = fieldError();
    const sendButton = el('button', { type: 'button', text: 'Send link' });
    linksTable = el('table', { 'aria-label': 'Inspector links' });
    element.appendChild(
      el('div', { class: 'links-panel' }, [
        labelled('Inspector email', emailInput, emailError),
        labelled('Link expires', expiryInput, expiryError),
        sendButton,
        linksTable,
      ]),
    );

    on(sendButton, 'click', () => {
      void (async () => {
        setFieldError(emailInput, emailError, null);
        setFieldError(expiryInput, expiryError, null);
        sendButton.setAttribute('disabled', '');
        sendButton.setAttribute('aria-busy', 'true');
        context.announce('Sending\u2026');
        try {
          const result = await post<{ link: Link }>('/api/inspector-links', {
            email: emailInput.value.trim(),
            expiresAt: toInstant(expiryInput.value.trim()),
          });
          context.announce(
            `Link sent to ${result.body.link.email}, active until ${instantLabel(result.body.link.expiresAt)}.`,
          );
          await loadLinks();
        } catch (error) {
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const fields = error.fieldErrors();
            if (fields['email']) setFieldError(emailInput, emailError, fields['email']);
            if (fields['expiresAt']) setFieldError(expiryInput, expiryError, fields['expiresAt']);
            context.showAlert(
              error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
            );
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          sendButton.removeAttribute('disabled');
          sendButton.removeAttribute('aria-busy');
        }
      })();
    });
  }

  /** "YYYY-MM-DD HH:MM" in kitchen time, sent with the kitchen's offset. */
  function toInstant(text: string): string {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(text);
    if (!match) return text;
    const offset = kitchenOffset();
    return `${match[1]}T${match[2]}:00${offset}`;
  }

  function kitchenOffset(): string {
    const zone = context.session!.kitchen.timeZone;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'longOffset',
    });
    const part = formatter
      .formatToParts(new Date())
      .find((candidate) => candidate.type === 'timeZoneName');
    const raw = part?.value ?? 'GMT+00:00';
    return raw.replace('GMT', '') || '+00:00';
  }

  async function loadReports(): Promise<void> {
    if (!reportTable) return;
    try {
      const result = await get<{ reports: Report[] }>('/api/sanitation-reports');
      if (destroyed) return;
      replace(reportTable, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Month' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'Download' }),
        ])),
        el(
          'tbody',
          {},
          result.body.reports.map((report) =>
            el('tr', {}, [
              el('td', { text: monthLabel(report.month) }),
              el('td', { text: report.status === 'stored' ? 'Saved' : 'Queued' }),
              el('td', {}, report.status === 'stored'
                ? el('a', {
                    href: `/api/sanitation-reports/${report.month}/file`,
                    text: `Sanitation PDF ${monthLabel(report.month)}`,
                  })
                : null),
            ]),
          ),
        ),
      ]);
    } catch {
      // The next action reloads it.
    }
  }

  /** Redraws Status, Last opened, Views and Downloads in place. */
  async function loadLinks(): Promise<void> {
    if (!linksTable) return;
    try {
      const result = await get<{ links: Link[] }>('/api/inspector-links');
      if (destroyed) return;
      const focusedName = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
      replace(linksTable, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: 'Email' }),
          el('th', { text: 'Expires' }),
          el('th', { text: 'Status' }),
          el('th', { text: 'Last opened' }),
          el('th', { text: 'Views' }),
          el('th', { text: 'Downloads' }),
          el('th', { text: 'Actions' }),
        ])),
        el(
          'tbody',
          {},
          result.body.links.map((link) => {
            const revoke = el('button', {
              type: 'button',
              text: 'Revoke',
              'aria-label': `Revoke link for ${link.email}`,
            });
            const regenerate = el('button', {
              type: 'button',
              text: 'Regenerate',
              'aria-label': `Regenerate link for ${link.email}`,
            });
            for (const [button, key] of [
              [revoke, `revoke:${link.id}`],
              [regenerate, `regenerate:${link.id}`],
            ] as const) {
              if (busy.has(key)) {
                button.setAttribute('disabled', '');
                button.setAttribute('aria-busy', 'true');
              }
            }
            on(revoke, 'click', () => void revokeLink(link, revoke));
            on(regenerate, 'click', () => void regenerateLink(link, regenerate));
            return el('tr', {}, [
              el('td', { text: link.email }),
              el('td', { text: instantLabel(link.expiresAt) }),
              el('td', {
                text:
                  link.status === 'active'
                    ? 'Active'
                    : link.status === 'expired'
                      ? 'Expired'
                      : 'Revoked',
              }),
              el('td', { text: link.lastAccessAt === null ? 'Never' : instantLabel(link.lastAccessAt) }),
              el('td', { text: String(link.views) }),
              el('td', { text: String(link.downloads) }),
              el('td', {}, [revoke, regenerate]),
            ]);
          }),
        ),
      ]);
      if (focusedName) {
        linksTable
          .querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedName)}"]`)
          ?.focus();
      }
    } catch {
      // The next poll tries again.
    }
  }

  async function revokeLink(link: Link, button: HTMLElement): Promise<void> {
    busy.add(`revoke:${link.id}`);
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    context.announce('Revoking\u2026');
    try {
      await del(`/api/inspector-links/${link.id}`);
      busy.delete(`revoke:${link.id}`);
      context.announce('Link revoked.');
      await loadLinks();
    } catch (error) {
      busy.delete(`revoke:${link.id}`);
      if (error instanceof ApiError) context.showAlert(error.copy);
    }
  }

  async function regenerateLink(link: Link, button: HTMLElement): Promise<void> {
    busy.add(`regenerate:${link.id}`);
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    context.announce('Sending\u2026');
    try {
      await post(`/api/inspector-links/${link.id}/regenerate`, {});
      busy.delete(`regenerate:${link.id}`);
      context.announce(`New link sent to ${link.email}. The old link no longer works.`);
      await loadLinks();
    } catch (error) {
      busy.delete(`regenerate:${link.id}`);
      if (error instanceof ApiError) context.showAlert(error.copy);
    }
  }

  void loadEntries();
  if (isOperator) {
    void loadReports();
    void loadLinks();
    linkTimer = window.setInterval(() => void loadLinks(), 8000);
  }
  context.setHourBank(null);

  return {
    element,
    destroy: () => {
      destroyed = true;
      if (linkTimer !== null) window.clearInterval(linkTimer);
    },
  };
}
