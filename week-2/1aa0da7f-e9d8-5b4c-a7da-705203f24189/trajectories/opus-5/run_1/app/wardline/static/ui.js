/** Shared rendering helpers: live tables, status copy and privileged actions. */

import { announce, el, takeFocus } from './dom.js';
import { stepUp } from './dialog.js';

export const COPY = {
  notFound: 'Nothing to show at this address.',
  noRecord: 'Choose a row to inspect it.',
  accessEnded: 'Your access to this compartment has ended.',
  accessChanged: 'Your access to this compartment has changed to derivatives only.',
  staleAccess: 'Someone else changed this access list. Review it and try again.',
  lastLead: 'This compartment needs another case lead with full access first.',
  staleMarks: 'Someone else changed these marks. Review them and try again.',
  unsavedMarks: 'Save your marks before rendering.',
  releaseChanged: 'This release changed while you were reviewing it. Review it again.',
  alreadyDecided: 'Already decided by someone else.',
  noLonger: 'This action is no longer available.',
  heldDisposal: 'Under legal hold. This exhibit cannot be disposed of.',
  matterHolds: 'This matter already holds this exhibit.',
  sodRelease: 'You worked on this release, so someone else must decide it.',
  sodExhibit: 'You registered this exhibit, so another officer must decide it.',
  sodDisposal: 'You proposed this disposal, so another case lead must confirm it.',
  notCleared: 'This exhibit has not been cleared.',
  sealFailed: 'Not cleared. The stored file no longer matches its seal.',
  storageBanner:
    'Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost.',
  noticeHeld: 'Notice held. It will send when the mail relay returns.',
};

export function setStatus(region, text, refused) {
  if (!region) return;
  region.classList.toggle('refusal', Boolean(refused));
  announce(region, text);
}

export function lapseText(expiresAt) {
  if (!expiresAt) return 'Does not lapse';
  const stamp = String(expiresAt).replace('T', ' ').replace('Z', '');
  return 'Lapses ' + stamp.slice(0, 16) + ' UTC';
}

export function hourMinute(stamp) {
  if (!stamp) return '';
  return String(stamp).slice(11, 16) + ' UTC';
}

/** Replaces only the rows that changed, keeping focus and scroll position. */
export function syncRows(body, items, { key, signature, build, onVanished }) {
  const existing = new Map();
  for (const row of Array.from(body.children)) {
    existing.set(row.dataset.rowKey, row);
  }
  const wanted = new Set();
  let previous = null;
  for (const item of items) {
    const id = String(key(item));
    wanted.add(id);
    const mark = signature(item);
    const current = existing.get(id);
    let row;
    if (current && current.dataset.rowSignature === mark) {
      row = current;
    } else {
      row = build(item);
      row.dataset.rowKey = id;
      row.dataset.rowSignature = mark;
      if (current) {
        current.replaceWith(row);
      }
    }
    if (!row.parentNode) {
      if (previous) {
        previous.after(row);
      } else {
        body.prepend(row);
      }
    } else if (previous && previous.nextSibling !== row) {
      previous.after(row);
    }
    previous = row;
  }
  for (const [id, row] of existing) {
    if (wanted.has(id)) continue;
    const hadFocus = row.contains(document.activeElement);
    row.remove();
    if (hadFocus && onVanished) onVanished(row, body);
  }
}

export function table(label, headings, extra = {}) {
  const head = el(
    'thead',
    {},
    [el('tr', {}, headings.map((heading) => el('th', { scope: 'col', text: heading })))]
  );
  const body = el('tbody');
  const node = el('table', { 'aria-label': label, ...extra }, [head, body]);
  return { node, body };
}

/** Runs a privileged action behind the step-up dialog. */
export async function privileged({ opener, needsReason, run, fallback }) {
  return stepUp({ needsReason, opener, run, fallback });
}

export function moveFocusAfterRemoval(removed, body, selector) {
  const rows = Array.from(body.children);
  const target = rows.length ? rows[rows.length - 1].querySelector(selector) : null;
  if (target) {
    takeFocus(target);
    return;
  }
  takeFocus(body.closest('table'));
}

export function errorCode(reply) {
  return reply && reply.body && reply.body.error ? reply.body.error : null;
}

export function decisionCopy(base, noticeSentence, reply) {
  const held = reply && reply.body && reply.body.notice === 'held';
  return base + ' ' + (held ? COPY.noticeHeld : noticeSentence);
}
