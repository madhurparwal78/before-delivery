import {
  PACKET_COPY,
  checkFailed,
  mailOutage,
  packetChecked,
  packetRendered,
  packetRendering,
  packetSending,
  packetSent,
  sendRefused,
  sendStorageOutage,
} from '../shared/messages.js';
import { packetLabel as labelFor } from '../shared/packet-state.js';
import type { Packet } from '../shared/types.js';
import { get, put, STORE_META } from './idb.js';

/**
 * What the Packet status panel shows, kept per packet so it survives leaving the
 * screen and a reload.
 */
export interface PanelState {
  revision: number;
  label: string;
  sentence: string;
  /** A message from the observer's latest action, shown in place of the sentence. */
  message: string | null;
  sendInFlight: boolean;
  /** The revision the packet had before a Sending this device did not start. */
  sendingFrom: number | null;
}

const panels = new Map<string, PanelState>();

export function stateSentence(packet: Packet, coordinatorName: string): string {
  switch (packet.state) {
    case 'draft':
      return packet.returned_to_draft ? PACKET_COPY.returned_to_draft : PACKET_COPY.draft;
    case 'checked':
      return packetChecked(packet.rows.length);
    case 'rendering':
      return packetRendering(packet.number);
    case 'rendered':
      return packetRendered(packet.number, packet.pdf?.pages ?? 0);
    case 'render_failed':
      return packet.failure === 'storage_unavailable'
        ? PACKET_COPY.render_failed_storage
        : PACKET_COPY.render_failed_renderer;
    case 'sending':
      return packetSending(packet.number, coordinatorName);
    case 'sent':
      return packetSent(packet.number, coordinatorName);
    case 'send_failed':
      return sendRefused(packet.number);
  }
}

export function mailOutageSentence(packet: Packet): string {
  return mailOutage(packet.number);
}

export function storageSendSentence(packet: Packet): string {
  return sendStorageOutage(packet.number);
}

export function checkFailedSentence(problems: number): string {
  return checkFailed(problems);
}

function messageKey(packetId: string): string {
  return `packet_message:${packetId}`;
}

export async function loadPanel(packetId: string, packet: Packet, coordinator: string): Promise<PanelState> {
  const existing = panels.get(packetId);
  if (existing) return existing;
  const message = (await get<string>(STORE_META, messageKey(packetId)).catch(() => undefined)) ?? null;
  const panel: PanelState = {
    revision: packet.revision,
    label: labelFor(packet.state),
    sentence: stateSentence(packet, coordinator),
    message,
    sendInFlight: false,
    sendingFrom: null,
  };
  panels.set(packetId, panel);
  return panel;
}

export function panelFor(packetId: string): PanelState | undefined {
  return panels.get(packetId);
}

/**
 * A late reply never turns Rendered back into Rendering: only an answer at a
 * revision at least as high as the one on screen applies.
 */
export function applyServerPacket(
  packetId: string,
  packet: Packet,
  coordinator: string,
  options: { ownSendAnswer?: boolean } = {},
): boolean {
  const panel = panels.get(packetId);
  if (!panel) return false;

  if (!options.ownSendAnswer) {
    // While this device's own send is unanswered, only a server-confirmed sent
    // replaces the Sending, so no second send can start.
    if (panel.sendInFlight && packet.state !== 'sent') return false;
    // A panel showing a Sending it did not start follows the state machine's
    // rollback, which lands on the revision just before that Sending.
    const rollback = panel.sendingFrom !== null && packet.revision === panel.sendingFrom;
    if (packet.revision < panel.revision && !rollback) return false;
  }

  const newer = packet.revision > panel.revision;
  panel.revision = packet.revision;
  panel.label = labelFor(packet.state);
  panel.sentence = stateSentence(packet, coordinator);
  if (newer) setMessage(packetId, null);
  panel.sendingFrom = packet.state === 'sending' ? packet.revision - 1 : null;
  return true;
}

export function setMessage(packetId: string, message: string | null): void {
  const panel = panels.get(packetId);
  if (!panel) return;
  panel.message = message;
  if (message === null) void put(STORE_META, null, messageKey(packetId)).catch(() => undefined);
  else void put(STORE_META, message, messageKey(packetId)).catch(() => undefined);
}

/** From Send now until the send answers, the panel shows Sending. */
export function enterSending(packetId: string, packet: Packet, coordinator: string): void {
  const panel = panels.get(packetId);
  if (!panel) return;
  panel.sendInFlight = true;
  panel.sendingFrom = packet.revision;
  panel.label = labelFor('sending');
  panel.sentence = packetSending(packet.number, coordinator);
  setMessage(packetId, null);
}

export function leaveSending(packetId: string): void {
  const panel = panels.get(packetId);
  if (!panel) return;
  panel.sendInFlight = false;
}

export { labelFor as packetStateLabel };
