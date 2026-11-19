// The inspector's capture screen. It keeps working with no signal: queue actions write to the
// device first, and the queue and the last panels survive a reload.

import { api, NoReply, Refused } from '../api.js';
import { bandClass } from '../format.js';
import { el, find, on, svg } from '../dom.js';
import { CAPTURE_WORD, MESSAGE } from '../../shared/copy.js';
import { PANELS, isGaugeable, panelOf } from '../../shared/panels.js';
import { DIAGRAM_HEIGHT, DIAGRAM_WIDTH, diagramSvg, pinAt, rectOf } from '../../shared/diagram.js';
import { carFileFooter } from '../parts/footer.js';
import { onUnitsChange, showMicrons, unitsBar, unitsButton } from '../parts/units.js';
import { CaptureQueue, type QueueItem } from '../capture/queue.js';
import { announce, statusRegion } from '../ui/status.js';
import { pressable } from '../ui/pending.js';
import { emptyState, endedPage } from './ended.js';
import { keepView } from '../held-view.js';
import type { LinkView, PanelView } from '../types.js';

export function inspectorPage(root: HTMLElement, token: string, view: LinkView): void {
  new InspectorPage(root, token, view).mount();
}

class InspectorPage {
  private view: LinkView;
  private readonly token: string;
  private readonly root: HTMLElement;
  private readonly queue: CaptureQueue;
  private readonly status = statusRegion('Capture status');
  private readonly notice = el('p', { role: 'alert', 'aria-label': 'Service notice', class: 'notice-panel', hidden: true });
  private readonly panelList = el('ul', { role: 'list', 'aria-label': 'Capture panels', class: 'panel-list' });
  private readonly queueList = el('ul', { role: 'list', 'aria-label': 'Capture queue', class: 'queue-list' });
  private readonly diagram = el('div', { class: 'diagram-holder' });
  private panelId = PANELS[0].id;
  private pin = { u: 0.5, v: 0.5 };
  private sending = false;

  constructor(root: HTMLElement, token: string, view: LinkView) {
    this.root = root;
    this.token = token;
    this.view = view;
    this.queue = new CaptureQueue(token);
  }

  mount(): void {
    this.queue.settleOnLoad();
    this.root.replaceChildren(this.build());
    this.paintPanels();
    this.paintQueue();
    this.paintDiagram();
    this.queue.onChange(() => this.paintQueue());
    onUnitsChange(() => this.paintPanels());
    // Queued rows go when the browser reports a connection, or when Send now is pressed.
    on(window, 'online', () => void this.send(false));
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }

  private build(): HTMLElement {
    const panelChoice = el('select', { 'aria-label': 'Panel', class: 'field-input' },
      PANELS.map((panel) => el('option', { value: panel.id }, [panel.label])));
    on(panelChoice, 'change', () => {
      this.panelId = panelChoice.value;
      this.pin = { u: 0.5, v: 0.5 };
      this.paintDiagram();
    });

    const microns = el('input', {
      type: 'number', min: '1', max: '2000', step: '1', 'aria-label': 'Microns', class: 'field-input figures',
    });
    const queueReading = el('button', { type: 'button', class: 'pill pill-solid' }, ['Queue reading']);
    on(queueReading, 'click', () => {
      const value = Number(microns.value);
      if (!Number.isInteger(value) || value < 1 || value > 2000) {
        announce(this.status, MESSAGE.microns);
        return;
      }
      if (!isGaugeable(this.panelId)) {
        announce(this.status, MESSAGE.plastic);
        return;
      }
      this.queue.add({
        clientId: crypto.randomUUID(),
        kind: 'reading',
        panelId: this.panelId,
        panelLabel: panelOf(this.panelId).label,
        microns: value,
        capturedAt: new Date().toISOString(),
        state: 'queued',
      });
      microns.value = '';
      this.paintQueue();
    });

    const note = el('input', { type: 'text', 'aria-label': 'Finding note', class: 'field-input' });
    const queueFinding = el('button', { type: 'button', class: 'pill pill-solid' }, ['Queue finding']);
    on(queueFinding, 'click', () => {
      if (note.value.trim().length === 0) {
        announce(this.status, 'Write a note for the finding');
        return;
      }
      this.queue.add({
        clientId: crypto.randomUUID(),
        kind: 'finding',
        panelId: this.panelId,
        panelLabel: panelOf(this.panelId).label,
        u: this.pin.u,
        v: this.pin.v,
        wording: note.value.trim(),
        capturedAt: new Date().toISOString(),
        state: 'queued',
      });
      note.value = '';
      this.paintQueue();
    });

    const sendNow = el('button', { type: 'button', class: 'pill pill-solid' }, ['Send now']);
    pressable(sendNow, () => this.send(true));

    const pinButton = el('button', { type: 'button', class: 'pin-button' }, ['Finding pin']);
    on(pinButton, 'keydown', (event) => this.movePin(event as KeyboardEvent));

    return el('div', { class: 'inspector-page' }, [
      unitsBar(),
      el('header', { class: 'work-header' }, [
        el('span', { class: 'wordmark' }, ['Ostler Lane']),
        el('p', { class: 'work-car' }, [
          el('span', {}, [this.view.car.name]),
          el('span', { class: 'figures' }, [this.view.car.maskedRegistration]),
        ]),
      ]),
      this.notice,
      el('main', { id: 'main', class: 'inspector-main' }, [
        el('section', { class: 'card panel-column' }, [
          el('h2', {}, ['Panels and readings']),
          el('div', { class: 'phone-units' }, [el('span', {}, ['Units']), unitsButton()]),
          this.panelList,
        ]),
        el('section', { class: 'card capture-column' }, [
          el('h2', {}, ['Record a reading']),
          el('label', { class: 'field' }, [el('span', {}, ['Panel']), panelChoice]),
          el('label', { class: 'field' }, [el('span', {}, ['Microns']), microns]),
          queueReading,
          el('h2', {}, ['Pin a finding']),
          this.diagram,
          pinButton,
          el('label', { class: 'field' }, [el('span', {}, ['Finding note']), note]),
          queueFinding,
          el('h2', {}, ['Capture queue']),
          this.queueList,
          sendNow,
          this.status,
        ]),
      ]),
      carFileFooter(),
    ]);
  }

  private movePin(event: KeyboardEvent): void {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const size = event.shiftKey ? 0.05 : 0.01;
    this.pin = {
      u: Math.min(1, Math.max(0, Math.round((this.pin.u + step[0] * size) * 1000) / 1000)),
      v: Math.min(1, Math.max(0, Math.round((this.pin.v + step[1] * size) * 1000) / 1000)),
    };
    this.paintDiagram();
    announce(this.status, `Pin at ${Math.round(this.pin.u * 100)}% across, ${Math.round(this.pin.v * 100)}% down`);
  }

  private paintDiagram(): void {
    const at = pinAt(this.panelId, this.pin.u, this.pin.v);
    const markup = diagramSvg({
      interactive: true,
      pins: at ? [{ x: at.x, y: at.y, label: 'Finding pin', strong: true }] : [],
    });
    const node = svg(markup);
    this.diagram.replaceChildren(node);
    on(node, 'pointerdown', (event) => {
      const pointer = event as PointerEvent;
      const rect = node.getBoundingClientRect();
      const x = ((pointer.clientX - rect.left) / rect.width) * DIAGRAM_WIDTH;
      const y = ((pointer.clientY - rect.top) / rect.height) * DIAGRAM_HEIGHT;
      const hit = [...PANELS].map((panel) => rectOf(panel.id)).find((shape) =>
        shape && x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height);
      if (!hit) return;
      event.preventDefault();
      this.panelId = hit.id;
      const choice = find<HTMLSelectElement>(this.root, 'select[aria-label="Panel"]');
      if (choice) choice.value = hit.id;
      this.pin = {
        u: Math.round(((x - hit.x) / hit.width) * 1000) / 1000,
        v: Math.round(((y - hit.y) / hit.height) * 1000) / 1000,
      };
      this.paintDiagram();
    });
  }

  private paintPanels(): void {
    this.panelList.replaceChildren(...this.view.panels.map((panel: PanelView) => el('li', { class: 'panel-row' }, [
      el('span', { class: 'panel-name' }, [panel.label]),
      // The band word says why a panel has no figure.
      el('span', { class: 'figures panel-figure' }, [
        panel.owner.microns == null ? '—' : showMicrons(panel.owner.microns),
      ]),
      el('span', { class: `panel-band ${bandClass(panel.owner.band)}` }, [panel.owner.band]),
      el('span', { class: 'figures panel-mine' }, [
        panel.inspector.map((row) => showMicrons(row.microns)).join(', '),
      ]),
    ])));
  }

  private paintQueue(): void {
    const items = this.queue.items();
    if (items.length === 0) {
      this.queueList.replaceChildren(el('li', {}, [emptyState(MESSAGE.nothingQueued)]));
      return;
    }
    this.queueList.replaceChildren(...items.map((item) => el('li', { class: 'queue-row' }, [
      el('span', {}, [item.panelLabel]),
      el('span', { class: 'figures' }, [
        item.kind === 'reading' ? showMicrons(item.microns ?? null) : (item.wording ?? ''),
      ]),
      el('span', { class: `queue-state state-${item.state}` }, [CAPTURE_WORD[item.state]]),
      ...(item.reason ? [el('span', { class: 'queue-reason' }, [item.reason])] : []),
    ])));
  }

  private async send(pressed: boolean): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      await this.queue.alone(async () => {
        const waiting = this.queue.waiting();
        if (waiting.length === 0) return;
        const ids = waiting.map((item) => item.clientId);
        this.queue.mark(ids, 'sending');
        this.paintQueue();
        announce(this.status, 'Sending queued items');
        try {
          const reply = await api.post<{
            results: { clientId: string; state: string; errors?: Record<string, string> }[];
          }>(`/api/link/${this.token}/capture`, {
            batchId: crypto.randomUUID(),
            items: waiting.map(toItem),
          });
          this.queue.applyResults(reply.results);
          this.paintQueue();
          await this.refreshPanels();
          announce(this.status, 'All items synced');
          this.notice.hidden = true;
        } catch (error) {
          if (error instanceof Refused && (error.status === 404 || error.status === 410)) {
            this.queue.mark(ids, 'rejected', MESSAGE.replayEnded);
            this.paintQueue();
            announce(this.status, MESSAGE.replayEnded);
            return;
          }
          this.queue.mark(ids, 'queued');
          this.paintQueue();
          if (error instanceof NoReply || !navigator.onLine) {
            this.notice.hidden = false;
            this.notice.textContent = MESSAGE.captureOffline;
            announce(this.status, MESSAGE.captureOffline);
          } else {
            announce(this.status, (error as Refused).body.message);
          }
          void pressed;
        }
      });
    } finally {
      this.sending = false;
    }
  }

  private async refreshPanels(): Promise<void> {
    try {
      const view = await api.get<LinkView>(`/api/link/${this.token}`);
      this.view = view;
      keepView(this.token, view);
      this.paintPanels();
    } catch (error) {
      if (error instanceof Refused && (error.status === 404 || error.status === 410)) {
        endedPage(this.root, MESSAGE.linkEndedHeading, MESSAGE.linkEndedBody);
      }
    }
  }
}

function toItem(item: QueueItem): Record<string, unknown> {
  return item.kind === 'reading'
    ? {
      clientId: item.clientId, kind: 'reading', panelId: item.panelId,
      microns: item.microns, capturedAt: item.capturedAt,
    }
    : {
      clientId: item.clientId, kind: 'finding', panelId: item.panelId,
      u: item.u, v: item.v, wording: item.wording, capturedAt: item.capturedAt,
    };
}
