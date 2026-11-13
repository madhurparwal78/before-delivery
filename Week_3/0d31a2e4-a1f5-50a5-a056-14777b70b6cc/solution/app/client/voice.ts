// Party voice: a peer-to-peer WebRTC mesh on host candidates only, with mute, push-to-talk and speaking detection.
import { COPY } from "./copy.js";
import { announce } from "./notices.js";
import { send } from "./socket.js";
import { me, party } from "./state.js";
import { Store } from "./store.js";

interface PeerTile {
  inVoice: boolean;
  muted: boolean;
  speaking: boolean;
  connected: boolean;
}

interface VoiceView {
  joined: boolean;
  connecting: boolean;
  muted: boolean;
  pushToTalk: boolean;
  talking: boolean;
  speaking: boolean;
  peers: ReadonlyMap<number, PeerTile>;
}

const SPEAKING_LEVEL = 0.02;
const SPEAKING_HOLD_MS = 100;
const SAMPLE_MS = 50;

export const voice = new Store<VoiceView>({
  joined: false, connecting: false, muted: false, pushToTalk: false, talking: false, speaking: false, peers: new Map(),
});

interface Peer {
  connection: RTCPeerConnection;
  audio: HTMLAudioElement;
  pending: RTCIceCandidateInit[];
}

let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let sampler: number | null = null;
let loudSince: number | null = null;
const peers = new Map<number, Peer>();

function track(): MediaStreamTrack | null {
  return stream?.getAudioTracks()[0] ?? null;
}

function transmitting(view: VoiceView): boolean {
  return view.joined && !view.muted && (!view.pushToTalk || view.talking);
}

function patch(change: Partial<VoiceView>): void {
  const before = voice.get();
  const next = { ...before, ...change };
  if (!transmitting(next)) next.speaking = false;
  voice.set(next);
  const outgoing = track();
  if (outgoing !== null) outgoing.enabled = transmitting(next);
  if (before.joined !== next.joined || before.muted !== next.muted || before.speaking !== next.speaking) {
    send({ type: "voice_state", inVoice: next.joined, muted: next.muted, speaking: next.speaking });
  }
}

function setPeer(userId: number, change: Partial<PeerTile>): void {
  voice.update((view) => {
    const peersNext = new Map(view.peers);
    const current = peersNext.get(userId) ?? { inVoice: true, muted: false, speaking: false, connected: false };
    peersNext.set(userId, { ...current, ...change });
    return { ...view, peers: peersNext };
  });
}

function dropPeer(userId: number): void {
  const peer = peers.get(userId);
  if (peer !== undefined) {
    peer.connection.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peers.delete(userId);
  }
  voice.update((view) => {
    const peersNext = new Map(view.peers);
    peersNext.delete(userId);
    return { ...view, peers: peersNext };
  });
}

function peerFor(userId: number): Peer {
  const existing = peers.get(userId);
  if (existing !== undefined) return existing;
  const connection = new RTCPeerConnection({ iceServers: [] });
  const audio = document.createElement("audio");
  audio.autoplay = true;
  audio.hidden = true;
  document.body.append(audio);
  const peer: Peer = { connection, audio, pending: [] };
  peers.set(userId, peer);
  const outgoing = track();
  if (outgoing !== null && stream !== null) connection.addTrack(outgoing, stream);
  connection.addEventListener("icecandidate", (event) => {
    if (event.candidate !== null) send({ type: "voice_signal", to: userId, data: { candidate: event.candidate.toJSON() } });
  });
  connection.addEventListener("track", (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void audio.play().catch(() => undefined);
  });
  connection.addEventListener("connectionstatechange", () => {
    setPeer(userId, { connected: connection.connectionState === "connected" });
  });
  return peer;
}

async function call(userId: number): Promise<void> {
  const { connection } = peerFor(userId);
  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  send({ type: "voice_signal", to: userId, data: { sdp: connection.localDescription?.toJSON() } });
}

async function flushCandidates(peer: Peer): Promise<void> {
  for (const candidate of peer.pending.splice(0)) await peer.connection.addIceCandidate(candidate);
}

interface Signal {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

async function onSignal(from: number, data: Signal): Promise<void> {
  if (!voice.get().joined) return;
  const peer = peerFor(from);
  if (data.sdp !== undefined) {
    await peer.connection.setRemoteDescription(data.sdp);
    if (data.sdp.type === "offer") {
      const answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      send({ type: "voice_signal", to: from, data: { sdp: peer.connection.localDescription?.toJSON() } });
    }
    await flushCandidates(peer);
  } else if (data.candidate !== undefined) {
    if (peer.connection.remoteDescription === null) peer.pending.push(data.candidate);
    else await peer.connection.addIceCandidate(data.candidate);
  }
}

export function onVoiceMessage(message: { type: "voice_signal"; from: number; data: unknown }
  | { type: "voice_state"; userId: number; inVoice: boolean; muted: boolean; speaking: boolean }): void {
  if (message.type === "voice_signal") {
    if (typeof message.data === "object" && message.data !== null) {
      void onSignal(message.from, message.data as Signal).catch(() => undefined);
    }
    return;
  }
  if (!message.inVoice) {
    dropPeer(message.userId);
    return;
  }
  const known = voice.get().peers.has(message.userId);
  setPeer(message.userId, { inVoice: true, muted: message.muted, speaking: message.speaking });
  const self = me.get();
  if (!known && voice.get().joined && self !== undefined && self !== null && self.id < message.userId) {
    void call(message.userId).catch(() => undefined);
  }
}

// Speaking: the outgoing level stays above a fixed threshold for a tenth of a second while transmitting.
function startSampler(source: MediaStream): void {
  context = new AudioContext();
  void context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(source).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  sampler = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const level = Math.sqrt(sum / samples.length);
    const now = performance.now();
    const view = voice.get();
    if (level > SPEAKING_LEVEL && transmitting(view)) loudSince ??= now;
    else loudSince = null;
    const speaking = loudSince !== null && now - loudSince >= SPEAKING_HOLD_MS;
    if (speaking !== view.speaking) patch({ speaking });
  }, SAMPLE_MS);
}

export async function joinVoice(): Promise<void> {
  if (voice.get().joined || voice.get().connecting) return;
  patch({ connecting: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    patch({ connecting: false });
    announce(COPY.micBlocked);
    return;
  }
  startSampler(stream);
  patch({ connecting: false, joined: true, muted: false, talking: false, speaking: false });
  announce(COPY.joinedVoice);
  const self = me.get();
  for (const userId of voice.get().peers.keys()) {
    if (self !== undefined && self !== null && self.id < userId) void call(userId).catch(() => undefined);
  }
}

export function leaveVoice(): void {
  for (const userId of [...peers.keys()]) dropPeer(userId);
  if (sampler !== null) window.clearInterval(sampler);
  sampler = null;
  void context?.close();
  context = null;
  for (const outgoing of stream?.getTracks() ?? []) outgoing.stop();
  stream = null;
  patch({ joined: false, talking: false, speaking: false, peers: new Map() });
}

export function toggleMute(): void {
  patch({ muted: !voice.get().muted });
}

export function setPushToTalk(on: boolean): void {
  patch({ pushToTalk: on, talking: false });
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

window.addEventListener("keydown", (event) => {
  if (event.code !== "KeyV" || event.repeat || typing(event.target)) return;
  const view = voice.get();
  if (view.joined && view.pushToTalk && !view.talking) patch({ talking: true });
});

window.addEventListener("keyup", (event) => {
  if (event.code !== "KeyV") return;
  if (voice.get().talking) patch({ talking: false });
});

// Members who leave the party drop out of this mesh.
party.subscribe((next) => {
  const members = new Set(next?.members.map((member) => member.user.id) ?? []);
  for (const userId of voice.get().peers.keys()) if (!members.has(userId)) dropPeer(userId);
});
