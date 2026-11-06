// /l/<token>: a link holder collects a release's files, each checked against its digest before saving.

import { api, claimFile, CONNECTION_LOST, ConnectionLost, figure, h, icon, saveBlob, skeletonRows } from '../core.js';
import { hasWebCrypto, sha256Hex } from '../chain.js';
import { notFoundContent, noticeSlot, root } from '../shell.js';

const RETRY_MS = 3000;
const UNAVAILABLE = 'Collection unavailable. Exhibit storage is unreachable.';

export function mount(screen) {
  const token = screen.params[0];
  const main = h('main', { class: 'page link-page' }, skeletonRows());
  root().replaceChildren(noticeSlot, main);

  const showNotFound = () => {
    screen.stop();
    main.replaceChildren(notFoundContent());
  };

  const stopLoading = screen.every(RETRY_MS, async () => {
    const answer = await api('GET', `/api/links/${token}`, { quietSession: true, signal: screen.signal });
    if (answer.status === 404) {
      showNotFound();
      return;
    }
    if (!answer.ok) return;
    stopLoading();
    showLink(main, token, answer.data, showNotFound);
  });
}

function showLink(main, token, link, showNotFound) {
  const status = h('div', { role: 'status', 'aria-label': 'Collection status', class: 'collection-status' });
  let collecting = false;

  function say(copy, tone = '', mark = null) {
    status.className = `collection-status ${tone}`.trim();
    status.replaceChildren(...(mark ? [icon(mark)] : []), copy);
  }

  async function collect({ id, label, sha256 }) {
    if (collecting) return;
    collecting = true;
    say(`Preparing ${label}.`);
    try {
      const grant = await api('POST', `/api/links/${token}/items/${id}/grant`, { body: {}, quietSession: true });
      if (grant.status === 404) {
        showNotFound();
        return;
      }
      if (grant.status === 429) {
        say(`Collection paused. Try again in ${grant.retryAfter} seconds.`, 'refusal', 'refuse');
        return;
      }
      if (!grant.ok) {
        say(UNAVAILABLE, 'refusal', 'refuse');
        return;
      }
      const file = await claimFile(grant.data.token);
      if (file.status === 404) {
        showNotFound();
        return;
      }
      if (!file.ok) {
        say(UNAVAILABLE, 'refusal', 'refuse');
        return;
      }
      if (!hasWebCrypto()) {
        saveBlob(file.blob, file.filename);
        say(`Collected ${label}. Digest not checked in this browser.`);
        return;
      }
      if (await sha256Hex(await file.blob.arrayBuffer()) !== sha256) {
        say('This file failed its digest check. Nothing was saved.', 'refusal', 'refuse');
        return;
      }
      saveBlob(file.blob, file.filename);
      say(`Collected ${label}. Digest matches.`, 'digest-match', 'check');
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      say(CONNECTION_LOST, '', null);
    } finally {
      collecting = false;
    }
  }

  main.replaceChildren(
    figure('Items', link.items.length),
    h('h1', { class: 'link-heading' }, ...(link.recipient_kind === 'counsel' ? ['Disclosure for matter ', h('span', { class: 'heading-id' }, link.matter_ref)] : ['Your disclosure'])),
    h('dl', { class: 'release-facts' },
      h('dt', {}, 'Release'), h('dd', {}, link.name),
      h('dt', {}, 'Reference'), h('dd', { class: 'mono' }, link.reference),
      h('dt', {}, 'Matter'), h('dd', { class: 'mono' }, link.matter_ref)),
    h('ul', { class: 'item-rows', 'aria-label': 'Release items' }, link.items.map((item) => h('li', { class: 'item-row' },
      h('div', { class: 'item-body' },
        h('span', { class: 'item-label' }, item.label),
        h('span', { class: 'mono item-meta' }, `${item.size} bytes`),
        h('span', { class: 'digest' }, item.sha256)),
      h('div', { class: 'button-row item-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => collect(item) }, icon('download'), `Collect ${item.label}`))))),
    status);
}
