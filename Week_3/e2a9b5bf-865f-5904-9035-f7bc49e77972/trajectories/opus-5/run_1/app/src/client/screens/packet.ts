import { PACKET_COPY, downloadStorageOutage, GLOBAL_COPY, rowMoved } from '../../shared/messages.js';
import { PACKET_BUTTON_STATES } from '../../shared/packet-state.js';
import {
  packetPageContent,
  PACKET_PAGE_HEIGHT_IN,
  PACKET_PAGE_WIDTH_IN,
  type PacketPage,
} from '../../shared/packet-page.js';
import { deriveFromKit, resolveOptics } from '../../shared/optics.js';
import { localClock, parseTimestamp, utcOffset } from '../../shared/clock.js';
import type { Packet, PacketReason, Program } from '../../shared/types.js';
import { api, fetchBytes } from '../api.js';
import { missingScreen, notFoundScreen, workingScreen } from '../chrome.js';
import { viewObservation, viewStrokeFile } from '../derive.js';
import { el, setStatus } from '../dom.js';
import { openDialog } from '../dialogs.js';
import { prefetchAccount } from '../prefetch.js';
import { regions } from '../regions.js';
import { onLeaveScreen, type ScreenContext } from '../router.js';
import { appState, updateCopy } from '../state.js';
import {
  applyServerPacket,
  checkFailedSentence,
  enterSending,
  leaveSending,
  loadPanel,
  mailOutageSentence,
  panelFor,
  setMessage,
  storageSendSentence,
} from '../packet-panel.js';

const CSS_PX_PER_INCH = 96;

/** A send outlives the screen that started it. */
const sendsInFlight = new Map<string, Promise<void>>();

function programFor(programId: string): Program | null {
  return appState().copy.programs.find((entry) => entry.id === programId) ?? null;
}

function pagesFor(packet: Packet, program: Program): PacketPage[] {
  const state = appState();
  const kit = state.copy.kit;
  const account = state.account;
  if (!kit || !account) return [];
  const pages: PacketPage[] = [
    {
      kind: 'cover',
      number: packet.number,
      program_name: program.name,
      display_name: account.display_name,
      email: account.email,
      row_count: packet.rows.length,
      coordinator_name: program.coordinator_name,
    },
  ];
  for (const row of packet.rows) {
    const observation = viewObservation(row.observation_id);
    if (!observation) continue;
    const parts = resolveOptics(kit, observation.optics);
    const derived = deriveFromKit(kit, observation.optics);
    const observedAt = observation.observed_at ? parseTimestamp(observation.observed_at) : null;
    if (!parts || !derived || !observedAt || observation.seeing === null) continue;
    pages.push({
      kind: 'row',
      designation: observation.designation,
      object_name:
        state.copy.objects.find((entry) => entry.id === observation.object_id)?.name ?? '',
      ut_date: observation.observed_at?.slice(0, 10) ?? '',
      ut_time: observation.observed_at?.slice(11, 16) ?? '',
      local_time: localClock(observedAt, observation.site.time_zone),
      local_offset: utcOffset(observedAt, observation.site.time_zone),
      time_zone: observation.site.time_zone,
      site_name: observation.site.name,
      seeing: observation.seeing,
      transparency_nelm: observation.transparency_nelm ?? 0,
      telescope_name: parts.telescope.name,
      aperture_mm: parts.telescope.aperture_mm,
      eyepiece_name: parts.eyepiece.name,
      barlow_name: parts.barlow ? parts.barlow.name : null,
      magnification: derived.magnification,
      true_field_arcmin: derived.true_field_arcmin,
      exit_pupil_mm: derived.exit_pupil_mm,
      orientation_sentence: derived.orientation.sentence,
      train: observation.optics.train,
      edition: row.edition,
      is_globular: observation.kind === 'globular',
      concentration_class: observation.concentration_class,
      is_double_star: observation.kind === 'double_star',
      pair: observation.pair,
      description: observation.description,
      sketch: viewStrokeFile(observation.id),
    });
  }
  return pages;
}

function previewWidth(): number {
  return window.innerWidth < 600 ? 343 : 520;
}

function paperPreview(pages: PacketPage[]): HTMLElement {
  const region = el('div', {
    class: 'paper-preview',
    attrs: { role: 'region', 'aria-label': 'Paper preview' },
  });
  const width = previewWidth();
  const scale = width / (PACKET_PAGE_WIDTH_IN * CSS_PX_PER_INCH);
  for (const [index, page] of pages.entries()) {
    const inner = el('div', {
      class: 'lowlamp-page',
      html: packetPageContent(page),
      attrs: { style: `transform:scale(${scale});transform-origin:top left` },
    });
    region.append(
      el(
        'article',
        {
          class: 'paper-page',
          attrs: {
            'aria-label': `Page ${index + 1} of ${pages.length}`,
            style: `width:${width}px;height:${(width * PACKET_PAGE_HEIGHT_IN) / PACKET_PAGE_WIDTH_IN}px`,
          },
        },
        [inner],
      ),
    );
  }
  return region;
}

export async function renderPacket(context: ScreenContext): Promise<HTMLElement> {
  const packetId = context.params.id ?? '';
  const answer = await api.get<Packet>(`/api/packets/${encodeURIComponent(packetId)}`);
  if (answer.status === 404) return notFoundScreen();
  if (answer.ok && answer.body) {
    const fetched = answer.body;
    updateCopy((copy) => {
      copy.packets[fetched.id] = fetched;
    });
  }
  const stored = appState().copy.packets[packetId] ?? null;
  if (!stored) return missingScreen();
  let packet: Packet = stored;
  await prefetchAccount();
  const found = programFor(packet.program_id);
  if (!found) return missingScreen();
  const program: Program = found;

  const { root, content } = workingScreen(`Packet ${packet.number} · ${program.name}`);
  const panel = await loadPanel(packetId, packet, program.coordinator_name);
  if (answer.ok && answer.body) {
    applyServerPacket(packetId, answer.body, program.coordinator_name);
  }

  const status = el('div', {
    class: 'packet-status',
    attrs: {
      role: 'status',
      'aria-label': 'Packet status',
      'aria-live': 'polite',
      tabindex: '-1',
    },
  });
  regions.packetStatus = status;
  const rowsStatus = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Packet rows status', 'aria-live': 'polite' },
  });
  regions.packetRowsStatus = rowsStatus;
  const rowsList = el('ul', {
    class: 'list',
    attrs: { role: 'list', 'aria-label': 'Packet rows' },
  });
  const problems = el('ul', {
    class: 'list problems',
    attrs: { role: 'list', 'aria-label': 'Packet problems', tabindex: '-1' },
  });
  const actions = el('div', { class: 'packet-actions' });
  const downloadHolder = el('div', { class: 'packet-download' });
  const previewHolder = el('div', { class: 'packet-preview' });

  let reasons: PacketReason[] = [];
  let actionInFlight = false;
  let pollTimer: number | null = null;
  let pollInFlight = false;
  let open = true;

  const paintPanel = (): void => {
    const current = panelFor(packetId);
    if (!current) return;
    const text = `${current.label}\n${current.message ?? current.sentence}`;
    if (status.dataset.text === text) return;
    status.dataset.text = text;
    status.replaceChildren(
      el('p', { class: 'packet-label', text: current.label }),
      el('p', { class: 'packet-sentence', text: current.message ?? current.sentence }),
    );
  };

  const stalePaint = (fresh: Packet): void => {
    packet = fresh;
    updateCopy((copy) => {
      copy.packets[fresh.id] = fresh;
    });
    applyServerPacket(packetId, fresh, program.coordinator_name);
    setMessage(packetId, PACKET_COPY.stale);
    reasons = [];
    paint();
    status.focus();
  };

  const sendRows = async (
    observationIds: string[],
    onDone: (fresh: Packet) => void,
  ): Promise<void> => {
    const current = packet;
    const reply = await api.put<Packet>(`/api/packets/${packetId}/rows`, {
      revision: current.revision,
      observation_ids: observationIds,
    });
    if (reply.offline) {
      setMessage(packetId, GLOBAL_COPY.needs_signal);
      paintPanel();
      return;
    }
    if (reply.status === 412 || reply.status === 409) {
      const fresh = await api.get<Packet>(`/api/packets/${packetId}`);
      if (fresh.ok && fresh.body) stalePaint(fresh.body);
      return;
    }
    if (reply.status !== 200 || !reply.body) {
      setMessage(packetId, GLOBAL_COPY.internal);
      paintPanel();
      return;
    }
    packet = reply.body;
    updateCopy((copy) => {
      copy.packets[packetId] = reply.body;
    });
    applyServerPacket(packetId, reply.body, program.coordinator_name);
    reasons = [];
    onDone(reply.body);
  };

  const removeRow = (observationId: string, index: number, button: HTMLElement): void => {
    if (actionInFlight) return;
    actionInFlight = true;
    const remaining = packet.observation_ids.filter((id) => id !== observationId);
    void sendRows(remaining, () => {
      actionInFlight = false;
      paint();
      const buttons = [...rowsList.querySelectorAll<HTMLElement>('button.remove')];
      const target = buttons[index] ?? buttons[index - 1];
      if (target) target.focus();
      else actions.querySelector<HTMLElement>('button.check')?.focus();
      void button;
    }).finally(() => {
      actionInFlight = false;
    });
  };

  const moveRow = (index: number, direction: -1 | 1): void => {
    if (actionInFlight) return;
    const order = [...packet.observation_ids];
    const target = index + direction;
    const moved = order[index];
    const swapped = order[target];
    if (moved === undefined || swapped === undefined) return;
    order[index] = swapped;
    order[target] = moved;
    const designation =
      packet.rows.find((row) => row.observation_id === moved)?.designation ??
      viewObservation(moved)?.designation ??
      '';
    actionInFlight = true;
    void sendRows(order, () => {
      actionInFlight = false;
      setStatus(rowsStatus, rowMoved(designation, target + 1, order.length));
      paint();
      const row = rowsList.children[target] as HTMLElement | undefined;
      const same = row?.querySelector<HTMLElement>(
        direction === -1 ? 'button.move-up' : 'button.move-down',
      );
      const other = row?.querySelector<HTMLElement>(
        direction === -1 ? 'button.move-down' : 'button.move-up',
      );
      (same ?? other)?.focus();
    }).finally(() => {
      actionInFlight = false;
    });
  };

  const paintRows = (): void => {
    const ids = packet.observation_ids;
    const editable = packet.state === 'draft' || packet.state === 'checked';
    rowsList.replaceChildren(
      ...ids.map((observationId, index) => {
        const row = packet.rows.find((entry) => entry.observation_id === observationId);
        const observation = viewObservation(observationId);
        const designation = row?.designation ?? observation?.designation ?? '';
        const date = row?.evening_date ?? observation?.evening_date ?? '';
        const children: Array<Node | string | null> = [
          el('span', { class: 'row-name', text: designation }),
          el('span', { class: 'row-detail', text: date }),
        ];
        if (editable) {
          const controls: HTMLElement[] = [];
          if (index > 0) {
            const up = el('button', {
              class: 'button row-button move-up',
              text: `Move ${designation} up`,
              attrs: { type: 'button' },
            });
            up.addEventListener('click', () => moveRow(index, -1));
            controls.push(up);
          }
          if (index < ids.length - 1) {
            const down = el('button', {
              class: 'button row-button move-down',
              text: `Move ${designation} down`,
              attrs: { type: 'button' },
            });
            down.addEventListener('click', () => moveRow(index, 1));
            controls.push(down);
          }
          if (ids.length > 1) {
            const remove = el('button', {
              class: 'button row-button remove',
              text: `Remove ${designation}`,
              attrs: { type: 'button' },
            });
            remove.addEventListener('click', () => removeRow(observationId, index, remove));
            controls.push(remove);
          }
          children.push(el('div', { class: 'row-actions' }, controls));
        }
        return el('li', { class: 'row' }, children);
      }),
    );
  };

  const runAction = (
    path: string,
    pressed: HTMLElement,
    after: (fresh: Packet) => void,
  ): void => {
    if (actionInFlight) return;
    actionInFlight = true;
    void (async () => {
      const reply = await api.post<Packet & { reasons?: PacketReason[] }>(path, {
        revision: packet.revision,
      });
      actionInFlight = false;
      if (reply.offline) {
        setMessage(packetId, GLOBAL_COPY.needs_signal);
        paintPanel();
        return;
      }
      if (reply.status === 412 || reply.status === 409) {
        const fresh = await api.get<Packet>(`/api/packets/${packetId}`);
        if (fresh.ok && fresh.body) stalePaint(fresh.body);
        return;
      }
      if (reply.status === 422 && reply.body?.reasons) {
        reasons = reply.body.reasons;
        setMessage(packetId, checkFailedSentence(reasons.length));
        paint();
        problems.focus();
        return;
      }
      if (!reply.ok || !reply.body) {
        setMessage(packetId, GLOBAL_COPY.internal);
        paintPanel();
        void pressed;
        return;
      }
      packet = reply.body;
      updateCopy((copy) => {
        copy.packets[packetId] = reply.body;
      });
      applyServerPacket(packetId, reply.body, program.coordinator_name);
      setMessage(packetId, null);
      reasons = [];
      after(reply.body);
    })();
  };

  const startSend = (): void => {
    const current = packet;
    enterSending(packetId, current, program.coordinator_name);
    paint();
    status.focus();
    const run = (async () => {
      const reply = await api.post<Packet>(`/api/packets/${packetId}/send`, {
        revision: current.revision,
      });
      leaveSending(packetId);
      sendsInFlight.delete(packetId);
      if (reply.offline) {
        const fresh = await api.get<Packet>(`/api/packets/${packetId}`);
        if (fresh.ok && fresh.body) {
          applyServerPacket(packetId, fresh.body, program.coordinator_name, {
            ownSendAnswer: true,
          });
          packet = fresh.body;
        }
        setMessage(packetId, GLOBAL_COPY.needs_signal);
        if (open) paint();
        return;
      }
      if (reply.status === 200 && reply.body) {
        packet = reply.body;
        updateCopy((copy) => {
          copy.packets[packetId] = reply.body;
        });
        applyServerPacket(packetId, reply.body, program.coordinator_name, { ownSendAnswer: true });
        setMessage(packetId, null);
        if (open) paint();
        return;
      }
      const fresh = await api.get<Packet>(`/api/packets/${packetId}`);
      if (fresh.ok && fresh.body) {
        packet = fresh.body;
        updateCopy((copy) => {
          copy.packets[packetId] = fresh.body;
        });
        applyServerPacket(packetId, fresh.body, program.coordinator_name, { ownSendAnswer: true });
      }
      const body = reply.body as { error?: string } | null;
      if (reply.status === 503) {
        setMessage(
          packetId,
          body?.error === 'storage_unavailable'
            ? storageSendSentence(packet)
            : mailOutageSentence(packet),
        );
      } else if (reply.status === 502) {
        setMessage(packetId, null);
      } else if (reply.status === 412 || reply.status === 409) {
        setMessage(packetId, PACKET_COPY.stale);
      } else {
        setMessage(packetId, GLOBAL_COPY.internal);
      }
      if (open) paint();
    })();
    sendsInFlight.set(packetId, run);
  };

  const askToSend = (opener: HTMLElement): void => {
    openDialog({
      name: 'Send packet',
      text: `Send packet ${packet.number} to ${program.coordinator_name} at ${program.coordinator_email}?`,
      confirmLabel: 'Send now',
      cancelLabel: 'Cancel',
      focus: 'confirm',
      opener,
      onConfirm: startSend,
    });
  };

  const downloadPdf = (): void => {
    void (async () => {
      const reply = await fetchBytes(`/api/packets/${packetId}/pdf`);
      if (reply.status === 200 && reply.bytes) {
        const url = URL.createObjectURL(new Blob([reply.bytes], { type: 'application/pdf' }));
        const anchor = el('a', {
          attrs: { href: url, download: `lowlamp-packet-${packet.number}.pdf` },
        });
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        return;
      }
      setMessage(
        packetId,
        reply.status === 503 ? downloadStorageOutage(packet.number) : GLOBAL_COPY.internal,
      );
      paintPanel();
    })();
  };

  const paintActions = (): void => {
    const current = panelFor(packetId);
    const sending = current?.sendInFlight === true || packet.state === 'sending';
    const children: HTMLElement[] = [];
    if (PACKET_BUTTON_STATES.check.includes(packet.state as 'draft')) {
      const check = el('button', {
        class: 'button accent check',
        text: 'Check packet',
        attrs: { type: 'button' },
      });
      check.addEventListener('click', () =>
        runAction(`/api/packets/${packetId}/check`, check, () => {
          paint();
          status.focus();
        }),
      );
      children.push(check);
    }
    if (PACKET_BUTTON_STATES.render.includes(packet.state as 'checked')) {
      const render = el('button', {
        class: 'button accent render',
        text: 'Render packet',
        attrs: { type: 'button' },
      });
      render.addEventListener('click', () =>
        runAction(`/api/packets/${packetId}/render`, render, () => {
          paint();
          status.focus();
        }),
      );
      children.push(render);
    }
    if (PACKET_BUTTON_STATES.try_again.includes(packet.state as 'render_failed')) {
      const retry = el('button', {
        class: 'button accent retry',
        text: 'Try again',
        attrs: { type: 'button' },
      });
      retry.addEventListener('click', () =>
        runAction(`/api/packets/${packetId}/render`, retry, () => {
          paint();
          status.focus();
        }),
      );
      children.push(retry);
    }
    if (
      !sending &&
      PACKET_BUTTON_STATES.send.includes(packet.state as 'rendered' | 'send_failed')
    ) {
      const send = el('button', {
        class: 'button accent send',
        text: 'Send to coordinator',
        attrs: { type: 'button' },
      });
      send.addEventListener('click', () => askToSend(send));
      children.push(send);
    }
    actions.replaceChildren(...children);

    if (packet.pdf && packet.state !== 'draft' && packet.state !== 'checked') {
      const download = el('a', {
        class: 'link download',
        text: 'Download PDF',
        attrs: { href: `/api/packets/${packetId}/pdf` },
        on: {
          click: (event) => {
            event.preventDefault();
            downloadPdf();
          },
        },
      });
      downloadHolder.replaceChildren(download);
      previewHolder.replaceChildren(paperPreview(pagesFor(packet, program)));
    } else {
      downloadHolder.replaceChildren();
      previewHolder.replaceChildren();
    }
  };

  const paintProblems = (): void => {
    problems.replaceChildren(
      ...reasons.map((reason) => el('li', { class: 'problem', text: reason.message })),
    );
    problems.classList.toggle('hidden', reasons.length === 0);
  };

  function paint(): void {
    paintPanel();
    paintRows();
    paintProblems();
    paintActions();
    poll();
  }

  /** One timer, at most one request in flight, only while rendering or sending. */
  function poll(): void {
    const panelState = panelFor(packetId);
    const needed =
      packet.state === 'rendering' ||
      packet.state === 'sending' ||
      panelState?.sendInFlight === true;
    if (!needed || !open) {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => {
      if (pollInFlight || !open) return;
      pollInFlight = true;
      void api.get<Packet>(`/api/packets/${packetId}`).then((reply) => {
        pollInFlight = false;
        if (!open || !reply.ok || !reply.body) return;
        const fresh = reply.body;
        if (!applyServerPacket(packetId, fresh, program.coordinator_name)) return;
        packet = fresh;
        updateCopy((copy) => {
          copy.packets[packetId] = fresh;
        });
        paint();
      });
    }, 1000);
  }

  const inFlightSend = sendsInFlight.get(packetId);
  if (inFlightSend) {
    void inFlightSend.then(() => {
      if (open) paint();
    });
  }

  content.append(status, rowsList, rowsStatus, problems, actions, downloadHolder, previewHolder);
  paint();
  poll();
  onLeaveScreen(() => {
    open = false;
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
  });
  void panel;
  return root;
}
