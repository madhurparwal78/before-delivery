import { api, ApiError, errorCopy } from './api.js';
import { h, qs, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney } from '../shared/bases.js';
import { member } from './shell.js';

// ---------------- stores ----------------

export async function storesScreen(ws: string, slug: string): Promise<HTMLElement> {
  const yachtRes = await api<any>(`/api/w/${ws}/yachts/${slug}`);
  const search = h('input', { type: 'search', 'aria-label': 'Search stores', placeholder: 'Search stores' });
  const list = h('ul', { 'aria-label': 'Stores', style: 'list-style:none;padding:0' });
  const msgBox = h('div', {});
  let latestQuery = 0;

  const load = async (cursor: string | null) => {
    const myQuery = ++latestQuery;
    const params = new URLSearchParams();
    if (search.value) params.set('q', search.value);
    if (cursor) params.set('cursor', cursor);
    const data = await api<any>(`/api/w/${ws}/yachts/${slug}/stores?${params}`);
    if (myQuery !== latestQuery) return null; // an older answer: drop it
    return data;
  };

  const render = async (append: boolean) => {
    const data = await load(null);
    if (data === null) return;
    if (!append) list.textContent = '';
    list.textContent = '';
    for (const item of data.items) {
      const li = h('li', { class: 'card', style: 'display:flex;gap:0.8rem;align-items:center;justify-content:space-between;flex-wrap:wrap' },
        h('span', {}, h('a', { href: `/w/${ws}/yachts/${slug}/store/${item.id}` }, item.name), h('span', { class: 'num', style: 'margin-left:0.6rem' }, `${item.onHandQty} ${item.unit} on hand`)),
      );
      const log = h('button', {}, `Log movement for ${item.name}`);
      log.addEventListener('click', () => {
        openDialog('Log movement', (panel, ctrl) => {
          const radios = ['received', 'used', 'spoiled'].map((k, i) =>
            h('label', { style: 'display:block;margin:0.3rem 0' },
              h('input', { type: 'radio', name: 'kind', value: k, checked: i === 0 ? '' : null }),
              k === 'received' ? 'Received' : k === 'used' ? 'Used' : 'Spoiled'));
          const qty = h('input', { type: 'number', 'aria-label': 'Quantity', min: '1', value: '1' });
          const err2 = h('div', {});
          const btn = h('button', { class: 'primary' }, 'Log movement');
          const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Logging movement';
            announce('Logging movement');
            const kind = (panel.querySelector('input[name="kind"]:checked') as HTMLInputElement).value;
            try {
              const res = await api<any>(`/api/w/${ws}/yachts/${slug}/store/${item.id}/movements`, {
                method: 'POST',
                body: JSON.stringify({ kind, quantity: Number(qty.value) }),
              });
              const copy = `Logged ${qty.value} ${item.unit} ${kind} — ${res.item.onHandQty} ${item.unit} on hand.`;
              ctrl.close();
              const savedBox = h('p', { class: 'msg ok', role: 'status' }, copy);
              msgBox.textContent = '';
              msgBox.append(savedBox);
              announce(copy);
              await render(false);
              msgBox.textContent = '';
              msgBox.append(savedBox);
            } catch (err) {
              const e = err as ApiError;
              btn.disabled = false;
              btn.textContent = 'Log movement';
              const copy = errorCopy(e, { unit: item.unit });
              err2.textContent = '';
              err2.append(h('p', { class: 'msg err' }, copy.message));
              announce(copy.message);
            }
          });
          panel.append(
            h('h2', {}, `Log movement for ${item.name}`),
            h('fieldset', {}, h('legend', {}, 'Movement'), ...radios),
            h('div', { class: 'field' }, h('label', {}, 'Quantity'), qty),
            err2,
            h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
          );
        }, { sheet: window.innerWidth < 1024 });
      });
      li.append(log);
      list.append(li);
    }
    if (data.items.length === 0) {
      list.append(h('li', { class: 'empty' }, 'No items match.'));
    }
    return data.nextCursor;
  };
  await render(false);
  search.addEventListener('input', () => { void render(false); });

  const moreBtn = h('button', {}, 'Load more');
  moreBtn.style.display = 'none';
  const refreshMore = (cursor: string | null) => {
    moreBtn.style.display = cursor ? '' : 'none';
  };

  const addItem = h('button', { class: 'primary' }, 'Add item');
  addItem.addEventListener('click', () => {
    openDialog('Add item', (panel, ctrl) => {
      const name = h('input', { 'aria-label': 'Item name' });
      const unit = h('input', { 'aria-label': 'Unit', value: 'bottles' });
      const category = h('select', { 'aria-label': 'Category' },
        h('option', { value: 'provisions' }, 'Provisions'),
        h('option', { value: 'drinks' }, 'Drinks'),
        h('option', { value: 'cleaning' }, 'Cleaning'),
        h('option', { value: 'engine_room' }, 'Engine room'),
        h('option', { value: 'safety' }, 'Safety'));
      const err2 = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Add item');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Adding item';
        announce('Adding item');
        try {
          const res = await api<any>(`/api/w/${ws}/yachts/${slug}/store`, {
            method: 'POST',
            body: JSON.stringify({ name: name.value, unit: unit.value, category: category.value }),
          });
          const copy = `${res.item.name} added.`;
          announce(copy);
          ctrl.close();
          location.href = `/w/${ws}/yachts/${slug}/store/${res.item.id}`;
        } catch (err) {
          const e = err as ApiError;
          btn.disabled = false;
          btn.textContent = 'Add item';
          const copy = errorCopy(e, { name: name.value });
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Add item'),
        h('div', { class: 'field' }, h('label', {}, 'Item name'), name),
        h('div', { class: 'field' }, h('label', {}, 'Unit'), unit),
        h('div', { class: 'field' }, h('label', {}, 'Category'), category),
        err2,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  });

  return h('div', {},
    h('h1', {}, `${yachtRes.yacht.name} stores`),
    h('div', { style: 'display:flex;gap:0.7rem;align-items:center;margin-bottom:0.8rem' }, search, addItem),
    list,
    moreBtn,
    msgBox,
  );
}

export async function storeItemScreen(ws: string, slug: string, id: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/yachts/${slug}/store/${id}`);
  const item = data.item;
  const msgBox = h('div', {});
  const remove = h('button', { class: 'danger' }, 'Remove item');
  remove.addEventListener('click', () => {
    openDialog('Remove item', (panel, ctrl) => {
      const keep = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Keep item');
      const removeBtn = h('button', { class: 'danger' }, 'Remove item');
      removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        removeBtn.textContent = 'Removing item';
        announce('Removing item');
        try {
          await api(`/api/w/${ws}/yachts/${slug}/store/${id}`, { method: 'DELETE' });
          const copy = `${item.name} removed.`;
          announce(copy);
          ctrl.close();
          location.href = `/w/${ws}/yachts/${slug}/stores`;
        } catch (err) {
          const e = err as ApiError;
          removeBtn.disabled = false;
          removeBtn.textContent = 'Remove item';
          const copy = errorCopy(e, { name: item.name });
          panel.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(h('h2', {}, `Remove ${item.name}?`), h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, keep, removeBtn));
    });
  });
  return h('div', {},
    h('h1', {}, item.name),
    h('div', { class: 'card' },
      h('p', { class: 'num' }, `Received ${item.receivedQty} ${item.unit}`),
      h('p', { class: 'num' }, `Used ${item.usedQty} ${item.unit}`),
      h('p', { class: 'num' }, `Spoiled ${item.spoiledQty} ${item.unit}`),
      h('p', { class: 'num' }, `${item.onHandQty} ${item.unit} on hand`),
    ),
    h('p', {}, h('a', { href: `/w/${ws}/yachts/${slug}/stores` }, 'Back to stores')),
    remove,
    msgBox,
  );
}

// ---------------- energy ----------------

export async function energyScreen(ws: string, slug: string): Promise<HTMLElement> {
  const yachtRes = await api<any>(`/api/w/${ws}/yachts/${slug}`);
  const [daysRes, logsRes] = await Promise.all([
    api<any>(`/api/w/${ws}/yachts/${slug}/energy-days`),
    api<any>(`/api/w/${ws}/yachts/${slug}/energy-logs`),
  ]);
  const msgBox = h('div', {});

  const chart = h('div', { class: 'card' });
  const drawChart = () => {
    const days = daysRes.days;
    if (days.length === 0) {
      chart.textContent = 'No logs yet.';
      return;
    }
    const W = 700;
    const H = 200;
    const barW = Math.max(8, Math.min(40, (W - 40) / days.length - 6));
    const maxSolar = Math.max(...days.map((d: any) => d.solarKwh), 1);
    const x = (i: number) => 20 + i * ((W - 40) / Math.max(1, days.length));
    const yBar = (s: any) => H - 30 - (s.solarKwh / maxSolar) * (H - 70);
    const yCharge = (p: number) => H - 30 - (p / 100) * (H - 70);
    const bars = days.map((d: any, i: number) => `<rect x="${x(i)}" y="${yBar(d)}" width="${barW}" height="${H - 30 - yBar(d)}" fill="var(--amber)" opacity="0.85"/>`).join('');
    const line = days.map((d: any, i: number) => `${i === 0 ? 'M' : 'L'} ${x(i) + barW / 2} ${yCharge(d.endChargePct)}`).join(' ');
    const line2 = days.map((d: any, i: number) => `${i === 0 ? 'M' : 'L'} ${x(i) + barW / 2} ${yCharge(d.lowestChargePct)}`).join(' ');
    chart.innerHTML = `<h3>Charge and solar by day</h3>
      <svg class="ribbon" viewBox="0 0 ${W} ${H}" role="img" aria-label="Charge and solar by day" style="width:100%;height:auto">
        <line x1="0" y1="${yCharge(20)}" x2="${W}" y2="${yCharge(20)}" stroke="var(--brick)" stroke-dasharray="6 5" stroke-width="1.5"/>
        ${bars}
        <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2"/>
        <path d="${line2}" fill="none" stroke="var(--ink-soft)" stroke-width="1.5" stroke-dasharray="4 3"/>
      </svg>
      <div class="chart-legend"><span>▮ solar yield</span><span>— end charge</span><span>--- lowest charge</span><span>- - 20% reserve</span></div>`;
  };
  drawChart();

  const dayTable = h('table', { 'aria-label': 'Energy by day' });
  {
    const tbody = h('tbody', {});
    if (daysRes.days.length === 0) tbody.append(h('tr', {}, h('td', { colspan: '5' }, 'No logs yet.')));
    for (const d of daysRes.days) {
      tbody.append(h('tr', {},
        h('td', {}, d.date),
        h('td', { class: 'num' }, `${d.startChargePct}%`),
        h('td', { class: 'num' }, `${d.endChargePct}%`),
        h('td', { class: 'num' }, `${d.lowestChargePct}%`),
        h('td', { class: 'num' }, `${d.solarKwh.toFixed(1)} kWh`),
      ));
    }
    dayTable.append(h('thead', {}, h('tr', {}, ...['Date', 'Start charge', 'End charge', 'Lowest charge', 'Solar yield'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
  }

  const logsTable = h('table', { 'aria-label': 'Uploaded logs' });
  {
    const tbody = h('tbody', {});
    if (logsRes.logs.length === 0) tbody.append(h('tr', {}, h('td', { colspan: '4' }, 'No logs yet.')));
    for (const l of logsRes.logs) {
      tbody.append(h('tr', {},
        h('td', {}, l.fileName),
        h('td', { class: 'num' }, `${l.sizeBytes}`),
        h('td', { class: 'num' }, fmtDateTime(daysRes.base, { ms: Date.parse(l.uploadedAt) })),
        h('td', {}, l.uploadedBy),
      ));
    }
    logsTable.append(h('thead', {}, h('tr', {}, ...['File', 'Size', 'Uploaded', 'By'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
  }

  const upload = h('button', { class: 'primary' }, 'Upload daily log');
  upload.addEventListener('click', () => {
    openDialog('Upload daily log', (panel, ctrl) => {
      const file = h('input', { type: 'file', 'aria-label': 'Log file', id: 'ul-file' });
      const err2 = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Upload log');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        const f = (file as HTMLInputElement).files?.[0];
        if (!f) {
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, 'This field is required.'));
          return;
        }
        if (f.size > 2000000) {
          const copy = 'That log is larger than 2,000,000 bytes.';
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy));
          announce(copy);
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Uploading log';
        announce('Uploading log');
        const form = new FormData();
        form.append('log', f);
        try {
          const res = await api<any>(`/api/w/${ws}/yachts/${slug}/energy-logs`, { method: 'POST', body: form });
          const copy = `Log uploaded — ${res.log.dayCount} day${res.log.dayCount === 1 ? '' : 's'} charted.`;
          ctrl.close();
          message('ok', copy, msgBox);
          announce(copy);
          location.reload();
        } catch (err) {
          const e = err as ApiError;
          btn.disabled = false;
          btn.textContent = 'Upload log';
          const copy = errorCopy(e);
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Upload daily log'),
        h('div', { class: 'field' }, h('label', { for: 'ul-file' }, 'Log file'), file),
        err2,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  });

  return h('div', {},
    h('h1', {}, `${yachtRes.yacht.name} energy`),
    msgBox,
    h('div', { class: 'two-col' },
      h('div', {}, chart, h('h2', {}, 'Energy by day'), dayTable),
      h('div', {}, h('h2', {}, 'Uploaded logs'), logsTable, h('div', { style: 'height:1rem' }), upload),
    ),
  );
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}
