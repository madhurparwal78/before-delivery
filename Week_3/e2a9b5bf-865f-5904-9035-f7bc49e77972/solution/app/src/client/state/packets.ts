import { COPY, PACKET_LABELS } from "../../shared/messages";
import type { Packet, PacketReason } from "../../shared/types";
import { createStore } from "../lib/store";
import { call } from "./http";
import { accountId } from "./model";

/** A note from the observer's latest action on a packet. It shows in place of the state sentence. */
interface Note {
  text: string;
  atRevision: number;
  reasons?: PacketReason[];
}

interface PacketView {
  packet: Packet;
  note: Note | null;
  /** This device has a send under way that the server has not yet answered. */
  sending: boolean;
  rowsNote: string;
}

export const packets = createStore<{ byId: Record<string, PacketView> }>({ byId: {} });

const noteKey = (id: string) => `lowlamp:packet-note:${accountId()}:${id}`;

function readNote(id: string): Note | null {
  try {
    const raw = window.localStorage.getItem(noteKey(id));
    return raw ? (JSON.parse(raw) as Note) : null;
  } catch {
    return null;
  }
}

function writeNote(id: string, note: Note | null): void {
  if (note) window.localStorage.setItem(noteKey(id), JSON.stringify(note));
  else window.localStorage.removeItem(noteKey(id));
}

function put(id: string, patch: Partial<PacketView> & { packet?: Packet }): void {
  const current = packets.get().byId[id];
  const packet = patch.packet ?? current?.packet;
  if (!packet) return;
  const next: PacketView = {
    packet,
    note: "note" in patch ? (patch.note ?? null) : (current?.note ?? readNote(id)),
    sending: patch.sending ?? current?.sending ?? false,
    rowsNote: patch.rowsNote ?? current?.rowsNote ?? "",
  };
  packets.set({ byId: { ...packets.get().byId, [id]: next } });
}

/**
 * Takes a server answer. The panel keeps the highest revision it has seen; a lower one is
 * ignored unless it is this device's own answer or the revision just before a Sending this
 * panel did not start.
 */
function accept(next: Packet, options: { own?: boolean } = {}): void {
  const current = packets.get().byId[next.id];
  if (current) {
    const held = current.packet;
    const justBefore = held.state === "sending" && !current.sending && next.revision === held.revision - 1;
    if (!options.own && !justBefore && next.revision <= held.revision) return;
    if (next.revision > held.revision && next.state === "sent") put(next.id, { sending: false });
  }
  const note = current?.note && next.revision > current.note.atRevision ? null : (current?.note ?? readNote(next.id));
  if (current?.note && !note) writeNote(next.id, null);
  put(next.id, { packet: next, note, sending: current?.sending && next.state !== "sent" ? current.sending : false });
}

export function setNote(id: string, note: Note | null): void {
  writeNote(id, note);
  put(id, { note });
}

export function setRowsNote(id: string, text: string): void {
  put(id, { rowsNote: text });
}

export async function loadPacket(id: string): Promise<number | null> {
  const answer = await call<Packet>("GET", `/api/packets/${id}`);
  if (!answer) return null;
  if (answer.status === 200) {
    if (!packets.get().byId[id]) put(id, { packet: answer.body, note: readNote(id) });
    else accept(answer.body);
  }
  return answer.status;
}

type ActionKind = "check" | "render" | "send" | "rows";

type Reply = Packet & { error?: string; packet?: Packet; reasons?: PacketReason[]; state: Packet["state"] };

export type Outcome = "ok" | "stale" | "incomplete" | "failed" | "offline";

/** The one place that acts on a packet; every answer lands in the store whether or not the screen is still open. */
export async function act(
  current: Packet,
  action: ActionKind,
  extra: Record<string, unknown> = {},
): Promise<Outcome> {
  const id = current.id;
  setNote(id, null);
  const before = packets.get().byId[id]?.packet ?? current;
  const body = { revision: before.revision, ...extra };
  if (action === "send") put(id, { sending: true });
  const answer = await call<Reply>(
    action === "rows" ? "PUT" : "POST",
    action === "rows" ? `/api/packets/${id}/rows` : `/api/packets/${id}/${action}`,
    body,
  );
  if (!answer) {
    put(id, { sending: false });
    setNote(id, { text: COPY.needsSignal, atRevision: before.revision });
    return "offline";
  }
  const { status } = answer;
  if (status === 200 || status === 202) {
    accept(answer.body, { own: true });
    put(id, { sending: false });
    return "ok";
  }
  if (status === 422 && answer.body.error === "incomplete") {
    const reasons = answer.body.reasons ?? [];
    setNote(id, { text: COPY.checkFailed(reasons.length), atRevision: before.revision, reasons });
    return "incomplete";
  }
  if (status === 412 || status === 409) {
    put(id, { sending: false });
    const fresh = status === 412 && answer.body.packet ? answer.body.packet : (await call<Packet>("GET", `/api/packets/${id}`))?.body;
    if (fresh) accept(fresh, { own: true });
    const shown = fresh?.revision ?? before.revision;
    setNote(id, { text: COPY.stale, atRevision: shown });
    return "stale";
  }
  if (action === "send") {
    put(id, { sending: false, packet: before });
    if (status === 503) {
      const storage = answer.body.error === "storage_unavailable";
      accept(before, { own: true });
      setNote(id, { text: storage ? COPY.sendStorageDown(before.number) : COPY.mailOutage(before.number), atRevision: before.revision });
      return "failed";
    }
    if (status === 502) {
      const fresh = (await call<Packet>("GET", `/api/packets/${id}`))?.body;
      if (fresh) accept(fresh, { own: true });
      return "failed";
    }
  }
  setNote(id, { text: COPY.serverError, atRevision: before.revision });
  return "failed";
}

/** The state label and the sentence the Packet status panel shows. */
export function statusText(view: PacketView, coordinator: string): { label: string; sentence: string } {
  const p = view.packet;
  if (view.sending && p.state !== "sent") {
    return { label: PACKET_LABELS.sending, sentence: COPY.sending(p.number, coordinator) };
  }
  const label = PACKET_LABELS[p.state];
  if (view.note && view.note.atRevision >= p.revision) return { label, sentence: view.note.text };
  switch (p.state) {
    case "draft":
      return { label, sentence: p.returned_to_draft ? COPY.draftReturned : COPY.draftPlain };
    case "checked":
      return { label, sentence: COPY.checked(p.observation_ids.length) };
    case "rendering":
      return { label, sentence: COPY.rendering(p.number) };
    case "rendered":
      return { label, sentence: COPY.rendered(p.number, p.pdf?.pages ?? 0) };
    case "render_failed":
      return { label, sentence: p.failure === "storage_unavailable" ? COPY.renderFailedStorage : COPY.renderFailedRenderer };
    case "sending":
      return { label, sentence: COPY.sending(p.number, coordinator) };
    case "sent":
      return { label, sentence: COPY.sent(p.number, coordinator) };
    case "send_failed":
      return { label, sentence: COPY.sendRefused(p.number) };
  }
}

