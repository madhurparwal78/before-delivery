import type { ApprovalLinkResponse } from '../../shared/types.js';
import { clusterTime } from '../../shared/zone.js';
import { ApiCallFailed, get } from '../api.js';
import { copy } from '../copy.js';
import { el, mount } from '../dom.js';

function valueCell(value: unknown): HTMLElement {
  if (value === null || value === undefined) return el('td', { class: 'mono' }, ['—']);
  const text = String(value);
  return el('td', { class: 'mono' }, [
    text === copy.redacted ? el('span', { class: 'redacted' }, [text]) : text,
  ]);
}

/** The approval link page works without a session, and shows only an expiry once it lapses. */
export async function renderApprovalLink(token: string): Promise<void> {
  let link: ApprovalLinkResponse;
  try {
    link = await get<ApprovalLinkResponse>(`/api/approval-links/${encodeURIComponent(token)}`);
  } catch (cause) {
    const expired = cause instanceof ApiCallFailed && cause.failure.code === 'link_expired';
    mount(
      el('main', { class: 'approval' }, [
        el('div', { class: 'approval__panel' }, [
          el('h1', {}, [
            expired ? 'This approval link has expired.' : 'This approval link does not exist.',
          ]),
        ]),
      ]),
    );
    return;
  }

  mount(
    el('main', { class: 'approval' }, [
      el('div', { class: 'approval__panel' }, [
        el('h1', {}, ['Approval requested']),
        el('dl', {}, [
          el('dt', {}, ['Project']),
          el('dd', {}, [link.project]),
          el('dt', {}, ['Stage']),
          el('dd', {}, [link.stage]),
          el('dt', {}, ['Version']),
          el('dd', { class: 'mono' }, [link.bundle.version]),
          el('dt', {}, ['Digest']),
          el('dd', { class: 'mono' }, [link.bundle.short_digest]),
          el('dt', {}, ['Requested by']),
          el('dd', {}, [link.requested_by]),
          el('dt', {}, ['Request expires']),
          el('dd', { class: 'mono' }, [clusterTime(link.request_expires_at, link.time_zone)]),
        ]),
        el('h2', {}, ['Diff']),
        el('table', { 'aria-label': 'Diff' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', {}, ['Resource']),
              el('th', {}, ['Path']),
              el('th', {}, ['Change']),
              el('th', {}, ['Before']),
              el('th', {}, ['After']),
            ]),
          ]),
          el(
            'tbody',
            {},
            link.diff.map((entry) =>
              el('tr', {}, [
                el('td', { class: 'mono' }, [entry.resource]),
                el('td', { class: 'mono' }, [entry.path === '' ? '—' : entry.path]),
                el('td', {}, [entry.change]),
                valueCell(entry.before),
                valueCell(entry.after),
              ]),
            ),
          ),
        ]),
        el(
          'p',
          {},
          [
            el(
              'a',
              {
                class: 'rail__link',
                href: `/projects/${link.project}?stage=${encodeURIComponent(link.stage)}&promotion=${link.promotion_id}`,
              },
              ['Open in Keelson'],
            ),
          ],
        ),
      ]),
    ]),
  );
}
