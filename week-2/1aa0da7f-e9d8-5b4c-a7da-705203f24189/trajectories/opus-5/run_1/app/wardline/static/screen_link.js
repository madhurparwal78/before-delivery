/** The link collection page: no account, one release, one column. */

import { blobDigest, get, post, saveBlob } from './api.js';
import { announce, clear, el } from './dom.js';
import { notFoundPage } from './app.js';

export default {
  async mount(context) {
    const token = window.location.pathname.slice(3);
    const host = context.page;
    const reply = await get(`/api/links/${encodeURIComponent(token)}`);
    if (reply.status !== 200) {
      notFoundPage(host);
      return {};
    }
    const release = reply.body;
    const status = el('p', {
      role: 'status',
      'aria-label': 'Collection status',
      'aria-live': 'polite',
    });
    const list = el('ul', { 'aria-label': 'Release items' });
    const heading =
      release.recipient_kind === 'counsel'
        ? `Disclosure for matter ${release.matter_ref}`
        : 'Your disclosure';
    const page = el('div', { class: 'linkpage' }, [
      el('span', { dataset: { figure: 'true' }, text: String(release.items.length) }),
      el('span', { dataset: { figureLabel: 'true' }, text: 'Items' }),
      el('h1', { text: heading }),
      el('p', { class: 'mono', text: release.reference }),
      el('p', { class: 'mono', text: release.matter_ref }),
      list,
      status,
    ]);
    host.append(page);

    for (const item of release.items) {
      const button = el('button', {
        type: 'button',
        text: `Collect ${item.label}`,
        on: { click: () => collect(item, button) },
      });
      list.append(
        el('li', {}, [
          el('span', { text: item.label }),
          ' ',
          el('span', { class: 'digest', text: item.sha256 }),
          ' ',
          el('span', { class: 'mono', text: String(item.size) }),
          ' ',
          button,
        ])
      );
    }

    async function collect(item, button) {
      status.classList.remove('refusal');
      status.classList.remove('verified');
      announce(status, `Preparing ${item.label}.`);
      const grant = await post(
        `/api/links/${encodeURIComponent(token)}/items/${item.id}/grant`,
        {}
      );
      if (grant.status === 404) {
        clear(host);
        notFoundPage(host);
        return;
      }
      if (grant.status === 429) {
        const wait = grant.headers ? grant.headers.get('retry-after') : '60';
        status.classList.add('refusal');
        announce(status, `Collection paused. Try again in ${wait || '60'} seconds.`);
        return;
      }
      if (grant.status === 503) {
        status.classList.add('refusal');
        announce(status, 'Collection unavailable. Exhibit storage is unreachable.');
        return;
      }
      if (grant.status !== 201) {
        announce(status, 'Collection unavailable. Exhibit storage is unreachable.');
        return;
      }
      const file = await get(`/api/download/${grant.body.token}`, { blob: true });
      if (!(file.body instanceof Blob)) {
        status.classList.add('refusal');
        announce(status, 'This file failed its digest check. Nothing was saved.');
        return;
      }
      const digest = await blobDigest(file.body);
      if (digest === null) {
        saveBlob(file.body, `${item.label}.bin`);
        announce(status, `Collected ${item.label}. Digest not checked in this browser.`);
        return;
      }
      if (digest !== item.sha256) {
        status.classList.add('refusal');
        announce(status, 'This file failed its digest check. Nothing was saved.');
        return;
      }
      saveBlob(file.body, `${item.label}.bin`);
      status.classList.add('verified');
      announce(status, `Collected ${item.label}. Digest matches.`);
    }

    return {};
  },
};
