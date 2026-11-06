import {
  intervalText,
} from '../../shared/numbers.js';
import type { Line, Mission, MissionSummary, Vessel } from '../../shared/types.js';
import { hoursText } from '../../shared/units.js';
import { ApiFailure, isCurrent, NoResponse, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { button, clear, el, reconcile, setText, trapFocus } from '../dom.js';
import { SlipwayQueue, type QueuedItem } from '../offlineQueue.js';
import { openUploadDialog, type HeldUpload } from './uploadDialog.js';

const REFRESH_MS = 2000;
const OPEN_STATUSES = ['Planned', 'Launched', 'Surveying', 'Recovering'];

interface SectionState {
  mission: MissionSummary;
  lines: Line[];
  vessels: Vessel[];
}

export const launchScreen: ScreenFactory = (shell): Mounted => {
  const status = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Launch status',
    class: 'live-region',
  });
  shell.registerRegion('Launch status', status);

  const heading = el('h1', { tabindex: '-1' }, ['Launch list']);
  const waitingButton = button('Waiting to send (0)');
  waitingButton.hidden = true;
  const sections = el('div', { class: 'launch-sections' });
  const serviceRows = el('div', { class: 'service-rows' });
  const fleetService = el(
    'section',
    { role: 'region', 'aria-label': 'Fleet service', class: 'fleet-service' },
    [el('h2', {}, ['Fleet service']), serviceRows],
  );

  const node = el('section', { class: 'launch-list' }, [
    heading,
    waitingButton,
    sections,
    fleetService,
    status,
  ]);

  /** Rows that must keep a word other than the server's for a moment. */
  const rowOverride = new Map<string, string>();
  const lineOverride = new Map<string, string>();
  const completedAt = new Map<string, number>();
  let held: HeldUpload | null = null;
  let disposed = false;
  let timer: number | null = null;

  const queue = new SlipwayQueue({
    changed: (items) => {
      setText(waitingButton, `Waiting to send (${items.length})`);
      waitingButton.hidden = items.length === 0;
      for (const item of items) rowOverride.set(item.vesselId, 'Queued — will send when online');
      void paint();
    },
    settled: (item, outcome) => {
      if (outcome.ok) {
        rowOverride.delete(item.vesselId);
        setText(status, successCopy(item));
      } else {
        rowOverride.set(item.vesselId, `Not sent — ${outcome.message}`);
      }
      void paint();
    },
  });

  function successCopy(item: QueuedItem): string {
    if (item.action === 'afloat') return `${item.vesselName} is afloat`;
    if (item.action === 'recovered') return `${item.vesselName} is recovered`;
    return `Service logged for ${item.vesselName}`;
  }

  waitingButton.addEventListener('click', () => openWaitingDialog());

  function openWaitingDialog(): void {
    const list = el('ul', {});
    const dialog = el(
      'div',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Waiting to send', class: 'dialog' },
      [el('div', { class: 'dialog-card' }, [el('h2', {}, ['Waiting to send']), list])],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      waitingButton.focus();
    };
    const fill = (): void => {
      clear(list);
      for (const item of queue.list()) {
        const discard = button(`Discard ${item.vesselName} ${item.action}`, { class: 'small' });
        discard.addEventListener('click', () => {
          queue.discard(item.id);
          rowOverride.delete(item.vesselId);
          fill();
          if (queue.size() === 0) close();
        });
        list.append(
          el('li', {}, [
            `${item.vesselName} · ${item.action} · ${new Date(item.queuedAt).toISOString().slice(11, 16)} UTC`,
            discard,
          ]),
        );
      }
    };
    fill();
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      trapFocus(dialog, event);
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    (list.querySelector('button') ?? dialog).focus();
  }

  // ---- vessel marks ----

  async function mark(vessel: Vessel, action: 'afloat' | 'recovered', control: HTMLButtonElement): Promise<void> {
    if (!navigator.onLine) {
      queue.enqueue({ vesselId: vessel.id, vesselName: vessel.name, action });
      setText(status, `Saved on this phone — ${queue.size()} waiting to send`);
      return;
    }
    const label = control.textContent ?? '';
    control.dataset.pending = 'true';
    setText(control, 'Marking…');
    control.disabled = true;
    setText(status, `Marking ${vessel.name} ${action === 'afloat' ? 'afloat' : 'recovered'}`);
    const at = shell.generation;
    try {
      await request<Vessel>(`/api/vessels/${vessel.id}/${action}`, { method: 'POST', body: {} });
      if (!isCurrent(at) || disposed) return;
      delete control.dataset.pending;
      setText(control, label);
      control.disabled = false;
      setText(status, `${vessel.name} is ${action === 'afloat' ? 'afloat' : 'recovered'}`);
      await refresh();
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      delete control.dataset.pending;
      setText(control, label);
      control.disabled = false;
      control.focus();
      if (error instanceof NoResponse) {
        setText(
          status,
          action === 'afloat'
            ? `Could not reach Swathdeck — ${vessel.name} is still ashore`
            : `Could not reach Swathdeck — ${vessel.name} is still afloat`,
        );
        return;
      }
      setText(status, error instanceof ApiFailure ? error.message : '');
    }
  }

  // ---- service dialog ----

  function openServiceDialog(vessel: Vessel, opener: HTMLButtonElement): void {
    const note = el('input', { type: 'text', id: 'service-note' });
    const message = el('p', { class: 'field-error' });
    const saveService = button('Save service', { class: 'primary' });
    const cancel = button('Cancel');
    // Each opening makes one idempotency key, used by every Save press.
    const key = `service-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dialog = el(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Log thruster service',
        class: 'dialog',
      },
      [
        el('div', { class: 'dialog-card' }, [
          el('h2', {}, ['Log thruster service']),
          el('p', {}, [`${vessel.name} · ${hoursText(vessel.hours_since_service)} since service`]),
          el('div', { class: 'field' }, [
            el('label', { for: 'service-note' }, ['Service note']),
            note,
            message,
          ]),
          saveService,
          cancel,
        ]),
      ],
    );
    const close = (): void => {
      shell.openDialogs.delete(dialog);
      dialog.remove();
      if (document.contains(opener)) opener.focus();
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
    saveService.addEventListener('click', () => {
      if (!navigator.onLine) {
        queue.enqueue({
          vesselId: vessel.id,
          vesselName: vessel.name,
          action: 'service',
          note: note.value,
        });
        setText(status, `Saved on this phone — ${queue.size()} waiting to send`);
        close();
        return;
      }
      setText(status, 'Logging service');
      const at = shell.generation;
      void request(`/api/vessels/${vessel.id}/services`, {
        method: 'POST',
        body: { note: note.value },
        headers: { 'idempotency-key': key },
      })
        .then(() => {
          if (!isCurrent(at) || disposed) return;
          setText(status, `Service logged for ${vessel.name}`);
          close();
          void paint();
        })
        .catch((error: unknown) => {
          if (!isCurrent(at) || disposed) return;
          if (error instanceof NoResponse) {
            setText(
              status,
              `Could not reach Swathdeck — service for ${vessel.name} is not logged yet`,
            );
            return;
          }
          if (error instanceof ApiFailure) {
            if (error.body.errors?.note) setText(message, error.body.errors.note);
            else setText(message, error.message);
            setText(status, error.message);
          }
        });
    });
    shell.openDialogs.add(dialog);
    node.append(dialog);
    note.focus();
  }

  // ---- mission complete ----

  async function completeMission(
    mission: MissionSummary,
    control: HTMLButtonElement,
    sectionNode: HTMLElement,
  ): Promise<void> {
    const label = control.textContent ?? '';
    control.dataset.pending = 'true';
    setText(control, 'Completing…');
    control.disabled = true;
    setText(status, 'Completing mission');
    const at = shell.generation;
    try {
      await request<Mission>(`/api/missions/${mission.id}/transitions`, {
        method: 'POST',
        body: { to: 'Complete' },
      });
      if (!isCurrent(at) || disposed) return;
      completedAt.set(mission.id, Date.now());
      delete control.dataset.pending;
      control.remove();
      const remaining = openSections.filter((item) => item.mission.id !== mission.id).length;
      setText(status, `${mission.name} complete — ${remaining} missions open`);
      setText(sectionNode.querySelector('[data-status]')!, 'Complete');
      moveFocusAfterComplete(sectionNode);
    } catch (error) {
      if (!isCurrent(at) || disposed) return;
      delete control.dataset.pending;
      setText(control, label);
      control.disabled = false;
      control.focus();
      if (error instanceof NoResponse) {
        setText(status, `Could not reach Swathdeck — ${mission.name} is still recovering`);
        return;
      }
      setText(status, error instanceof ApiFailure ? error.message : '');
    }
  }

  function moveFocusAfterComplete(sectionNode: HTMLElement): void {
    const all = Array.from(sections.children) as HTMLElement[];
    const index = all.indexOf(sectionNode);
    const next = all[index + 1] ?? all.find((item) => item !== sectionNode);
    const target = next?.querySelector<HTMLElement>('h2');
    if (target) target.focus();
    else heading.focus();
  }

  // ---- painting ----

  let openSections: SectionState[] = [];
  let allVessels: Vessel[] = [];

  /**
   * Every row is updated in place, so a refresh never replaces a row element,
   * loses keyboard focus or overwrites a pending button label.
   */
  function updateVesselRow(row: HTMLElement, vessel: Vessel): void {
    setText(row.querySelector('.vessel-name')!, vessel.name);
    const word = row.querySelector('[data-word]')!;
    const override = rowOverride.get(vessel.id);
    const pending = row.querySelector<HTMLButtonElement>('[data-pending="true"]');
    if (!pending) setText(word, override ?? (vessel.afloat ? 'Afloat' : 'Ashore'));
    setText(row.querySelector('[data-link]')!, vessel.link_state);
    setText(row.querySelector('[data-hours]')!, hoursText(vessel.hours_since_service));
    const afloatButton = row.querySelector<HTMLButtonElement>('[data-afloat]')!;
    const recoveredButton = row.querySelector<HTMLButtonElement>('[data-recovered]')!;
    for (const [control, action] of [
      [afloatButton, 'afloat'],
      [recoveredButton, 'recovered'],
    ] as const) {
      control.setAttribute('aria-label', `Mark ${vessel.name} ${action}`);
      if (control.dataset.pending !== 'true') setText(control, `Mark ${vessel.name} ${action}`);
      control.onclick = () => void mark(vessel, action, control);
    }
  }

  function createVesselRow(vessel: Vessel): HTMLElement {
    return el('div', { class: 'launch-row', 'data-vessel': vessel.id }, [
      el('span', { class: 'vessel-name' }),
      el('span', { 'data-word': '' }),
      el('span', { 'data-link': '' }),
      el('span', { 'data-hours': '', class: 'mono' }),
      button('', { 'data-afloat': '', class: 'small' }),
      button('', { 'data-recovered': '', class: 'small' }),
    ]);
  }

  function openUploadFor(line: Line, opener: HTMLButtonElement): void {
    held = openUploadDialog({
      shell,
      host: node,
      line,
      opener,
      held,
      setStatus: (text) => setText(status, text),
      setRowWord: (word) => {
        lineOverride.set(line.id, word);
        const target = node.querySelector(`[data-line="${line.id}"] [data-word]`);
        if (target) setText(target, word);
      },
      clearRowWord: () => {
        lineOverride.delete(line.id);
        void paint();
      },
    });
  }

  function createLineRow(line: Line): HTMLElement {
    return el('div', { class: 'launch-line', 'data-line': line.id }, [
      el('span', { class: 'mono', 'data-label': '' }),
      el('span', { 'data-word': '' }),
    ]);
  }

  function updateLineRow(row: HTMLElement, line: Line): void {
    setText(row.querySelector('[data-label]')!, line.label);
    const override = lineOverride.get(line.id);
    setText(
      row.querySelector('[data-word]')!,
      override ?? (line.file?.state === 'Stored' ? 'Stored' : 'Awaiting upload'),
    );
    const existing = row.querySelector<HTMLButtonElement>('[data-upload]');
    const wanted = line.file?.state !== 'Stored';
    if (wanted && !existing) {
      const upload = button(`Upload file for ${line.label}`, { 'data-upload': '', class: 'small' });
      upload.addEventListener('click', () => openUploadFor(line, upload));
      row.append(upload);
    } else if (wanted && existing) {
      existing.onclick = () => openUploadFor(line, existing);
    } else if (!wanted && existing) {
      existing.remove();
    }
  }

  function createSection(section: SectionState): HTMLElement {
    return el(
      'section',
      { role: 'region', 'aria-label': section.mission.name, class: 'launch-section' },
      [
        el('h2', { tabindex: '-1' }),
        el('p', { 'data-client': '' }),
        el('p', { 'data-status': '' }),
        el('div', { 'data-vessels': '' }),
        el('div', { 'data-lines': '' }),
      ],
    );
  }

  function updateSection(node_: HTMLElement, section: SectionState): void {
    const mission = section.mission;
    node_.setAttribute('aria-label', mission.name);
    setText(node_.querySelector('h2')!, mission.name);
    setText(node_.querySelector('[data-client]')!, mission.client_name);
    const statusWord = node_.querySelector('[data-status]')!;
    // A completed section keeps reading Complete until the refresh after two seconds.
    if (node_.querySelector('[data-pending="true"]') === null) {
      setText(statusWord, completedAt.has(mission.id) ? 'Complete' : mission.status);
    }

    reconcile(
      node_.querySelector('[data-vessels]')!,
      section.vessels,
      (vessel) => vessel.id,
      (vessel) => createVesselRow(vessel),
      (row, vessel) => updateVesselRow(row, vessel),
    );
    reconcile(
      node_.querySelector('[data-lines]')!,
      section.lines.filter((line) => line.status === 'Surveyed' || line.status === 'Delivered'),
      (line) => line.id,
      (line) => createLineRow(line),
      (row, line) => updateLineRow(row, line),
    );

    const existing = node_.querySelector<HTMLButtonElement>('[data-complete]');
    const wanted = mission.status === 'Recovering' && !completedAt.has(mission.id);
    if (wanted && !existing) {
      const complete = button('Mark mission complete', { 'data-complete': '' });
      complete.addEventListener('click', () => void completeMission(mission, complete, node_));
      node_.append(complete);
    } else if (wanted && existing) {
      existing.onclick = () => void completeMission(mission, existing, node_);
    } else if (!wanted && existing && existing.dataset.pending !== 'true') {
      existing.remove();
    }
  }

  function createServiceRow(): HTMLElement {
    return el('div', { class: 'service-row' }, [
      el('span', { 'data-name': '' }),
      el('span', { 'data-total': '', class: 'mono' }),
      el('span', { 'data-since': '', class: 'mono' }),
      el('span', { 'data-overdue': '' }),
      button('', { 'data-log': '', class: 'small' }),
    ]);
  }

  function updateServiceRow(row: HTMLElement, vessel: Vessel): void {
    setText(row.querySelector('[data-name]')!, vessel.name);
    setText(row.querySelector('[data-total]')!, hoursText(vessel.thruster_hours_total));
    setText(
      row.querySelector('[data-since]')!,
      `${hoursText(vessel.hours_since_service)} / ${intervalText(vessel.service_interval_h)} h`,
    );
    setText(row.querySelector('[data-overdue]')!, vessel.service_overdue ? 'Service overdue' : '');
    const log = row.querySelector<HTMLButtonElement>('[data-log]')!;
    setText(log, `Log service for ${vessel.name}`);
    log.onclick = () => openServiceDialog(vessel, log);
  }

  async function paint(): Promise<void> {
    if (disposed) return;
    reconcile(
      sections,
      openSections,
      (section) => section.mission.id,
      (section) => createSection(section),
      (node_, section) => updateSection(node_, section),
    );
    reconcile(
      serviceRows,
      allVessels,
      (vessel) => vessel.id,
      () => createServiceRow(),
      (row, vessel) => updateServiceRow(row, vessel),
    );
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    const at = shell.generation;
    try {
      const [summaries, vessels] = await Promise.all([
        request<MissionSummary[]>('/api/missions'),
        request<Vessel[]>('/api/vessels'),
      ]);
      if (!isCurrent(at) || disposed) return;
      allVessels = vessels;

      // A completed section keeps reading Complete for at least two seconds.
      for (const [id, when] of [...completedAt]) {
        if (Date.now() - when > 2000) completedAt.delete(id);
      }

      const open = summaries
        .filter(
          (mission) => OPEN_STATUSES.includes(mission.status) || completedAt.has(mission.id),
        )
        .sort((a, b) =>
          a.survey_date === b.survey_date
            ? a.name.localeCompare(b.name, 'en')
            : a.survey_date.localeCompare(b.survey_date),
        );

      openSections = await Promise.all(
        open.map(async (mission) => {
          const lines = await request<Line[]>(`/api/missions/${mission.id}/lines`);
          const assigned = new Set(
            lines.map((line) => line.vessel_id).filter((id): id is string => id !== null),
          );
          return {
            mission,
            lines,
            vessels: vessels.filter((vessel) => assigned.has(vessel.id)),
          } satisfies SectionState;
        }),
      );
      if (!isCurrent(at) || disposed) return;
      await paint();
    } catch {
      // The next refresh tries again; the list keeps what it shows.
    }
  }

  shell.onStatus((report) => {
    if (report.storage === 'up' && held) held.storageReturned();
  });

  void refresh().then(() => void queue.flush());
  timer = window.setInterval(() => void refresh(), REFRESH_MS);

  return {
    node,
    dispose: () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      shell.unregisterRegion('Launch status');
    },
  };
};
