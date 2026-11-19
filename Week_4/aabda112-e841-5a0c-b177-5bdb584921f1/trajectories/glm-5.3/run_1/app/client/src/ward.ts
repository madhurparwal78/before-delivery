import { el, bannerAlert, openDialog, errorSummary, inlineError } from './ui.js';
import { get, post, clinicTime, initials, ApiRequestFailed } from './api.js';
import { renderSplitBand, renderBeacons } from './shell.js';
import { announcer, live } from './live.js';
import type { Me } from './shell.js';

type Dose = {
  id: string; treatmentId: string; admissionId: string; patientId: string;
  patientName: string; kennel: string; name: string; scheduledAt: string;
  status: 'upcoming' | 'due' | 'overdue' | 'given' | 'skipped';
  givenAt: string | null; givenBy: string | null; skipReason: string | null;
  notes: { id: string; text: string; author: string; createdAt: string }[];
};

const GROUPS: { key: string; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due', label: 'Due' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done', label: 'Done' },
];

const DOSE_LABEL: Record<string, string> = {
  upcoming: 'Upcoming', due: 'Due', overdue: 'Overdue', given: 'Given', skipped: 'Skipped',
};

export function renderWardScreen(root: HTMLElement, me: Me, path: string, navigate: (p: string) => void): void {
  const state = {
    doses: [] as Dose[],
    beacons: { waiting: 0, overdue: 0, dueWithinHour: 0 },
    patients: [] as { id: string; name: string }[],
    focusedId: null as string | null,
  };

  const wrap = el('div', { class: 'page-col' });
  const beacons = renderBeacons(() => state.beacons);
  const admitBtn = el('button', { class: 'pill pill-primary', onclick: () => openAdmit() }, 'Admit patient');
  const band = renderSplitBand('Ward, today', beacons.root, [admitBtn]);
  wrap.append(band);

  const boardRegion = el('section', { 'aria-label': 'Ward board region' });
  wrap.append(boardRegion);

  root.textContent = '';
  root.append(wrap);

  const refetch = async (): Promise<void> => {
    const [board, timeR] = await Promise.all([get('/api/ward/board'), get('/api/time')]);
    state.doses = board.treatments;
    state.beacons = board.beacons;
    beacons.update(state.beacons);
    const heading = band.querySelector('.clinic-date');
    if (heading) heading.textContent = formatClinicDateHeading(timeR.now);
    renderBoard();
  };

  live.onEvent((event) => {
    if (event === 'ward' || event === 'beacons' || event === 'queue' || event === 'tick') refetch();
  });

  refetch();

  function cellName(d: Dose): string {
    return `${d.patientName}, ${d.name}, ${clinicTime(d.scheduledAt)}, ${DOSE_LABEL[d.status]}`;
  }

  function groupOf(d: Dose): string {
    if (d.status === 'given' || d.status === 'skipped') return 'done';
    return d.status;
  }

  function renderBoard(): void {
    boardRegion.textContent = '';
    if (state.doses.length === 0) {
      const card = el('div', { class: 'empty-card' });
      card.append(el('p', { class: 'title', text: 'No patients are in the ward.' }));
      card.append(el('button', { class: 'pill pill-primary', onclick: () => openAdmit() }, 'Admit a patient'));
      boardRegion.append(card);
      return;
    }
    const grid = el('div', { role: 'grid', 'aria-label': 'Ward board', tabindex: '0' });
    grid.addEventListener('keydown', boardKeydown);
    const width = window.innerWidth;
    const cols = width <= 375 ? 1 : width <= 768 ? 2 : 3;

    const byGroup = new Map<string, Dose[]>();
    for (const g of GROUPS.map((g) => g.key)) byGroup.set(g, []);
    for (const d of state.doses) byGroup.get(groupOf(d))!.push(d);

    let idx = 0;
    const position = new Map<string, { group: string; row: number; col: number; idx: number }>();
    for (const g of GROUPS) {
      const doses = byGroup.get(g.key)!;
      if (doses.length === 0) continue;
      const rowgroup = el('div', { role: 'rowgroup', 'aria-label': g.label });
      const rows = Math.ceil(doses.length / cols);
      const gridRows: Dose[][] = Array.from({ length: rows }, (_, i) => doses.slice(i * cols, (i + 1) * cols));
      gridRows.forEach((row, r) => {
        const rowEl = el('div', { role: 'row', style: `display:grid;grid-template-columns:repeat(${cols},1fr);gap:12px` });
        row.forEach((d, c) => {
          position.set(d.id, { group: g.key, row: r, col: c, idx });
          idx += 1;
          rowEl.append(buildCell(d));
        });
        rowgroup.append(rowEl);
      });
      grid.append(rowgroup);
    }
    (grid as any)._position = position;
    (grid as any)._doses = state.doses;

    const first = grid.querySelector('[data-idx="0"]') as HTMLElement;
    if (first) {
      grid.addEventListener('focus', () => {
        if (document.activeElement === grid) first.focus();
      });
    }
    boardRegion.append(grid);

    // restore focus on the same treatment when the board re-renders
    if (state.focusedId) {
      const cell = grid.querySelector(`[data-testid="dose-${state.focusedId}"]`) as HTMLElement;
      if (cell && document.activeElement === document.body) cell.focus();
    }
  }

  function buildCell(d: Dose): HTMLElement {
    const cell = el('div', {
      role: 'gridcell',
      tabindex: '-1',
      'aria-label': cellName(d),
      'data-testid': `dose-${d.id}`,
      'data-idx': String((buildCell as any)._idx ?? ''),
      class: 'card',
      'data-motion': 'board-status',
      'data-motion-ms': '300',
      'data-motion-easing': 'ease-in-out',
    });
    cell.style.padding = '14px';
    const header = el('div', { style: 'display:flex;gap:10px;align-items:center' });
    header.append(el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(d.patientName)));
    const title = el('strong', { style: 'color:#14212b' }, `${d.patientName}`);
    header.append(title);
    header.append(el('span', { class: 'chip' }, `Kennel ${d.kennel}`));
    header.append(el('span', { class: 'chip chip-status' }, DOSE_LABEL[d.status]));
    cell.append(header);
    cell.append(el('p', { style: 'margin:6px 0;color:#33424e' }, `${d.name} at ${clinicTime(d.scheduledAt)}`));
    if (d.skipReason) cell.append(el('p', { class: 'chip chip-late' }, d.skipReason));
    if (d.notes.length > 0) {
      const notes = el('ul');
      for (const n of d.notes) notes.append(el('li', { text: n.text }));
      cell.append(notes);
    }
    const actions = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' });
    const canWard = ['nurse', 'vet', 'manager'].includes(me.role);
    if (canWard) {
      if (d.status === 'given' || d.status === 'skipped') {
        actions.append(el('button', { class: 'btn', onclick: () => actDose(d, 'reopen') }, `Reopen, ${d.patientName}, ${d.name}`));
      } else {
        actions.append(el('button', { class: 'btn', onclick: () => actDose(d, 'given') }, `Mark given, ${d.patientName}, ${d.name}`));
      }
      actions.append(el('button', { class: 'btn', onclick: () => openNoteDialog(d) }, `Add note, ${d.patientName}, ${d.name}`));
      if (d.status === 'due' || d.status === 'overdue') {
        actions.append(el('button', { class: 'btn', onclick: () => openSkipDialog(d) }, `Skip, ${d.patientName}, ${d.name}`));
      }
    }
    cell.append(actions);
    (cell as any)._dose = d;
    return cell;
  }

  async function actDose(d: Dose, action: 'given' | 'reopen'): Promise<void> {
    try {
      await post(`/api/treatments/${d.id}/${action}`);
      announcer.say(action === 'given' ? `${d.patientName}, ${d.name} marked given.` : `${d.patientName}, ${d.name} reopened.`);
      await refetch();
    } catch (e) {
      if (e instanceof ApiRequestFailed) showBoardAlert(e.err.message);
    }
  }

  function showBoardAlert(msg: string): void {
    const old = boardRegion.querySelector('[data-role="ward-alert"]');
    old?.remove();
    const b = bannerAlert(msg);
    b.setAttribute('data-role', 'ward-alert');
    boardRegion.prepend(b);
  }

  function boardKeydown(e: KeyboardEvent): void {
    const grid = e.currentTarget as HTMLElement;
    const position = (grid as any)._position as Map<string, { group: string; row: number; col: number; idx: number }>;
    const doses = (grid as any)._doses as Dose[];
    const active = document.activeElement as HTMLElement;
    const cellEl = active.closest('[data-testid^="dose-"]') as HTMLElement | null;
    if (!cellEl) {
      const first = grid.querySelector('[role="gridcell"]') as HTMLElement;
      if (first && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const id = cellEl.getAttribute('data-testid')!.slice('dose-'.length);
    const pos = position.get(id);
    if (!pos) return;
    const all = Array.from(position.entries()).sort((a, b) => a[1].idx - b[1].idx);

    const focusDose = (target?: { group: string; row: number; col: number }): void => {
      if (!target) return;
      const match = all.find(([, p]) => p.group === target.group && p.row === target.row && p.col === target.col);
      const chosen = match ?? all.filter(([p]) => p.group === target.group).sort((a, b) => b[1].idx - a[1].idx)[0];
      if (chosen) {
        e.preventDefault();
        state.focusedId = chosen[0];
        grid.querySelector(`[data-testid="dose-${chosen[0]}"]`)?.setAttribute('tabindex', '0');
        (grid.querySelector(`[data-testid="dose-${chosen[0]}"]`) as HTMLElement)?.focus();
      }
    };

    const isOneCol = window.innerWidth <= 375;
    const groupOrder = GROUPS.map((g) => g.key);
    const nextGroup = (dir: 1 | -1): string | null => {
      const gi = groupOrder.indexOf(pos.group);
      for (let i = gi + dir; i >= 0 && i < groupOrder.length; i += dir) {
        if (all.some(([, p]) => p.group === groupOrder[i])) return groupOrder[i];
      }
      return null;
    };

    switch (e.key) {
      case 'ArrowRight': {
        if (isOneCol) return;
        const flat = all.map(([id2]) => id2);
        const next = flat[all.findIndex(([id2]) => id2 === id) + 1];
        if (next) focusDose(position.get(next));
        break;
      }
      case 'ArrowLeft': {
        if (isOneCol) return;
        const flat = all.map(([id2]) => id2);
        const prev = flat[all.findIndex(([id2]) => id2 === id) - 1];
        if (prev) focusDose(position.get(prev));
        break;
      }
      case 'ArrowDown': {
        if (isOneCol) {
          const flat = all.map(([id2]) => id2);
          const next = flat[all.findIndex(([id2]) => id2 === id) + 1];
          if (next) focusDose(position.get(next));
          break;
        }
        const sameGroup = all.filter(([id2, p]) => p.group === pos.group);
        const inRow = sameGroup.filter(([, p]) => p.row === pos.row + 1);
        const direct = inRow.find(([, p]) => p.col === pos.col);
        if (direct) {
          focusDose(position.get(direct[0]));
        } else {
          const nextG = nextGroup(1);
          if (nextG) {
            const rows = all.filter(([id2, p]) => p.group === nextG);
            const maxRow = Math.max(...rows.map(([, p]) => p.row));
            const rowCells = rows.filter(([, p]) => p.row === (pos.row <= maxRow ? pos.row : maxRow));
            const candidate = rowCells.find(([, p]) => p.col === pos.col) ?? rowCells[rowCells.length - 1];
            if (candidate) focusDose(position.get(candidate[0]));
            else focusDose(position.get(rows[rows.length - 1][0]));
          }
        }
        break;
      }
      case 'ArrowUp': {
        if (isOneCol) {
          const flat = all.map(([id2]) => id2);
          const prev = flat[all.findIndex(([id2]) => id2 === id) - 1];
          if (prev) focusDose(position.get(prev));
          break;
        }
        if (pos.row > 0) {
          const above = all.find(([id2, p]) => p.group === pos.group && p.row === pos.row - 1 && p.col === pos.col);
          if (above) focusDose(position.get(above[0]));
        } else {
          const prevG = nextGroup(-1);
          if (prevG) {
            const rows = all.filter(([id2, p]) => p.group === prevG);
            const maxRow = Math.max(...rows.map(([, p]) => p.row));
            const rowCells = rows.filter(([, p]) => p.row === maxRow);
            const candidate = rowCells.find(([, p]) => p.col === pos.col) ?? rowCells[rowCells.length - 1];
            if (candidate) focusDose(position.get(candidate[0]));
          }
        }
        break;
      }
      case ' ': {
        const d = doses.find((x) => x.id === id)!;
        if (d.status === 'given' || d.status === 'skipped') {
          actDose(d, 'reopen');
        } else {
          actDose(d, 'given');
        }
        e.preventDefault();
        break;
      }
      case 'n':
      case 'N': {
        e.preventDefault();
        const d = doses.find((x) => x.id === id)!;
        openNoteDialog(d);
        break;
      }
      case 's':
      case 'S': {
        e.preventDefault();
        const d = doses.find((x) => x.id === id)!;
        openSkipDialog(d);
        break;
      }
    }
  }

  function dialogGuard(build: () => HTMLElement, labelledBy: string, doseId: string, onOpen?: (d: HTMLDialogElement) => void): void {
    // A ward dialog survives refreshes: the refetch only re-renders the board.
    openDialog(build, {
      labelledBy,
      onOpen,
      onClose: () => {
        const cell = boardRegion.querySelector(`[data-testid="dose-${doseId}"]`) as HTMLElement;
        cell?.focus();
      },
    });
  }

  function openNoteDialog(d: Dose): void {
    let dlg: HTMLDialogElement | null = null;
    dialogGuard(() => {
      const body = el('div', { class: 'dialog-body' });
      body.append(el('h2', { id: 'dlg-note', text: 'Add note' }));
      const summaryHolder = el('div');
      const ta = el('textarea', { class: 'input-pill', 'aria-label': 'Note', rows: '4' }) as HTMLTextAreaElement;
      const errP = el('p', {});
      const actions = el('div', { style: 'display:flex;gap:10px' });
      const saveBtn = el('button', { class: 'pill pill-primary' }, 'Save note');
      const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
      actions.append(saveBtn, cancelBtn);
      saveBtn.addEventListener('click', async () => {
        if (!ta.value.trim()) {
          summaryHolder.textContent = '';
          const box = errorSummary([{ message: 'Note is required.', focus: () => ta.focus() }]);
          summaryHolder.append(box);
          box.querySelector('a')?.focus();
          errP.textContent = 'Note is required.';
          return;
        }
        saveBtn.setAttribute('aria-busy', 'true');
        saveBtn.disabled = true;
        try {
          await post(`/api/treatments/${d.id}/notes`, { text: ta.value });
          announcer.say(`Note saved for ${d.patientName}, ${d.name}.`);
          dlg?.close();
          await refetch();
        } catch (e) {
          if (e instanceof ApiRequestFailed) {
            summaryHolder.textContent = '';
            const box = errorSummary([{ message: e.err.message, focus: () => ta.focus() }]);
            summaryHolder.append(box);
            box.querySelector('a')?.focus();
          }
        } finally {
          saveBtn.removeAttribute('aria-busy');
          saveBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', () => dlg?.close());
      body.append(summaryHolder, el('div', { class: 'field' }, el('label', { text: 'Note' }), ta, errP), actions);
      return body;
    }, 'dlg-note', d.id, (d0) => { dlg = d0; });
  }

  function openSkipDialog(d: Dose): void {
    let dlg: HTMLDialogElement | null = null;
    dialogGuard(() => {
      const body = el('div', { class: 'dialog-body' });
      body.append(el('h2', { id: 'dlg-skip', text: 'Skip treatment' }));
      const summaryHolder = el('div');
      const ta = el('input', { class: 'input-pill', 'aria-label': 'Reason', type: 'text' }) as HTMLInputElement;
      const errP = el('p', {});
      const actions = el('div', { style: 'display:flex;gap:10px' });
      const skipBtn = el('button', { class: 'pill pill-primary' }, 'Skip treatment');
      const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
      actions.append(skipBtn, cancelBtn);
      skipBtn.addEventListener('click', async () => {
        if (!ta.value.trim()) {
          summaryHolder.textContent = '';
          const box = errorSummary([{ message: 'Reason is required.', focus: () => ta.focus() }]);
          summaryHolder.append(box);
          box.querySelector('a')?.focus();
          return;
        }
        skipBtn.setAttribute('aria-busy', 'true');
        skipBtn.disabled = true;
        try {
          await post(`/api/treatments/${d.id}/skip`, { reason: ta.value });
          announcer.say(`${d.patientName}, ${d.name} skipped.`);
          dlg?.close();
          await refetch();
        } catch (e) {
          if (e instanceof ApiRequestFailed) {
            summaryHolder.textContent = '';
            const box = errorSummary([{ message: e.err.message, focus: () => ta.focus() }]);
            summaryHolder.append(box);
            box.querySelector('a')?.focus();
          }
        } finally {
          skipBtn.removeAttribute('aria-busy');
          skipBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', () => dlg?.close());
      body.append(summaryHolder, el('div', { class: 'field' }, el('label', { text: 'Reason' }), ta, errP), actions);
      return body;
    }, 'dlg-skip', d.id, (d0) => { dlg = d0; });
  }

  function openAdmit(): void {
    let dlg: HTMLDialogElement | null = null;
    openDialog(() => {
      const body = el('div', { class: 'dialog-body' });
      body.append(el('h2', { id: 'dlg-admit', text: 'Admit patient' }));
      const summaryHolder = el('div');
      body.append(summaryHolder);
      const patientSel = el('select', { class: 'input-pill', 'aria-label': 'Patient' }) as HTMLSelectElement;
      const kennelSel = el('select', { class: 'input-pill', 'aria-label': 'Kennel' }) as HTMLSelectElement;
      for (let i = 1; i <= 12; i++) kennelSel.append(new Option(`K${i}`, `K${i}`));
      const treatmentInput = el('input', { class: 'input-pill', 'aria-label': 'Treatment', type: 'text' }) as HTMLInputElement;
      const firstDose = el('input', { class: 'input-pill', 'aria-label': 'First dose', type: 'text', placeholder: 'YYYY-MM-DD HH:MM' }) as HTMLInputElement;
      const every = el('input', { class: 'input-pill', 'aria-label': 'Every (hours)', type: 'number', min: '1', max: '24', value: '8' }) as HTMLInputElement;
      const dosesN = el('input', { class: 'input-pill', 'aria-label': 'Doses', type: 'number', min: '1', max: '28', value: '4' }) as HTMLInputElement;
      const errors: Record<string, HTMLElement> = {};
      for (const [key, label, input] of [
        ['patient', 'Patient', patientSel], ['kennel', 'Kennel', kennelSel],
        ['treatment', 'Treatment', treatmentInput], ['firstDose', 'First dose', firstDose],
        ['every', 'Every (hours)', every], ['doses', 'Doses', dosesN],
      ] as [string, string, HTMLElement][]) {
        const errP = el('p', {});
        errors[key] = errP;
        const wrapF = el('div', { class: 'field' }, el('label', { text: label }), input, errP);
        body.append(wrapF);
      }
      const actions = el('div', { style: 'display:flex;gap:10px' });
      const admitBtn = el('button', { class: 'pill pill-primary' }, 'Admit');
      const cancelBtn = el('button', { class: 'btn' }, 'Cancel');
      actions.append(admitBtn, cancelBtn);
      body.append(actions);

      void get('/api/patients').then((r) => {
        patientSel.textContent = '';
        patientSel.append(new Option('', ''));
        for (const p of r.patients) patientSel.append(new Option(p.name, p.id));
      });

      admitBtn.addEventListener('click', async () => {
        admitBtn.setAttribute('aria-busy', 'true');
        admitBtn.disabled = true;
        try {
          const res = await post('/api/ward/admissions', {
            patientId: patientSel.value,
            kennel: kennelSel.value,
            treatments: [{
              name: treatmentInput.value,
              firstAt: firstDose.value,
              intervalHours: Number(every.value),
              count: Number(dosesN.value),
            }],
          });
          const patientName = patientSel.options[patientSel.selectedIndex]?.text ?? '';
          announcer.say(`${patientName} admitted to ${kennelSel.value}.`);
          dlg?.close();
          await refetch();
        } catch (e) {
          if (e instanceof ApiRequestFailed) {
            summaryHolder.textContent = '';
            const box = errorSummary([{ message: e.err.message, focus: () => (e.err.field === 'treatments.0.firstAt' ? firstDose : patientSel).focus() }]);
            summaryHolder.append(box);
            box.querySelector('a')?.focus();
          }
        } finally {
          admitBtn.removeAttribute('aria-busy');
          admitBtn.disabled = false;
        }
      });
      cancelBtn.addEventListener('click', () => dlg?.close());
      return body;
    }, {
      labelledBy: 'dlg-admit',
      onOpen: (d0) => { dlg = d0; },
      onClose: () => {
        (wrap.querySelector('.pill-primary') as HTMLElement)?.focus();
      },
    });
  }
}

function formatClinicDateHeading(iso: string): string {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Europe/London' }).format(d);
  const rest = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(d);
  return `${day} ${rest}`;
}
