import { el, bannerAlert, openDialog, errorSummary, inlineError } from './ui.js';
import {
  get, post, patch, del, put, clinicTime, clinicFullDate, money,
  SPECIES_LABELS, STATUS_LABELS, initials, ApiRequestFailed,
} from './api.js';
import { renderSplitBand } from './shell.js';
import { announcer, live } from './live.js';
import type { Me } from './shell.js';

// ---------- Patients list ----------

export function renderPatientsScreen(root: HTMLElement, me: Me): void {
  const wrap = el('div', { class: 'page-col' });
  const countEl = el('p', { class: 'clinic-date' });
  const band = renderSplitBand('Patients', el('div', {}, countEl));
  wrap.append(band);
  const section = el('section');
  wrap.append(section);
  root.textContent = '';
  root.append(wrap);

  const load = async (q: string): Promise<void> => {
    const r = await get(`/api/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    countEl.textContent = `${r.patients.length} matching patients`;
    section.textContent = '';
    const search = el('input', {
      class: 'input-pill',
      type: 'search',
      'aria-label': 'Search patients',
      placeholder: 'Search patients',
      value: q,
    }) as HTMLInputElement;
    search.addEventListener('input', () => {
      void load(search.value).then(() => {
        // announce the result count after each keystroke
        void get(`/api/patients${search.value ? `?q=${encodeURIComponent(search.value)}` : ''}`).then((r2) => {
          announcer.say(`${r2.patients.length} patients found.`);
        });
      });
    });
    section.append(search);
    if (r.patients.length === 0) {
      const card = el('div', { class: 'empty-card' });
      card.append(el('p', { class: 'title', text: 'No patients match your search.' }));
      card.append(el('button', { class: 'pill pill-primary', onclick: () => { search.value = ''; void load(''); } }, 'Clear search'));
      section.append(card);
      return;
    }
    const grid = el('ul', { role: 'list', 'aria-label': 'Patient list', style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px;list-style:none;padding:0' });
    const width = window.innerWidth;
    grid.style.gridTemplateColumns = width <= 375 ? '1fr' : width <= 768 ? 'repeat(2,1fr)' : 'repeat(3,1fr)';
    for (const p of r.patients) {
      const li = el('li', { class: 'card', 'aria-label': `${p.name}, ${SPECIES_LABELS[p.species]}` });
      const row = el('div', { style: 'display:flex;gap:12px;align-items:center' });
      row.append(el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(p.name)));
      const mid = el('div', { style: 'flex:1' });
      mid.append(el('strong', { style: 'color:#14212b;font-family:Plus Jakarta Sans,sans-serif' }, p.name));
      const chips = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:4px' });
      chips.append(el('span', { class: 'chip' }, SPECIES_LABELS[p.species]));
      if (p.status) chips.append(el('span', { class: 'chip chip-status' }, p.status));
      mid.append(chips);
      mid.append(el('p', { style: 'margin:4px 0 0;color:#5d6b77;font-size:14px' }, p.clientName));
      row.append(mid);
      row.append(el('a', { class: 'arrow-chip', href: `/patients/${p.id}`, 'aria-label': `Open ${p.name}`, 'data-motion': 'chip-nudge', 'data-motion-ms': '250', 'data-motion-easing': 'ease-in-out' }, '→'));
      li.append(row);
      grid.append(li);
    }
    section.append(grid);
  };

  load('');
}

// ---------- Patient record ----------

export function renderPatientRecord(root: HTMLElement, me: Me, patientId: string, tab: string): void {
  const wrap = el('div', { class: 'page-col' });
  root.textContent = '';
  root.append(wrap);

  const load = async (): Promise<void> => {
    const p = await get(`/api/patients/${patientId}`);
    wrap.textContent = '';
    const band = renderSplitBand(p.name, el('p', { class: 'clinic-date', text: p.clientName }));
    wrap.append(band);
    const chips = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:10px' });
    chips.append(el('span', { class: 'chip' }, SPECIES_LABELS[p.species]));
    if (p.status) chips.append(el('span', { class: 'chip chip-status' }, p.status));
    chips.append(el('span', { class: 'chip' }, `Weight ${p.weightGrams ?? '—'} g`));
    band.querySelector('.band-left')!.append(chips);

    const tabs = el('div', { role: 'tablist', 'aria-label': 'Patient record', style: 'display:flex;gap:6px;flex-wrap:wrap' });
    const panel = el('div');
    wrap.append(tabs, panel);
    const tabKeys = ['overview', 'history', 'files', 'vaccinations'];
    const active = tabKeys.includes(tab) ? tab : 'overview';
    for (const key of tabKeys) {
      const label = key[0].toUpperCase() + key.slice(1);
      const btn = el('button', {
        role: 'tab',
        'aria-selected': String(key === active),
        class: 'btn',
        'aria-controls': 'tabpanel',
        onclick: () => {
          history.replaceState(null, '', `/patients/${patientId}?tab=${key}`);
          void renderTab(key);
          tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', 'false'));
          btn.setAttribute('aria-selected', 'true');
        },
      }, label);
      tabs.append(btn);
    }
    const renderTab = async (key: string): Promise<void> => {
      panel.textContent = '';
      const tp = el('div', { role: 'tabpanel', id: 'tabpanel' });
      panel.append(tp);
      if (key === 'overview') {
        const card = el('div', { class: 'card' });
        card.append(el('h3', { text: 'Weight' }));
        const grams = el('input', { class: 'input-pill', type: 'number', 'aria-label': 'Weight in grams', min: '1', max: '200000' }) as HTMLInputElement;
        const saveBtn = el('button', { class: 'pill pill-primary' }, 'Save weight');
        saveBtn.addEventListener('click', async () => {
          try {
            await post(`/api/patients/${patientId}/weights`, { grams: Number(grams.value) });
            announcer.say('Weight saved.');
            saveBtn.textContent = 'Saved';
          } catch (e) {
            if (e instanceof ApiRequestFailed) tp.prepend(bannerAlert(e.err.message));
          }
        });
        const wRow = el('div', { style: 'display:flex;gap:10px' }, grams, saveBtn);
        card.append(wRow);
        card.append(el('p', { style: 'color:#5d6b77' }, `Client: ${p.clientName}`));
        tp.append(card);
      } else if (key === 'history') {
        const exportLink = el('a', { class: 'pill pill-primary', href: `/api/patients/${patientId}/history.pdf` }, 'Export history PDF');
        tp.append(exportLink);
        if (p.history.length === 0) {
          tp.append(el('p', { style: 'color:#5d6b77' }, 'No completed consults yet.'));
          return;
        }
        const layout = el('div', { style: 'display:grid;grid-template-columns:1fr 1.2fr;gap:16px' });
        if (window.innerWidth <= 768) layout.style.gridTemplateColumns = '1fr';
        const feature = buildFeatureCard(p.history[0]);
        const rows = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
        for (const h of p.history.slice(1)) rows.append(buildHistoryRow(h, p.weights));
        layout.append(feature, rows);
        tp.append(layout);
      } else if (key === 'files') {
        const card = el('div', { class: 'card' });
        card.append(el('h3', { text: 'Files' }));
        const fileForm = el('form');
        const fileInput = el('input', { type: 'file', 'aria-label': 'Add file', accept: '.jpg,.jpeg,.png,.pdf' }) as HTMLInputElement;
        const kindSel = el('select', { class: 'input-pill', 'aria-label': 'File type' }) as HTMLSelectElement;
        for (const [value, label] of [['xray', 'X-ray'], ['wound', 'Wound photo'], ['lab', 'Lab report'], ['consent', 'Consent form'], ['profile', 'Profile photo']]) {
          kindSel.append(new Option(label, value));
        }
        const uploadBtn = el('button', { class: 'pill pill-primary', type: 'submit' }, 'Add file');
        fileForm.append(fileInput, kindSel, uploadBtn);
        fileForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const file = fileInput.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.append('file', file);
          fd.append('kind', kindSel.value);
          uploadBtn.setAttribute('aria-busy', 'true');
          try {
            const res = await fetch(`/api/patients/${patientId}/files`, { method: 'POST', body: fd, credentials: 'same-origin' });
            const data = await res.json();
            if (!res.ok) {
              tp.prepend(bannerAlert(data.message));
              return;
            }
            announcer.say(`${data.name} saved to Files.`);
            void renderTab('files');
          } finally {
            uploadBtn.removeAttribute('aria-busy');
          }
        });
        card.append(fileForm);
        tp.append(card);
        const filesCard = el('div', { class: 'card' });
        const list = el('ul', { role: 'list', 'aria-label': 'Patient files', style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:10px' });
        const filesR = await get(`/api/patients/${patientId}/files`);
        for (const f of filesR.files) {
          const li = el('li', { 'aria-label': `${f.name}, ${fileTypeLabel(f.kind)}` });
          const row = el('div', { style: 'display:flex;gap:12px;align-items:center' });
          if (f.contentType.startsWith('image/')) {
            const img = el('img', { src: f.url, alt: '', style: 'width:56px;height:56px;object-fit:cover;border-radius:8px' });
            row.append(img);
          } else {
            row.append(el('span', { class: 'chip', style: 'min-width:56px;text-align:center' }, 'PDF'));
          }
          const mid = el('div', { style: 'flex:1' });
          mid.append(el('strong', {}, f.name));
          mid.append(el('p', { style: 'margin:0;color:#5d6b77;font-size:13px' }, `${fileTypeLabel(f.kind)} · ${f.sha256.slice(0, 12)}…`));
          row.append(mid);
          row.append(el('a', { class: 'arrow-chip', href: f.url, 'aria-label': `Open ${f.name}` }, '→'));
          li.append(row);
          list.append(li);
        }
        filesCard.append(list);
        tp.append(filesCard);
      } else if (key === 'vaccinations') {
        const card = el('div', { class: 'card' });
        card.append(el('h3', { text: 'Vaccinations' }));
        const list = el('ul', { role: 'list', 'aria-label': 'Vaccinations', style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:10px' });
        for (const v of p.vaccinations) {
          const li = el('li', { 'aria-label': `${v.vaccine}, due ${clinicFullDate(v.dueDate + 'T00:00:00Z')}` });
          const row = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' });
          row.append(el('strong', {}, v.vaccine));
          row.append(el('span', { class: 'chip' }, `due ${clinicFullDate(v.dueDate + 'T00:00:00Z')}`));
          row.append(el('span', { class: 'chip' }, `Reminder: ${v.reminder}`));
          li.append(row);
          list.append(li);
        }
        card.append(list);
        const form = el('form', { class: 'field' });
        const vaccineInput = el('input', { class: 'input-pill', 'aria-label': 'Vaccine', type: 'text' }) as HTMLInputElement;
        const dueInput = el('input', { class: 'input-pill', 'aria-label': 'Due date', type: 'date' }) as HTMLInputElement;
        const addBtn = el('button', { class: 'pill pill-primary', type: 'submit' }, 'Add vaccination');
        form.append(vaccineInput, dueInput, addBtn);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await post(`/api/patients/${patientId}/vaccinations`, { vaccine: vaccineInput.value, dueDate: dueInput.value });
            announcer.say('Vaccination added.');
            void renderTab('vaccinations');
          } catch (err) {
            if (err instanceof ApiRequestFailed) card.prepend(bannerAlert(err.err.message));
          }
        });
        card.append(form);
        tp.append(card);
      }
    };
    void renderTab(active);
  };

  load();
  live.onEvent((event) => {
    if (event === 'patients' || event === 'files' || event === 'tick') load();
  });
}

function fileTypeLabel(kind: string): string {
  return ({ xray: 'X-ray', wound: 'Wound photo', lab: 'Lab report', consent: 'Consent form', profile: 'Profile photo' } as Record<string, string>)[kind] ?? kind;
}

function buildFeatureCard(h: any): HTMLElement {
  const card = el('div', { class: 'tinted-card' });
  card.append(el('p', { style: 'color:#5d6b77;margin:0' }, clinicFullDate(h.start)));
  card.append(el('h3', { text: h.reason }));
  card.append(el('p', { style: 'margin:0;color:#33424e' }, `with ${h.vetName}`));
  if (h.notePreview) card.append(el('p', { style: 'margin:8px 0 0;color:#33424e' }, h.notePreview));
  return card;
}

function buildHistoryRow(h: any, weights: { recordedOn: string; grams: number }[]): HTMLElement {
  const row = el('div', { class: 'card', style: 'border:1px solid #e7e4de;border-radius:10px;display:flex;gap:12px;align-items:center' });
  const spark = buildSparkline(weights);
  row.append(spark);
  const mid = el('div');
  mid.append(el('strong', {}, `${clinicFullDate(h.start)} · ${h.reason}`));
  mid.append(el('p', { style: 'margin:2px 0 0;color:#5d6b77;font-size:14px' }, `with ${h.vetName}`));
  row.append(mid);
  return row;
}

function buildSparkline(weights: { recordedOn: string; grams: number }[]): HTMLElement {
  const tile = el('span', {
    'aria-hidden': 'true',
    style: 'width:56px;height:56px;border-radius:8px;background:#eef4fb;display:inline-flex;align-items:center;justify-content:center;flex:none',
  });
  if (weights.length >= 2) {
    const min = Math.min(...weights.map((w) => w.grams));
    const max = Math.max(...weights.map((w) => w.grams));
    const range = max - min || 1;
    const points = weights
      .map((w, i) => `${(i / (weights.length - 1)) * 48 + 4},${52 - ((w.grams - min) / range) * 44}`)
      .join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '56');
    svg.setAttribute('height', '56');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#2f6fed');
    poly.setAttribute('stroke-width', '2');
    svg.append(poly);
    tile.append(svg);
  } else {
    tile.append(el('span', { class: 'chip' }, '·'));
  }
  return tile;
}

// ---------- Consult screen ----------

export function renderConsultScreen(root: HTMLElement, me: Me, appointmentId: string): void {
  const wrap = el('div', { class: 'page-col' });
  root.textContent = '';
  root.append(wrap);

  const state = {
    paragraphs: [] as { n: number; text: string; version: number; editedBy: string | null }[],
    saving: 0,
  };

  const load = async (): Promise<void> => {
    const [appts, note] = await Promise.all([get('/api/appointments'), get(`/api/appointments/${appointmentId}/note`)]);
    const appt = appts.appointments.find((a: any) => a.id === appointmentId);
    const patientName = appt?.patientName ?? 'Patient';
    wrap.textContent = '';
    const band = renderSplitBand(`Consult: ${patientName}`, el('p', { class: 'clinic-date' }, appt ? `${appt.vetName}, ${clinicTime(appt.start)}` : ''));
    wrap.append(band);

    const layout = el('div', { style: 'display:grid;grid-template-columns:1.4fr 1fr;gap:18px' });
    if (window.innerWidth <= 768) layout.style.gridTemplateColumns = '1fr';
    const noteCol = el('section');
    const sideCol = el('aside');

    const statusLine = el('p', { role: 'status', 'aria-label': 'Note status', text: 'Saved' });
    const parasBox = el('div');
    const addParaBtn = el('button', { class: 'btn' }, 'Add paragraph');

    addParaBtn.addEventListener('click', async () => {
      const created = await post(`/api/appointments/${appointmentId}/note/paragraphs`, { text: '' });
      state.paragraphs.push({ n: created.n, text: created.text, version: created.version, editedBy: created.editedBy });
      void renderParagraphs(true);
    });

    const drafts = new Map<number, string>();

    const renderParagraphs = (focusLast = false): void => {
      parasBox.textContent = '';
      for (const para of state.paragraphs) {
        const field = el('div', { class: 'field' });
        const ta = el('textarea', {
          class: 'input-pill',
          rows: '3',
          'data-paragraph': String(para.n),
          'aria-label': 'Consult note',
        }) as HTMLTextAreaElement;
        ta.value = para.text;
        let saveTimer: number | null = null;
        const save = async (): Promise<void> => {
          if (state.saving > 0) return; // one save in flight per window
          const textNow = ta.value;
          state.saving += 1;
          statusLine.textContent = 'Saving';
          try {
            const saved = await put(`/api/appointments/${appointmentId}/note/paragraphs/${para.n}`, {
              text: textNow,
              version: para.version,
            });
            para.version = saved.version;
            para.text = saved.text;
            // a save answer never replaces text typed after that save was sent
            if (ta.value === textNow) {
              para.text = saved.text;
            }
          } catch (e) {
            if (e instanceof ApiRequestFailed && e.err.error === 'stale_paragraph') {
              drafts.set(para.n, ta.value);
              void reloadNote();
            }
          } finally {
            state.saving -= 1;
            if (state.saving === 0) statusLine.textContent = 'Saved';
          }
        };
        ta.addEventListener('input', () => {
          if (saveTimer) window.clearTimeout(saveTimer);
          saveTimer = window.setTimeout(save, 500);
        });
        ta.addEventListener('blur', () => void save());
        field.append(ta);
        const draft = drafts.get(para.n);
        if (draft !== undefined) {
          const draftBox = el('div', { class: 'card', style: 'margin-top:8px' });
          draftBox.append(el('p', { role: 'alert', text: 'Someone changed this paragraph first. Your text is kept below as a draft.' }));
          const draftTa = el('textarea', { class: 'input-pill', rows: '2', 'aria-label': 'Draft' }) as HTMLTextAreaElement;
          draftTa.value = draft;
          const applyBtn = el('button', { class: 'btn' }, 'Apply draft');
          const discardBtn = el('button', { class: 'btn' }, 'Discard draft');
          applyBtn.addEventListener('click', async () => {
            try {
              const saved = await put(`/api/appointments/${appointmentId}/note/paragraphs/${para.n}`, { text: draftTa.value, version: para.version });
              para.version = saved.version;
              para.text = saved.text;
              drafts.delete(para.n);
              void renderParagraphs();
            } catch (e) {
              if (e instanceof ApiRequestFailed) {
                drafts.set(para.n, draftTa.value);
                draftBox.prepend(bannerAlert(e.err.message));
              }
            }
          });
          discardBtn.addEventListener('click', () => {
            drafts.delete(para.n);
            void renderParagraphs();
          });
          const row = el('div', { style: 'display:flex;gap:8px' }, applyBtn, discardBtn);
          draftBox.append(draftTa, row);
          field.append(draftBox);
        }
        parasBox.append(field);
      }
      if (focusLast) {
        const last = parasBox.querySelector('textarea:last-of-type') as HTMLElement;
        last?.focus();
      }
    };

    noteCol.append(statusLine, parasBox, addParaBtn);

    // side: files + create invoice
    const filesPanel = el('section', { 'aria-label': 'Files for this consult', class: 'card' });
    filesPanel.append(el('h3', { text: 'Files for this consult' }));
    const createInvBtn = el('button', { class: 'pill pill-primary' }, 'Create invoice');
    createInvBtn.addEventListener('click', async () => {
      try {
        const inv = await post('/api/invoices', { patientId: appt?.patientId, appointmentId });
        window.location.href = `/invoices/${inv.id}`;
      } catch (e) {
        if (e instanceof ApiRequestFailed) sideCol.prepend(bannerAlert(e.err.message));
      }
    });
    sideCol.append(filesPanel, createInvBtn);

    layout.append(noteCol, sideCol);
    wrap.append(layout);

    const reloadNote = async (): Promise<void> => {
      const fresh = await get(`/api/appointments/${appointmentId}/note`);
      state.paragraphs = fresh.paragraphs;
      renderParagraphs();
    };

    state.paragraphs = note.paragraphs;
    renderParagraphs();
  };

  load();
  live.onEvent((event) => {
    if (event === 'note') {
      void (async () => {
        const fresh = await get(`/api/appointments/${appointmentId}/note`);
        const active = document.activeElement as HTMLElement;
        const activePara = active?.getAttribute('data-paragraph');
        // another window's change never replaces the text in the paragraph the user edits
        state.paragraphs = fresh.paragraphs;
        void reRenderNoteKeepingEdit(activePara);
      })();
    }
  });

  async function reRenderNoteKeepingEdit(activePara: string | null): Promise<void> {
    const parasBox = wrap.querySelector('[data-paragraph]')?.parentElement?.parentElement as HTMLElement;
    if (!parasBox) return;
    // simplest correct approach: re-render only paragraphs not being edited
    const boxes = Array.from(parasBox.querySelectorAll('.field'));
    boxes.forEach((box, i) => {
      const ta = box.querySelector('textarea') as HTMLTextAreaElement;
      const para = state.paragraphs[i];
      if (!para) return;
      if (ta.getAttribute('data-paragraph') !== activePara) {
        ta.value = para.text;
      }
    });
  }

  void reRenderNoteKeepingEdit;
}
