import { EMPTY, LINK_PAGE, OUTAGE, PENDING, SUCCESS } from '../../shared/copy';
import { panelDiagramSvg } from '../../shared/diagram';
import { PANELS, isGaugeable, panelById } from '../../shared/panels';
import type { CaptureItem, CaptureResponse, LinkView } from '../../shared/types';
import { ApiRefusal, ApiUnreachable, request } from '../shared/api';
import { carFileFooter, serviceNotice, statusRegion } from '../shared/chrome';
import { el, focusTarget, onPress, setPending, svgFrom } from '../shared/dom';
import { announce } from '../shared/live';
import { gaugeText, onUnitsChange, unitsBar, unitsToggle } from '../shared/units';
import { endedLinkPage } from './endedPage';
import { CaptureQueue } from './queue';

/** The same cache the inspector service worker reads the page shell from. */
const SHELL_CACHE = 'open-bonnet-shell-v1';

const ARROW_STEP = 0.01;
const ARROW_SHIFT_STEP = 0.05;

export const renderInspector = (root: HTMLElement, token: string, first: LinkView): void => {
  let view = first;
  const queue = new CaptureQueue(token);
  queue.settleOnLoad();
  queue.rememberCar(view.car);
  if (view.panels.length > 0) queue.rememberPanels(view.panels);

  const captureStatus = statusRegion('Capture status');
  const notice = serviceNotice();
  notice.hidden = true;

  const panelList = el('ul', { class: 'capture-panels', role: 'list', 'aria-label': 'Capture panels' });
  const queueList = el('ul', { class: 'capture-queue', role: 'list', 'aria-label': 'Capture queue' });

  const panelChoice = el('select', { class: 'select-input', id: 'capture-panel' }) as HTMLSelectElement;
  panelChoice.setAttribute('aria-label', 'Panel');
  for (const panel of PANELS) {
    panelChoice.append(el('option', { value: panel.id, text: panel.label }));
  }

  const microns = el('input', {
    type: 'number',
    class: 'spin-input figures',
    id: 'capture-microns',
    min: '1',
    max: '2000',
    step: '1',
  }) as HTMLInputElement;
  microns.setAttribute('aria-label', 'Microns');

  const queueReading = el('button', { type: 'button', class: 'pill-solid', text: 'Queue reading' });
  const wording = el('textarea', { class: 'text-input', id: 'capture-wording', rows: 3 }) as HTMLTextAreaElement;
  wording.setAttribute('aria-label', 'Finding note');
  const queueFinding = el('button', { type: 'button', class: 'pill-solid', text: 'Queue finding' });
  const sendNow = el('button', { type: 'button', class: 'pill-outline', text: 'Send now' });

  const diagramHolder = el('div', { class: 'diagram-holder', role: 'img', 'aria-label': 'Panel diagram' });
  const pin = el('button', { type: 'button', class: 'finding-pin', text: 'Finding pin' });
  pin.setAttribute('aria-label', 'Finding pin');

  let anchor = { panelId: PANELS[0].id, u: 0.5, v: 0.5 };

  const paintDiagram = (): void => {
    diagramHolder.replaceChildren(
      svgFrom(
        panelDiagramSvg({
          pins: [{ panelId: anchor.panelId, u: anchor.u, v: anchor.v, label: 'Finding pin', kind: 'placing' }],
          activePanelId: anchor.panelId,
          interactive: true,
        }),
      ),
    );
    const svg = diagramHolder.firstElementChild;
    if (svg === null) return;
    svg.addEventListener('click', (event) => {
      const rect = (event.target as Element).closest<SVGRectElement>('[data-panel-id]');
      if (rect === null) return;
      event.preventDefault();
      const panelId = rect.dataset.panelId;
      if (panelId === undefined) return;
      const box = rect.getBoundingClientRect();
      const pointer = event as MouseEvent;
      anchor = {
        panelId,
        u: Math.min(1, Math.max(0, (pointer.clientX - box.left) / box.width)),
        v: Math.min(1, Math.max(0, (pointer.clientY - box.top) / box.height)),
      };
      panelChoice.value = panelId;
      paintDiagram();
      announcePin();
    });
  };

  const announcePin = (): void => {
    const panel = panelById(anchor.panelId);
    announce(
      captureStatus,
      `${panel?.label ?? anchor.panelId} at ${Math.round(anchor.u * 100)} across, ${Math.round(anchor.v * 100)} down`,
    );
  };

  pin.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? ARROW_SHIFT_STEP : ARROW_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    anchor = {
      panelId: anchor.panelId,
      u: Math.min(1, Math.max(0, Number((anchor.u + move[0]).toFixed(3)))),
      v: Math.min(1, Math.max(0, Number((anchor.v + move[1]).toFixed(3)))),
    };
    paintDiagram();
    announcePin();
  });

  panelChoice.addEventListener('change', () => {
    anchor = { panelId: panelChoice.value, u: 0.5, v: 0.5 };
    paintDiagram();
    announcePin();
  });

  const paintPanels = (): void => {
    const panels = view.panels.length > 0 ? view.panels : queue.panels();
    panelList.replaceChildren(
      ...panels.map((panel) =>
        el('li', { class: 'capture-panel-row' }, [
          el('span', { class: 'capture-panel-label', text: panel.label }),
          el('span', {
            class: 'capture-panel-owner figures',
            text:
              panel.owner === null
                ? panel.substrate === 'plastic'
                  ? 'Not gauged'
                  : 'No reading'
                : `${gaugeText(panel.owner.microns, panel.owner.mils)} ${panel.owner.band}`,
          }),
          el(
            'ul',
            { class: 'capture-panel-inspector' },
            panel.inspector.map((reading) =>
              el('li', {
                class: 'figures',
                text: `${gaugeText(reading.microns, reading.mils)} ${reading.band}`,
              }),
            ),
          ),
        ]),
      ),
    );
  };

  const paintQueue = (): void => {
    const rows = queue.rows();
    if (rows.length === 0) {
      queueList.replaceChildren(el('li', { class: 'empty-line', text: EMPTY.queue }));
      return;
    }
    queueList.replaceChildren(
      ...rows.map((row) => {
        const panel = panelById(row.item.panelId);
        const value = row.item.kind === 'reading' ? `${row.item.microns} microns` : row.item.wording;
        return el('li', { class: 'capture-queue-row', 'data-client-id': row.clientId }, [
          el('span', { class: 'queue-panel', text: panel?.label ?? row.item.panelId }),
          el('span', { class: 'queue-value figures', text: value }),
          el('span', { class: 'queue-word', text: row.word }),
          ...(row.reason === null ? [] : [el('span', { class: 'queue-reason', text: row.reason })]),
        ]);
      }),
    );
  };

  queue.onChange(paintQueue);
  onUnitsChange(() => {
    paintPanels();
    paintQueue();
  });

  onPress(queueReading, () => {
    const value = Number(microns.value);
    const panel = panelById(panelChoice.value);
    if (panel === undefined) return;
    if (!Number.isInteger(value) || value < 1 || value > 2000) {
      announce(captureStatus, 'Enter whole microns from 1 to 2000');
      return;
    }
    if (!isGaugeable(panel)) {
      announce(captureStatus, 'Plastic panels cannot be gauged');
      return;
    }
    queue.add({
      clientId: crypto.randomUUID(),
      kind: 'reading',
      panelId: panel.id,
      microns: value,
      capturedAt: new Date().toISOString(),
    });
    microns.value = '';
    paintQueue();
    void sendBatch();
  });

  onPress(queueFinding, () => {
    const note = wording.value.trim();
    if (note.length === 0) {
      announce(captureStatus, 'Enter between 1 and 600 characters');
      return;
    }
    queue.add({
      clientId: crypto.randomUUID(),
      kind: 'finding',
      panelId: anchor.panelId,
      u: anchor.u,
      v: anchor.v,
      wording: note,
      capturedAt: new Date().toISOString(),
    });
    wording.value = '';
    paintQueue();
    void sendBatch();
  });

  onPress(sendNow, () => {
    if (queue.queued().length === 0) return;
    void sendBatch();
  });

  /** Only one batch is in flight at a time across every tab of this link. */
  const sendBatch = async (): Promise<void> => {
    const batchId = crypto.randomUUID();
    const claimed = queue.claimBatch(batchId);
    if (claimed === null) return;
    paintQueue();
    setPending(sendNow, true);
    announce(captureStatus, PENDING.captureSend);

    const items: CaptureItem[] = claimed.map((row) => row.item);
    try {
      const reply = await request<CaptureResponse>(`/api/link/${token}/capture`, {
        method: 'POST',
        body: { batchId, items },
      });
      queue.applyResults(reply.results);
      paintQueue();
      await refreshPanels();
      announce(captureStatus, SUCCESS.captureSend);
      for (const result of reply.results) {
        if (result.state === 'rejected' && result.errors !== undefined) {
          announce(captureStatus, Object.values(result.errors).join(' '));
        }
      }
    } catch (error) {
      if (error instanceof ApiRefusal && (error.status === 404 || error.status === 410)) {
        queue.rejectAll(
          claimed.map((row) => row.clientId),
          LINK_PAGE.endedDuringReplay,
        );
        paintQueue();
        announce(captureStatus, LINK_PAGE.endedDuringReplay);
        return;
      }
      if (error instanceof ApiRefusal && error.status < 500) {
        queue.rejectAll(
          claimed.map((row) => row.clientId),
          error.body.message,
        );
        paintQueue();
        announce(captureStatus, error.body.message);
        return;
      }
      void (error instanceof ApiUnreachable);
      queue.releaseBatch(claimed.map((row) => row.clientId));
      paintQueue();
      notice.hidden = false;
      announce(notice, OUTAGE.capture);
    } finally {
      if (sendNow.isConnected) setPending(sendNow, false);
    }
  };

  /** The inspector page does not poll: it refreshes its panels after each capture reply. */
  const refreshPanels = async (): Promise<void> => {
    try {
      view = await request<LinkView>(`/api/link/${token}`);
      queue.rememberPanels(view.panels);
      paintPanels();
    } catch (error) {
      if (error instanceof ApiRefusal && (error.status === 404 || error.status === 410)) {
        endedLinkPage(root, 'ended');
      }
    }
  };

  window.addEventListener('online', () => {
    void sendBatch();
  });

  const form = el('section', { class: 'capture-form' }, [
    el('h2', { class: 'section-heading', text: 'Record a reading' }),
    el('label', { class: 'field-label', for: 'capture-panel', text: 'Panel' }),
    panelChoice,
    el('label', { class: 'field-label', for: 'capture-microns', text: 'Microns' }),
    microns,
    queueReading,
    el('h2', { class: 'section-heading', text: 'Place a finding' }),
    diagramHolder,
    pin,
    el('label', { class: 'field-label', for: 'capture-wording', text: 'Finding note' }),
    wording,
    queueFinding,
    sendNow,
  ]);

  root.replaceChildren(
    unitsBar(),
    el('header', { class: 'inspector-header' }, [
      el('span', { class: 'wordmark', text: 'Ostler Lane' }),
      el('p', { class: 'inspector-car', text: `${view.car.name} · ${view.car.maskedRegistration}` }),
      el('div', { class: 'inspector-units' }, [el('span', { text: 'Units' }), unitsToggle()]),
    ]),
    notice,
    captureStatus,
    el('main', { class: 'inspector-main' }, [
      el('section', { class: 'capture-panel-list' }, [
        el('h2', { class: 'section-heading', text: 'Panels and readings' }),
        panelList,
      ]),
      el('div', { class: 'capture-right' }, [
        form,
        el('section', { class: 'capture-queue-section' }, [
          el('h2', { class: 'section-heading', text: 'Capture queue' }),
          queueList,
        ]),
      ]),
    ]),
    carFileFooter(),
  );

  paintPanels();
  paintDiagram();
  paintQueue();
  focusTarget(panelChoice);

  if ('serviceWorker' in navigator) {
    void (async (): Promise<void> => {
      try {
        await navigator.serviceWorker.register('/inspector-sw.js', { scope: '/l/' });
        await navigator.serviceWorker.ready;
        // The shell for this very link, so an offline reload has something to open.
        const cache = await caches.open(SHELL_CACHE);
        await cache.add(new Request(window.location.pathname, { cache: 'reload' }));
      } catch {
        // With no connection there is nothing to cache yet, and the queue still holds.
      }
    })();
  }
};
