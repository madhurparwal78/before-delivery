/* Link collection: no account, one release's signed-off items (DP-61 to DP-66). */
(function () {
  const token = location.pathname.split('/')[2] || '';
  const host = document.getElementById('link-content');

  (async () => {
    const res = await WL.api('GET', `/api/links/${encodeURIComponent(token)}`);
    if (!res.ok) {
      host.innerHTML = `
        <div class="figure-block" style="margin-left:0"><div data-figure>404</div><span data-figure-label>Address</span></div>
        <h2 style="font-family:var(--sans);font-weight:600">Nothing to show at this address.</h2>`;
      document.title = 'Unavailable — Wardline';
      return;
    }
    const data = res.data;
    document.title = data.name + ' — Wardline';
    const heading = data.recipient_kind === 'counsel'
      ? `Disclosure for matter ${data.matter_ref}` : 'Your disclosure';
    host.innerHTML = `
      <div class="figure-block" style="margin-left:0">
        <div data-figure>${data.items.length}</div><span data-figure-label>Items</span>
      </div>
      <h2 style="font-family:var(--sans);font-weight:600" id="link-heading">${WL.escapeHtml(heading)}</h2>
      <ul id="release-items" role="list" aria-label="Release items">
        ${data.items.map((it) => `<li style="border-bottom:1px solid var(--ink);padding:10px 0">
          <span class="mono">${WL.escapeHtml(it.label)}</span> — <span class="mono">${it.size} bytes</span>
          <button class="ghost" data-collect="${it.id}" style="margin-left:12px">Collect ${WL.escapeHtml(it.label)}</button>
        </li>`).join('')}
      </ul>
      <div role="status" aria-label="Collection status" id="collection-status"></div>`;
    const status = document.getElementById('collection-status');

    host.querySelectorAll('[data-collect]').forEach((b) =>
      b.addEventListener('click', async () => {
        const item = data.items.find((i) => i.id === b.dataset.collect);
        status.textContent = `Preparing ${item.label}.`;
        const grant = await WL.api('POST',
          `/api/links/${encodeURIComponent(token)}/items/${encodeURIComponent(item.id)}/grant`, {});
        if (!grant.ok) {
          const e = grant.data && grant.data.error;
          if (e === 'throttled') {
            status.textContent = `Collection paused. Try again in ${grant.res.headers.get('Retry-After') || 60} seconds.`;
          } else if (e === 'storage_unavailable') {
            status.textContent = 'Collection unavailable. Exhibit storage is unreachable.';
          } else {
            status.textContent = 'Collection unavailable. Exhibit storage is unreachable.';
          }
          return;
        }
        const fileRes = await fetch(`/api/download/${grant.data.token}`, { credentials: 'same-origin' });
        if (!fileRes.ok) {
          status.textContent = 'Collection unavailable. Exhibit storage is unreachable.';
          return;
        }
        const blob = await fileRes.blob();
        if (WL.hasCrypto) {
          const digest = await WL.sha256Hex(await blob.arrayBuffer());
          if (digest !== item.sha256) {
            status.textContent = 'This file failed its digest check. Nothing was saved.';
            return;
          }
          saveBlob(blob, item);
          status.textContent = `Collected ${item.label}. Digest matches.`;
          status.classList.add('verified-col');
        } else {
          saveBlob(blob, item);
          status.textContent = `Collected ${item.label}. Digest not checked in this browser.`;
        }
      }));
  })();

  function saveBlob(blob, item) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${item.id}.bin`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
})();
