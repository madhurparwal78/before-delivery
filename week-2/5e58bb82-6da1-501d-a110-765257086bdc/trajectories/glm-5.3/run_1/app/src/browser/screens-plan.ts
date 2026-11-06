/* Line plan screen: vessel pickers (ARIA comboboxes), save, launch, selection and undo. */
import { Mission, Line, Vessel } from './app.js';
import { apiFetch, ApiError } from './api.js';
import { h, clear, focusSafe, openModal } from './dom.js';
import { store } from './state.js';
import { fmtLength } from './app.js';

export interface PlanScreenRefs {
  mission: Mission;
  lines: Line[];
  vessels: Vessel[];
}

const unsavedByMission = new Map<string, Record<string, string | null>>(); // lineId -> vesselId|null

export function restoreUnsaved(missionId: string): Record<string, string | null> {
  try {
    const raw = sessionStorage.getItem(`swathdeck-unsaved-${missionId}`);
    if (raw) return JSON.parse(raw) as Record<string, string | null>;
  } catch { /* no storage */ }
  return {};
}

export function saveUnsaved(missionId: string, u: Record<string, string | null>): void {
  try {
    sessionStorage.setItem(`swathdeck-unsaved-${missionId}`, JSON.stringify(u));
  } catch { /* no storage */ }
}

export function clearUnsaved(missionId: string): void {
  try { sessionStorage.removeItem(`swathdeck-unsaved-${missionId}`); } catch { /* no storage */ }
}

export function hasUnsavedChanges(): boolean {
  for (const k of Object.keys(sessionStorage)) {
    if (k.startsWith('swathdeck-unsaved-')) return true;
  }
  return false;
}

export function renderLinePlan(root: HTMLElement, mission: Mission, lines: Line[], opts: { leaveGuard?: boolean } = {}): void {
  clear(root);
  const statusEl = h('div', { id: 'plan-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Plan status', class: 'banner' });

  const unsaved = restoreUnsaved(mission.id);
  const unsavedCount = Object.keys(unsaved).length;

  const state = { picks: new Map<string, string | null>(), selected: new Set<string>() };
  for (const l of lines) {
    state.picks.set(l.id, unsaved[l.id] !== undefined ? (unsaved[l.id] ?? null) : l.vessel_id);
  }

  const vesselCombobox = (line: Line, value: string | null): HTMLElement => {
    const labelId = `vessel-for-${line.id}`;
    const btn = h('button', {
      role: 'combobox', 'aria-expanded': 'false', 'aria-controls': `${labelId}-lb`,
      'aria-haspopup': 'listbox', 'aria-label': `Vessel for ${line.label}`,
      class: 'combo-btn mono',
      onclick: () => openList(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'ArrowDown' && e.altKey || e.key === ' ') { e.preventDefault(); openList(); }
      },
    }, value ?? 'Unassigned') as HTMLButtonElement;
    let listEl: HTMLElement | null = null;
    let open = false;
    const closeList = (restoreFocus: boolean): void => {
      if (!open) return;
      open = false;
      btn.setAttribute('aria-expanded', 'false');
      if (listEl) { listEl.remove(); listEl = null; }
      if (restoreFocus) btn.focus();
    };
    const choose = (vId: string | null, vName: string | null): void => {
      state.picks.set(line.id, vId);
      unsaved[line.id] = vId;
      saveUnsaved(mission.id, unsaved);
      btn.textContent = vId ? (vName ?? vId) : 'Unassigned';
      const row = btn.closest('tr') as HTMLElement | null;
      const mark = row?.querySelector('.unsaved-mark');
      if (mark) mark.textContent = 'Unsaved';
      statusEl.textContent = '';
      closeList(true);
    };
    const openList = (): void => {
      if (open) { closeList(true); return; }
      open = true;
      btn.setAttribute('aria-expanded', 'true');
      listEl = h('ul', { role: 'listbox', id: `${labelId}-lb`, class: 'combo-list', 'aria-label': `Vessel for ${line.label}` });
      const options: { id: string | null; label: string }[] = [
        { id: null, label: 'Unassigned' },
        ...store.vessels.map(v => ({ id: v.id, label: v.name })),
      ];
      let focusIdx = Math.max(0, options.findIndex(o => o.id === (state.picks.get(line.id) ?? null)));
      const renderOpts = (): void => {
        if (!listEl) return;
        clear(listEl);
        options.forEach((o, i) => {
          listEl!.append(h('li', {
            role: 'option', 'aria-selected': String(o.id === state.picks.get(line.id)),
            class: `combo-option ${i === focusIdx ? 'focused' : ''}`,
            onmousedown: (ev: MouseEvent) => { ev.preventDefault(); choose(o.id, o.label); },
          }, o.label));
        });
      };
      renderOpts();
      const rect = btn.getBoundingClientRect();
      listEl.style.position = 'fixed';
      const below = rect.bottom + 4;
      const maxH = 240;
      let top = below;
      if (top + maxH > window.innerHeight - 8) top = Math.max(8, rect.top - maxH - 4);
      listEl.style.top = `${top}px`;
      listEl.style.left = `${Math.max(8, Math.min(window.innerWidth - 280, rect.left))}px`;
      listEl.style.maxHeight = `${maxH}px`;
      listEl.style.zIndex = '900';
      document.body.append(listEl);
      const onKey = (e: KeyboardEvent): void => {
        if (!open) { document.removeEventListener('keydown', onKey, true); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); focusIdx = Math.min(options.length - 1, focusIdx + 1); renderOpts(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusIdx = Math.max(0, focusIdx - 1); renderOpts(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          const o = options[focusIdx]!;
          choose(o.id, o.label);
          document.removeEventListener('keydown', onKey, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          document.removeEventListener('keydown', onKey, true);
          closeList(true);
        } else if (e.key === 'Tab') {
          document.removeEventListener('keydown', onKey, true);
          closeList(false);
        }
      };
      document.addEventListener('keydown', onKey, true);
      const outside = (ev: MouseEvent): void => {
        if (listEl && !listEl.contains(ev.target as Node) && ev.target !== btn) {
          document.removeEventListener('mousedown', outside, true);
          document.removeEventListener('keydown', onKey, true);
          closeList(false);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    };
    return h('span', { class: 'combo-wrap' }, btn);
  };

  // --- selection and bulk assign ---
  const selectedLines = (): Line[] => lines.filter(l => state.selected.has(l.id) && (l.status === 'Pending' || l.status === 'Assigned'));
  const announceSelection = (): void => {
    const n = selectedLines().length;
    if (n > 0) statusEl.textContent = `${n} lines selected`;
  };

  const tableRows: HTMLElement[] = [];
  for (const line of lines) {
    const isReassignable = line.status === 'Pending' || line.status === 'Assigned';
    const cb = h('input', {
      type: 'checkbox', 'aria-label': `Select ${line.label}`,
      ...(state.selected.has(line.id) ? { checked: true } : {}),
      ...(isReassignable ? {} : { disabled: true }),
    }) as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(line.id); else state.selected.delete(line.id);
      announceSelection();
    });
    const tr = h('tr', { class: 'plan-row', 'data-line-id': line.id, tabindex: '-1' },
      h('td', {}, cb),
      h('td', { class: 'mono' }, line.label),
      h('td', {}, line.kind === 'planned' ? 'Planned' : 'Crossline'),
      h('td', { class: 'mono' }, fmtLength(line.length_m, store.units)),
      h('td', {}, vesselCombobox(line, state.picks.get(line.id) ?? null)),
      h('td', { class: 'unsaved-mark mono', 'aria-label': 'unsaved' }, ''),
    );
    tr.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === ' ' && document.activeElement === tr) {
        e.preventDefault();
        if (isReassignable) {
          cb.checked = !cb.checked;
          if (cb.checked) state.selected.add(line.id); else state.selected.delete(line.id);
          announceSelection();
        }
      } else if (e.key === 'ArrowDown' && e.shiftKey) {
        e.preventDefault();
        const idx = lines.findIndex(l => l.id === line.id);
        for (let i = idx; i <= Math.min(lines.length - 1, idx + 1); i++) {
          state.selected.add(lines[i]!.id);
        }
        syncChecks();
        announceSelection();
      } else if (e.key === 'ArrowUp' && e.shiftKey) {
        e.preventDefault();
        const idx = lines.findIndex(l => l.id === line.id);
        for (let i = idx; i >= Math.max(0, idx - 1); i--) {
          state.selected.add(lines[i]!.id);
        }
        syncChecks();
        announceSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        for (const l of lines) if (l.status === 'Pending' || l.status === 'Assigned') state.selected.add(l.id);
        syncChecks();
        announceSelection();
      }
    });
    tableRows.push(tr);
  }
  function syncChecks(): void {
    for (const tr of tableRows) {
      const id = tr.dataset.lineId!;
      const cb = tr.querySelector('input[type=checkbox]') as HTMLInputElement;
      cb.checked = state.selected.has(id);
    }
  }

  const collectAssignments = (map: Map<string, string | null>): Record<string, unknown>[] =>
    Array.from(map.entries()).map(([lineId, vesselId]) => ({ line_id: lineId, vessel_id: vesselId }));

  const saveAssignments = async (picks: Map<string, string | null>, successMsg: string): Promise<boolean> => {
    statusEl.textContent = 'Saving assignments';
    try {
      await apiFetch('POST', `/api/missions/${mission.id}/assignments`, { assignments: collectAssignments(picks) });
      statusEl.textContent = successMsg;
      clearUnsaved(mission.id);
      return true;
    } catch (err) {
      const e2 = err as ApiError;
      statusEl.textContent = e2.body?.message ?? 'Saving failed';
      return false;
    }
  };

  const saveBtn = h('button', { class: 'btn primary' }, 'Save assignments');
  saveBtn.addEventListener('click', async () => { await saveAssignments(state.picks, 'Assignments saved'); });

  const assignSelected = h('button', { class: 'btn' }, 'Assign selected');
  assignSelected.addEventListener('click', () => {
    const sel = selectedLines();
    if (sel.length === 0) { statusEl.textContent = 'Select lines first'; return; }
    openModal({ label: 'Assign selected lines' }, (root2, close) => {
      const combo = h('select', { 'aria-label': 'Vessel', class: 'mono' }) as HTMLSelectElement;
      for (const v of store.vessels) combo.append(h('option', { value: v.id }, v.name));
      const confirm = h('button', { class: 'btn primary' }, 'Assign');
      confirm.addEventListener('click', async () => {
        const vesselId = combo.value;
        const picks = new Map(state.picks);
        const previous = new Map<string, string | null>();
        for (const l of sel) {
          previous.set(l.id, lines.find(x => x.id === l.id)?.vessel_id ?? null);
          picks.set(l.id, vesselId);
        }
        close();
        statusEl.textContent = 'Saving assignments';
        const ok = await saveAssignments(picks, `Assigned ${sel.length} lines to ${vesselName(combo.value)} — Undo available for 10 seconds`);
        if (ok) {
          state.picks = picks;
          const undoBtn = h('button', { class: 'btn subtle undo-btn' }, 'Undo') as HTMLButtonElement;
          const undoTimer = setTimeout(() => undoBtn.remove(), 10000);
          undoBtn.addEventListener('click', async () => {
            clearTimeout(undoTimer);
            statusEl.textContent = 'Saving assignments';
            try {
              await apiFetch('POST', `/api/missions/${mission.id}/assignments`, { assignments: collectAssignments(previous) });
              statusEl.textContent = `Undid assignment of ${sel.length} lines`;
            } catch (err) {
              const e2 = err as ApiError;
              statusEl.textContent = `Could not undo: ${e2.body?.message ?? 'the server refused'}`;
            }
          });
          root.querySelector('.plan-actions')?.append(undoBtn);
        }
      });
      function vesselName(id: string): string { return store.vessels.find(v => v.id === id)?.name ?? id; }
      root2.append(
        h('h2', {}, 'Assign selected lines'),
        h('p', {}, `${sel.length} lines selected.`),
        h('label', {}, 'Vessel'), combo,
        h('div', { class: 'dialog-actions' }, confirm, h('button', { class: 'btn subtle', onclick: close }, 'Cancel')),
      );
      combo.focus();
    });
  });

  const launchBtn = h('button', { class: 'btn' }, 'Launch mission');
  launchBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Launching mission';
    try {
      await apiFetch('POST', `/api/missions/${mission.id}/transitions`, { to: 'Launched' });
      statusEl.textContent = 'Mission launched';
      window.location.href = `/missions/${mission.id}`;
    } catch (err) {
      const e2 = err as ApiError;
      statusEl.textContent = e2.body?.message ?? 'Launching failed';
    }
  });

  const summary = h('div', { class: 'plan-summary', 'aria-label': 'Plan summary' },
    h('dl', { class: 'summary-facts mono' },
      h('div', {}, h('dt', {}, 'Survey order'), h('dd', {}, mission.survey_order === 'special' ? 'Special Order' : 'Order 1a')),
      h('div', {}, h('dt', {}, 'Lines'), h('dd', {}, String(mission.line_count))),
      h('div', {}, h('dt', {}, 'Crosslines'), h('dd', {}, String(mission.crossline_count))),
      h('div', {}, h('dt', {}, 'Estimated duration'), h('dd', {}, `${Math.round(mission.estimated_duration_s / 60)} min`)),
      h('div', {}, h('dt', {}, 'Swath width'), h('dd', {}, fmtLength(mission.swath_width_m, store.units))),
      h('div', {}, h('dt', {}, 'Line spacing'), h('dd', {}, fmtLength(mission.line_spacing_m, store.units))),
    ));

  root.append(
    h('h1', {}, mission.name),
    summary,
    statusEl,
    h('div', { class: 'plan-actions' }, saveBtn, assignSelected, launchBtn,
      h('a', { class: 'btn subtle', href: `/missions/${mission.id}` }, 'Open console')),
    h('table', { class: 'table plan-table', 'aria-label': 'Line plan' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Select'), h('th', {}, 'Line'), h('th', {}, 'Kind'), h('th', {}, 'Length'), h('th', {}, 'Vessel'))),
      h('tbody', {}, ...tableRows),
    ),
  );

  if (unsavedCount > 0) {
    for (const tr of tableRows) {
      const id = tr.dataset.lineId!;
      if (id in unsaved) {
        (tr.querySelector('.unsaved-mark') as HTMLElement).textContent = 'Unsaved';
      }
    }
    statusEl.textContent = `Unsaved changes restored (${unsavedCount})`;
  }
}
