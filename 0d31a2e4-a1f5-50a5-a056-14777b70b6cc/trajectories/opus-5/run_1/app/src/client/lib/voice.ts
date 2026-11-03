import { store } from './store.js';

const SPEAKING_THRESHOLD = 0.015;
const SPEAKING_HOLD_MS = 100;
/** Envelope follower so short peaks still read as speech, as a level meter would. */
const ENVELOPE_DECAY = 0.82;

interface SignalData {
  kind: 'offer' | 'answer' | 'candidate';
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/**
 * The peer-to-peer voice mesh between the party members who joined voice.
 * Host candidates only: no external STUN or TURN server is used.
 */
class VoiceMesh {
  private stream: MediaStream | null = null;
  private readonly peers = new Map<number, RTCPeerConnection>();
  private readonly waitingCandidates = new Map<number, RTCIceCandidateInit[]>();
  private readonly players = new Map<number, HTMLAudioElement>();
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meter: number | null = null;
  private aboveSince = 0;
  private envelope = 0;
  private speaking = false;
  private muted = false;
  private pushToTalk = false;
  private talking = false;
  private selfId = 0;

  get joined(): boolean {
    return this.stream !== null;
  }

  async join(selfId: number): Promise<void> {
    this.selfId = selfId;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.applyTrackState();
    this.startMeter();
    store.setVoiceTile(selfId, { connected: true, muted: this.muted, speaking: false });
    this.publish();
  }

  leave(): void {
    for (const [userId, peer] of this.peers) {
      peer.close();
      this.players.get(userId)?.remove();
      this.players.delete(userId);
    }
    this.peers.clear();
    this.waitingCandidates.clear();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.meter !== null) window.clearInterval(this.meter);
    this.meter = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.speaking = false;
    store.send({ type: 'voice_state', inVoice: false, muted: false, speaking: false });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTrackState();
    this.publish();
  }

  setPushToTalk(pushToTalk: boolean): void {
    this.pushToTalk = pushToTalk;
    this.talking = false;
    this.applyTrackState();
    this.publish();
  }

  setTalking(talking: boolean): void {
    if (!this.pushToTalk || this.talking === talking) return;
    this.talking = talking;
    this.applyTrackState();
    this.publish();
  }

  private sending(): boolean {
    if (this.muted) return false;
    return this.pushToTalk ? this.talking : true;
  }

  private applyTrackState(): void {
    const enabled = this.sending();
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    if (!enabled && this.speaking) this.speaking = false;
  }

  private publish(): void {
    if (this.stream === null) return;
    store.setVoiceTile(this.selfId, {
      connected: true,
      muted: this.muted,
      speaking: this.speaking,
    });
    store.send({
      type: 'voice_state',
      inVoice: true,
      muted: this.muted,
      speaking: this.speaking,
    });
  }

  private startMeter(): void {
    if (this.stream === null) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(this.stream).connect(analyser);
    this.context = context;
    this.analyser = analyser;
    const samples = new Float32Array(analyser.fftSize);
    this.meter = window.setInterval(() => {
      if (this.analyser === null) return;
      this.analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.sqrt(sum / samples.length);
      this.envelope = this.sending() ? Math.max(level, this.envelope * ENVELOPE_DECAY) : 0;
      const loud = this.sending() && this.envelope > SPEAKING_THRESHOLD;
      const now = performance.now();
      if (!loud) {
        this.aboveSince = 0;
        if (this.speaking) {
          this.speaking = false;
          this.publish();
        }
        return;
      }
      if (this.aboveSince === 0) this.aboveSince = now;
      if (!this.speaking && now - this.aboveSince >= SPEAKING_HOLD_MS) {
        this.speaking = true;
        this.publish();
      }
    }, 60);
  }

  private createPeer(userId: number): RTCPeerConnection {
    const peer = new RTCPeerConnection({ iceServers: [] });
    this.peers.set(userId, peer);
    this.stream?.getTracks().forEach((track) => {
      if (this.stream !== null) peer.addTrack(track, this.stream);
    });
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate === null) return;
      this.signal(userId, { kind: 'candidate', candidate: event.candidate.toJSON() });
    });
    peer.addEventListener('track', (event) => {
      const player = this.players.get(userId) ?? new Audio();
      player.srcObject = event.streams[0] ?? null;
      player.autoplay = true;
      this.players.set(userId, player);
      void player.play().catch(() => undefined);
    });
    peer.addEventListener('connectionstatechange', () => {
      store.setVoiceTile(userId, { connected: peer.connectionState === 'connected' });
    });
    return peer;
  }

  private signal(userId: number, data: SignalData): void {
    store.send({ type: 'voice_signal', to: userId, data });
  }

  /** Called when a party member's voice state arrives. */
  async onMemberState(userId: number, inVoice: boolean): Promise<void> {
    if (this.stream === null || userId === this.selfId) return;
    if (!inVoice) {
      this.peers.get(userId)?.close();
      this.peers.delete(userId);
      this.players.get(userId)?.remove();
      this.players.delete(userId);
      return;
    }
    if (this.peers.has(userId)) return;
    const peer = this.createPeer(userId);
    if (this.selfId < userId) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      this.signal(userId, { kind: 'offer', description: offer });
    }
  }

  async onSignal(from: number, raw: unknown): Promise<void> {
    if (this.stream === null) return;
    const data = raw as SignalData;
    const peer = this.peers.get(from) ?? this.createPeer(from);
    if (data.kind === 'offer' && data.description !== undefined) {
      await peer.setRemoteDescription(data.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.signal(from, { kind: 'answer', description: answer });
      await this.flushCandidates(from, peer);
      return;
    }
    if (data.kind === 'answer' && data.description !== undefined) {
      await peer.setRemoteDescription(data.description);
      await this.flushCandidates(from, peer);
      return;
    }
    if (data.kind === 'candidate' && data.candidate !== undefined) {
      if (peer.remoteDescription === null) {
        const waiting = this.waitingCandidates.get(from) ?? [];
        waiting.push(data.candidate);
        this.waitingCandidates.set(from, waiting);
        return;
      }
      await peer.addIceCandidate(data.candidate);
    }
  }

  /** Candidates that arrive before the offer or answer wait for it. */
  private async flushCandidates(userId: number, peer: RTCPeerConnection): Promise<void> {
    const waiting = this.waitingCandidates.get(userId);
    if (waiting === undefined) return;
    this.waitingCandidates.delete(userId);
    for (const candidate of waiting) await peer.addIceCandidate(candidate);
  }
}

export const voice = new VoiceMesh();
