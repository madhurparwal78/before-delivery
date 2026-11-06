// Press previews: the Preview links table, Send preview, Revoke and Regenerate.
import { api, apiOk, failOf, type DropStaff, type PreviewOut } from './api.js';
import { el, buttonEl, liveRegion, announce, pending, openDialog, emptyRow } from './ui.js';
import { renderHeader, renderAuthNeeded, renderNotFoundScreen, ensureMember } from './staff-helpers.js';
import { parseInstant, marketTimeWords } from './format.js';

export async function renderPreviews(root: HTMLElement, dropId: string): Promise<HTMLElement> {
  if (!(await ensureMember())) return renderAuthNeeded(root, `/studio/drops/${dropId}/previews`);
  renderHeader('/studio/press');
  let drop: DropStaff | null = null;
  try { drop = await apiOk<DropStaff>('GET', `/api/drops/${dropId}`); } catch { drop = null; }
  if (!drop) return renderNotFoundScreen(root);
  const h = el('h1', {}, `Press previews · ${drop.name}`);
  const status = liveRegion('Preview status');
  const table = el('table', { class: 'table-to-cards' });
  table.append(el('caption', { text: 'Preview links' }));
  table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Editor' }), el('th', { text: 'Outlet' }), el('th', { text: 'Status' }), el('th', { text: 'Expires' }), el('th', { text: 'Actions' }))));
  const tbody = el('tbody');
  table.append(tbody);
  async function reload(): Promise<void> {
    tbody.replaceChildren();
    let previews: PreviewOut[] = [];
    try { const res = await apiOk<{ items: PreviewOut[] }>('GET', `/api/drops/${dropId}/previews`); previews = res.items ?? []; } catch { previews = []; }
    for (const p of previews) {
      const actions = el('td', { 'data-label': 'Actions' });
      if (p.status === 'active') {
        const revoke = buttonEl({ class: 'btn btn-sm', text: 'Revoke', onclick: () => {
          openDialog({
            label: 'Revoke link', opener: revoke,
            body: (dlg) => {
              const confirmBtn = buttonEl({ class: 'btn btn-primary', text: 'Revoke link', onclick: () => {
                dlg.onResult(api('POST', `/api/previews/${p.id}/revoke`), (ok, fail) => {
                  if (ok) announce(status, 'Link revoked.');
                  else announce(status, fail?.message ?? 'Revoking failed', true);
                });
              } });
              const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
              return el('div', {}, el('div', { class: 'btn-row' }, confirmBtn, cancel));
            },
            onSubmitted: () => { void reload(); }
          });
        } });
        const regen = buttonEl({ class: 'btn btn-sm', text: 'Regenerate', onclick: () => {
          openDialog({
            label: 'Regenerate link', opener: regen,
            body: (dlg) => {
              const confirmBtn = buttonEl({ class: 'btn btn-primary', text: 'Regenerate link', onclick: () => {
                dlg.onResult(api('POST', `/api/previews/${p.id}/regenerate`), (ok, fail) => {
                  if (ok) announce(status, `New link created. The old link no longer works, and the email to ${p.editorName} is on its way.`);
                  else announce(status, fail?.message ?? 'Regenerating failed', true);
                });
              } });
              const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
              return el('div', {}, el('div', { class: 'btn-row' }, confirmBtn, cancel));
            },
            onSubmitted: () => { void reload(); }
          });
        } });
        actions.append(revoke, regen);
      }
      const expires = parseInstant(p.expiresAt);
      tbody.append(el('tr', {},
        el('td', { 'data-label': 'Editor', text: p.editorName }),
        el('td', { 'data-label': 'Outlet', text: p.outlet }),
        el('td', { 'data-label': 'Status', text: p.status }),
        el('td', { 'data-label': 'Expires', class: 'mono', text: marketTimeWords(expires, 'copenhagen', 'Copenhagen') }),
        actions));
    }
    if (tbody.children.length === 0) tbody.append(emptyRow(5));
  }

  const sendBtn = buttonEl({ class: 'btn btn-primary', text: 'Send preview', onclick: () => {
    openDialog({
      label: 'Send preview', opener: sendBtn,
      body: (dlg) => {
        const name = el('input', { type: 'text', 'aria-label': 'Editor name' }) as HTMLInputElement;
        const email = el('input', { type: 'email', 'aria-label': 'Editor email' }) as HTMLInputElement;
        const outlet = el('input', { type: 'text', 'aria-label': 'Outlet' }) as HTMLInputElement;
        const submit = buttonEl({ class: 'btn btn-primary', text: 'Send preview', onclick: () => {
          const restore = pending(submit, 'Sending…');
          api('POST', `/api/drops/${dropId}/previews`, { editorName: name.value, editorEmail: email.value, outlet: outlet.value }).then(() => {
            dlg.root.close();
            announce(status, `Preview link created. The email to ${name.value} is on its way.`);
            void reload();
          }).catch(err => {
            const fail = failOf(err);
            const box = dlg.root.querySelector('.dialog-error') as HTMLElement;
            if (fail.fields) { if (box) { box.hidden = false; box.textContent = Object.values(fail.fields)[0] ?? fail.message; } }
            else if (box) { box.hidden = false; box.textContent = fail.message; }
          }).finally(() => restore());
        } });
        const cancel = buttonEl({ class: 'btn', text: 'Cancel', onclick: () => dlg.close() });
        return el('div', {},
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Editor name' }), name),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Editor email' }), email),
          el('label', { class: 'field' }, el('span', { class: 'label', text: 'Outlet' }), outlet),
          el('div', { class: 'btn-row' }, submit, cancel));
      }
    });
  } });

  root.append(h, el('section', { class: 'panel col-12' }, table, el('div', { class: 'btn-row', style: 'margin-top: 14px;' }, sendBtn), status));
  await reload();
  return h;
}
