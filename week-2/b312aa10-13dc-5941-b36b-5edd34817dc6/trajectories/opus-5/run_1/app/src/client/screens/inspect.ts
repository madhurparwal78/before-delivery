/** The inspector's read-only view: every time and state comes from the server. */
import { monthLabel } from '../../shared/calendar.js';
import { documentStatusWord, documentTypeLabel, type DocumentStatus, type DocumentType } from '../../shared/format.js';
import { ApiError, get } from '../api.js';
import { el, on, replace } from '../dom.js';

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

type Certificate = {
  documentId: string;
  businessName: string;
  type: DocumentType;
  expiryDate: string;
  status: DocumentStatus;
};

type InspectorView = {
  kitchen: { name: string; timeZone: string };
  expiresAt: string;
  sanitationEntries: Entry[];
  sanitationReports: Array<{ month: string }>;
  certificates: Certificate[];
};

const stateCopy = {
  expired: 'This link has expired.',
  revoked: 'This link is no longer active.',
  unknown: 'This link is not valid.',
};

export function inspectorScreen(token: string): { element: HTMLElement } {
  const alertRegion = el('div', { role: 'alert', class: 'live-region alert-region' });
  const body = el('div', { class: 'inspector-body' });
  const element = el('div', { class: 'inspector-screen' }, [alertRegion, body]);

  function showState(copy: string): void {
    replace(body, el('p', { class: 'inspector-state', text: copy }));
  }

  async function load(): Promise<void> {
    try {
      const result = await get<InspectorView>(`/api/inspect/${encodeURIComponent(token)}`);
      draw(result.body);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'link_expired') showState(stateCopy.expired);
        else if (error.code === 'link_revoked') showState(stateCopy.revoked);
        else showState(stateCopy.unknown);
        return;
      }
      showState(stateCopy.unknown);
    }
  }

  function draw(view: InspectorView): void {
    const expires = `${view.expiresAt.slice(0, 10)} ${view.expiresAt.slice(11, 16)}`;
    const log = el('table', { 'aria-label': 'Sanitation log' }, [
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
        view.sanitationEntries.map((entry) =>
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

    const pdfs = el(
      'ul',
      { role: 'list', 'aria-label': 'Monthly PDFs' },
      view.sanitationReports.map((report) => {
        const name = `Sanitation PDF ${monthLabel(report.month)}`;
        const link = el('a', { href: '#', text: name, 'aria-label': name });
        on(link, 'click', (event) => {
          event.preventDefault();
          void download(
            `/api/inspect/${encodeURIComponent(token)}/sanitation-reports/${report.month}/file`,
            `sanitation-${report.month}.pdf`,
          );
        });
        return el('li', { role: 'listitem' }, link);
      }),
    );

    const certificates = el('table', { 'aria-label': 'Member certificates' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Business' }),
        el('th', { text: 'Type' }),
        el('th', { text: 'Expires' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Download' }),
      ])),
      el(
        'tbody',
        {},
        view.certificates.map((certificate) => {
          const name = `Download ${certificate.businessName} ${documentTypeLabel(certificate.type)}`;
          const link = el('a', { href: '#', text: name, 'aria-label': name });
          on(link, 'click', (event) => {
            event.preventDefault();
            void download(
              `/api/inspect/${encodeURIComponent(token)}/documents/${certificate.documentId}/file`,
              `${certificate.documentId}.pdf`,
            );
          });
          return el('tr', {}, [
            el('td', { text: certificate.businessName }),
            el('td', { text: documentTypeLabel(certificate.type) }),
            el('td', { text: certificate.expiryDate }),
            el('td', { text: documentStatusWord(certificate.status) }),
            el('td', {}, link),
          ]);
        }),
      ),
    ]);

    replace(body, [
      el('h1', { class: 'display', text: view.kitchen.name }),
      el('p', {
        text: `Read-only records for ${view.kitchen.name}, available until ${expires}`,
      }),
      log,
      pdfs,
      certificates,
    ]);
  }

  /** Stays on the page: the file is saved only when the answer is 200. */
  async function download(path: string, fileName: string): Promise<void> {
    alertRegion.textContent = '';
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const parsed = (await response.json()) as { error?: string; message?: string };
        if (parsed.error === 'link_expired') showState(stateCopy.expired);
        else if (parsed.error === 'link_revoked') showState(stateCopy.revoked);
        else alertRegion.textContent = parsed.message ?? '';
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = el('a', { href: url, download: fileName });
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      alertRegion.textContent = 'Lineboard could not reach the server. Check the connection and try again.';
    }
  }

  void load();
  return { element };
}
