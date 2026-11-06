import { intervalText, roundHalfUp } from '../../shared/numbers.js';
import type { Line, Mission, Vessel } from '../../shared/types.js';
import { lengthText } from '../../shared/units.js';
import { ApiFailure, isCurrent, NoResponse, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { createCombobox, type Combobox } from '../components/combobox.js';
import { button, clear, el, setText, trapFocus } from '../dom.js';

const UNDO_WINDOW_MS = 10_000;

const KIND_WORD: Record<Line['kind'], string> = {
  planned: 'Planned',
  crossline: 'Crossline',
  infill: 'Infill',
};

export const linePlanScreen: ScreenFactory = (shell, context): Mounted => {
  const missionId = context.screen.kind === 'missionPlan' ? context.screen.missionId : '';
  const storageKey = `swathdeck.unsaved.${missionId}`;

  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Plan status',
    class: 'live-region',
  });
  shell.registerRegion('Plan status', status);

  const heading = el('h1', {});
  const summary = el('div', { role: 'group', 'aria-label': 'Plan summary', class: 'plan-summary' });
  const tableBody = el('tbody', {});
  const table = el('table', { 'aria-label': 'Line plan', class: 'data-table line-plan' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Select']),
        el('th', { scope: 'col' }, ['Line']),
        el('th', { scope: 'col' }, ['Kind']),
        el('th', { scope: 'col' }, ['Length']),
        el('th', { scope: 'col' }, ['Vessel']),
      ]),
    ]),
    tableBody,
  ]);

  const assignSelected = button('Assign selected');
  const save = button('Save assignments', { class: 'primary' });
  const launch = button('Launch mission');
  const consoleLink = el('a', { href: `/missions/${missionId}` }, ['Open console']);
  consoleLink.addEventListener('click', (event) => {
    event.preventDefault();
    leaveTo(`/missions/${missionId}`);
  });
  const undoButton = button('Undo');
  undoButton.hidden = true;

  const node = el('section', { class: 'line-plan-screen' }, [
    heading,
    summary,
    el('div', { class: 'plan-actions' }, [assignSelected, save, undoButton]),
    el('div', { class: 'table-scroll' }, [table]),
    el('div', { class: 'plan-actions' }, [launch, consoleLink]),
    status,
  ]);

  let mission: Mission | null = null;
  let lines: Line[] = [];
  let vessels: Vessel[] = [];
  const pickers = new Map<string, Combobox>();
  const selection = new Set<string>();
  /** Picker changes not yet saved, kept per mission in session storage. */
  let pending = new Map<string, string>();
  let undoTimer: number | null = null;
  let undoPrevious: { line_id: string; vessel_id: string | null }[] | null = null;
  let disposed = false;

  function loadPending(): void {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) return;
      pending = new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
    } catch {
      pending = new Map();
    }
  }

  function savePending(): void {
    try {
      if (pending.size === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(pending)));
    } catch {
      // A phone with no session storage simply loses the unsaved changes.
    }
  }

  function paintSummary(): void {
    if (!mission) return;
    clear(summary);
    const order = mission.survey_order === 'special' ? 'Special Order' : 'Order 1a';
    for (const [label, value] of [
      ['Survey order', order],
      ['Lines', String(mission.line_count)],
      ['Crosslines', String(mission.crossline_count)],
      ['Estimated duration', `${roundHalfUp(mission.estimated_duration_s / 60)} min`],
      ['Swath width', lengthText(mission.swath_width_m, shell.units)],
      ['Line spacing', lengthText(mission.line_spacing_m, shell.units)],
    ]) {
      summary.append(
        el('p', {}, [el('span', {}, [`${label}: `]), el('span', { class: 'mono' }, [value!])]),
      );
    }
  }

  function paintRows(): void {
    clear(tableBody);
    pickers.clear();
    for (const line of lines) {
      const checkbox = el('input', {
        type: 'checkbox',
        'aria-label': `Select ${line.label}`,
      });
      checkbox.checked = selection.has(line.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selection.add(line.id);
        else selection.delete(line.id);
        announceSelection();
      });

      const options = [
        { value: '', label: 'Unassigned' },
        ...vessels.map((vessel) => ({ value: vessel.id, label: vessel.name })),
      ];
      const chosen = pending.get(line.id) ?? line.vessel_id ?? '';
      const picker = createCombobox(`Vessel for ${line.label}`, options, chosen);
      const unsaved = el('span', { class: 'unsaved' });
      if (pending.has(line.id)) setText(unsaved, 'Unsaved');
      picker.onChange((value) => {
        if ((line.vessel_id ?? '') === value) pending.delete(line.id);
        else pending.set(line.id, value);
        setText(unsaved, pending.has(line.id) ? 'Unsaved' : '');
        savePending();
      });
      pickers.set(line.id, picker);

      const row = el('tr', { tabindex: '0', 'data-line': line.id }, [
        el('td', {}, [checkbox]),
        el('td', { class: 'mono' }, [line.label]),
        el('td', {}, [KIND_WORD[line.kind]]),
        el('td', { class: 'mono' }, [lengthText(line.length_m, shell.units)]),
        el('td', {}, [picker.node, unsaved]),
      ]);
      tableBody.append(row);
    }
  }

  function announceSelection(): void {
    setText(status, `${selection.size} lines selected`);
    for (const row of Array.from(tableBody.children) as HTMLElement[]) {
      const id = row.dataset.line;
      const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (id && checkbox) checkbox.checked = selection.has(id);
    }
  }

  function rowOf(node: Element | null): HTMLElement | null {
    return node?.closest('tr[data-line]') ?? null;
  }

  table.addEventListener('keydown', (event) => {
    const row = rowOf(document.activeElement);
    if (!row) return;
    const rows = Array.from(tableBody.children) as HTMLElement[];
    const index = rows.indexOf(row);
    const id = row.dataset.line!;
    if (event.key === ' ' && document.activeElement === row) {
      event.preventDefault();
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
      announceSelection();
      return;
    }
    if (event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      selection.add(id);
      const next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) {
        selection.add(next.dataset.line!);
        next.focus();
      }
      announceSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.clear();
      for (const line of lines) {
        if (line.status === 'Pending' || line.status === 'Assigned') selection.add(line.id);
      }
      announceSelection();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (document.activeElement !== row) return;
      event.preventDefault();
      rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  });

  function assignments(): { line_id: string; vessel_id: string | null }[] {
    return [...pending.entries()].map(([lineId, vesselId]) => ({
      line_id: lineId,
      vessel_id: vesselId === '' ? null : vesselId,
    }));
  }

  async function postAssignments(
    entries: { line_id: string; vessel_id: string | null }[],
  ): Promise<Line[]> {
    return request<Line[]>(`/api/missions/${missionId}/assignments`, {
      method: 'POST',
      body: { assignments: entries },
    });
  }

  async function doSave(): Promise<void> {
    const entries = assignments();
    if (entries.length === 0) {
      setText(status, 'Assignments saved');
      return;
    }
    setText(status, 'Saving assignments');
    const at = shell.generation;
    try {
      lines = await postAssignments(entries);
      if (!isCurrent(at) || disposed) return;
      pending.clear();
      savePending();
      paintRows();
      setText(status, 'Assignments saved');
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      setText(status, failureText(error));
    }
  }

  function failureText(error: unknown): string {
    if (error instanceof ApiFailure) return error.message;
    if (error instanceof NoResponse) return 'Could not reach Swathdeck — assignments are not saved';
    return 'Could not save the assignments';
  }

  save.addEventListener('click', () => void doSave());

  launch.addEventListener('click', () => {
    setText(status, 'Launching mission');
    const at = shell.generation;
    void request<Mission>(`/api/missions/${missionId}/transitions`, {
      method: 'POST',
      body: { to: 'Launched' },
    })
      .then(() => {
        if (!isCurrent(at) || disposed) return;
        setText(status, 'Mission launched');
      })
      .catch((error: unknown) => {
        if (!isCurrent(at) || disposed) return;
        setText(status, failureText(error));
      });
  });

  /** Assign every selected line to one vessel in a single all-or-nothing save. */
  assignSelected.addEventListener('click', () => {
    if (selection.size === 0) return;
    const options = [
      { value: '', label: 'Unassigned' },
      ...vessels.map((vessel) => ({ value: vessel.id, label: vessel.name })),
    ];
    const picker = createCombobox('Vessel', options, options[1]?.value ?? '');
    const confirm = button('Assign', { class: 'primary' });
    const cancel = button('Cancel');
    const dialog = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Assign selected lines',
        class: 'dialog',
      },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Assign selected lines']),
          picker.node,
          confirm,
          cancel,
        ]),
      ],
    );
    const opener = assignSelected;
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      opener.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      const vesselId = picker.value() === '' ? null : picker.value();
      const chosen = [...selection];
      const previous = chosen.map((lineId) => {
        const line = lines.find((item) => item.id === lineId);
        return { line_id: lineId, vessel_id: line?.vessel_id ?? null };
      });
      const at = shell.generation;
      close();
      void postAssignments(chosen.map((lineId) => ({ line_id: lineId, vessel_id: vesselId })))
        .then((updated) => {
          if (!isCurrent(at) || disposed) return;
          lines = updated;
          pending.clear();
          savePending();
          paintRows();
          const vesselName = vessels.find((item) => item.id === vesselId)?.name ?? 'Unassigned';
          setText(
            status,
            `Assigned ${chosen.length} lines to ${vesselName} — Undo available for 10 seconds`,
          );
          offerUndo(previous);
        })
        .catch((error: unknown) => {
          if (!isCurrent(at) || disposed) return;
          setText(status, failureText(error));
        });
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    picker.trigger.focus();
  });

  function offerUndo(previous: { line_id: string; vessel_id: string | null }[]): void {
    undoPrevious = previous;
    undoButton.hidden = false;
    if (undoTimer !== null) window.clearTimeout(undoTimer);
    undoTimer = window.setTimeout(() => {
      undoButton.hidden = true;
      undoPrevious = null;
    }, UNDO_WINDOW_MS);
  }

  undoButton.addEventListener('click', () => {
    const previous = undoPrevious;
    if (!previous) return;
    const at = shell.generation;
    void postAssignments(previous)
      .then((updated) => {
        if (!isCurrent(at) || disposed) return;
        lines = updated;
        paintRows();
        setText(status, `Undid assignment of ${previous.length} lines`);
        undoButton.hidden = true;
        undoPrevious = null;
      })
      .catch((error: unknown) => {
        if (!isCurrent(at) || disposed) return;
        setText(
          status,
          `Could not undo: ${error instanceof ApiFailure ? error.message : 'no response'}`,
        );
      });
  });

  /** Leaving with unsaved picker changes asks first. */
  function leaveTo(path: string): void {
    if (pending.size === 0) {
      shell.navigate(path);
      return;
    }
    const stay = button('Stay');
    const leave = button('Leave without saving');
    const dialog = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Unsaved assignments',
        class: 'dialog',
      },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Unsaved assignments']),
          el('p', {}, [`You have ${pending.size} unsaved assignment changes.`]),
          stay,
          leave,
        ]),
      ],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      consoleLink.focus();
    };
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    stay.addEventListener('click', close);
    leave.addEventListener('click', () => {
      pending.clear();
      savePending();
      shell.openDialogs.delete(dialog);
      dialog.remove();
      shell.navigate(path);
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    stay.focus();
  }

  const at = shell.generation;
  void (async () => {
    try {
      const [missionRecord, lineRecords, vesselRecords] = await Promise.all([
        request<Mission>(`/api/missions/${missionId}`),
        request<Line[]>(`/api/missions/${missionId}/lines`),
        request<Vessel[]>('/api/vessels'),
      ]);
      if (!isCurrent(at) || disposed) return;
      mission = missionRecord;
      lines = lineRecords;
      vessels = vesselRecords;
      setText(heading, mission.name);
      paintSummary();
      loadPending();
      // Only changes that still differ from the stored assignment count.
      for (const [lineId, vesselId] of [...pending]) {
        const line = lines.find((item) => item.id === lineId);
        if (!line || (line.vessel_id ?? '') === vesselId) pending.delete(lineId);
      }
      savePending();
      paintRows();
      if (pending.size > 0) setText(status, `Unsaved changes restored (${pending.size})`);
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      if (error instanceof ApiFailure && error.status === 404) shell.notFound();
    }
  })();

  return {
    node,
    dispose: () => {
      disposed = true;
      if (undoTimer !== null) window.clearTimeout(undoTimer);
      shell.unregisterRegion('Plan status');
    },
  };
};

export { intervalText };
