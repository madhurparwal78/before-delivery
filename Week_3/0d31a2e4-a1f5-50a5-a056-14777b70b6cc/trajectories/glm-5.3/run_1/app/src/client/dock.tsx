import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { store } from "./store";
import { Bean, Icon, usePending } from "./ui";
import { timeOf, type MessageView } from "./types";

class VoiceSession {
  private static instance: VoiceSession | null = null;
  private pc = new Map<number, RTCPeerConnection>();
  private localStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private speakingTimer: number | null = null;

  static get(): VoiceSession {
    if (!VoiceSession.instance) VoiceSession.instance = new VoiceSession();
    return VoiceSession.instance;
  }

  get joined(): boolean {
    return this.localStream !== null;
  }

  async join(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.localStream = stream;
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    const buffer = new Uint8Array(this.analyser.frequencyBinCount);
    let aboveSince: number | null = null;
    const tick = (): void => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(buffer);
      let sum = 0;
      for (const value of buffer) sum += value;
      const level = sum / buffer.length;
      const now = Date.now();
      if (level > 24) {
        if (aboveSince === null) aboveSince = now;
        if (now - aboveSince >= 100) {
          store.live.send({ type: "voice_state", inVoice: true, muted: this.muted, speaking: true });
          aboveSince = now;
        }
      } else {
        aboveSince = null;
        store.live.send({ type: "voice_state", inVoice: true, muted: this.muted, speaking: false });
      }
    };
    this.speakingTimer = setInterval(tick, 120) as unknown as number;
    store.live.send({ type: "voice_state", inVoice: true, muted: false, speaking: false });
  }

  muted = false;

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTrack();
    store.live.send({ type: "voice_state", inVoice: true, muted, speaking: false });
  }

  pushToTalk = false;

  setPushToTalk(on: boolean): void {
    this.pushToTalk = on;
    this.applyTrack();
    store.live.send({ type: "voice_state", inVoice: true, muted: this.muted || on, speaking: false });
  }

  talkHeld(held: boolean): void {
    if (!this.pushToTalk) return;
    this.applyTrack(held);
    store.live.send({ type: "voice_state", inVoice: true, muted: this.muted, speaking: held });
  }

  private applyTrack(enabled?: boolean): void {
    const stream = this.localStream;
    if (!stream) return;
    for (const track of stream.getAudioTracks()) {
      track.enabled = this.pushToTalk ? (enabled ?? false) : !this.muted;
    }
  }

  connectTo(userId: number): RTCPeerConnection {
    const existing = this.pc.get(userId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const stream = this.localStream;
    if (stream) for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        store.live.send({ type: "voice_signal", to: userId, data: { candidate: event.candidate.toJSON() } });
      }
    };
    pc.ontrack = () => undefined;
    this.pc.set(userId, pc);
    return pc;
  }

  handleSignal(from: number, data: unknown): void {
    void (async () => {
      const pc = this.connectTo(from);
      const payload = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      try {
        if (payload.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          if (payload.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            store.live.send({ type: "voice_signal", to: from, data: { sdp: { type: "answer", sdp: answer.sdp } } });
          }
        } else if (payload.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        }
      } catch {
        // signalling races are ignorable; the next offer repairs the link
      }
    })();
  }

  offerTo(userId: number): void {
    void (async () => {
      const pc = this.connectTo(userId);
      if (pc.localDescription) return;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      store.live.send({ type: "voice_signal", to: userId, data: { sdp: { type: "offer", sdp: offer.sdp } } });
    })();
  }

  leave(): void {
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    for (const pc of this.pc.values()) pc.close();
    this.pc.clear();
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.analyser = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.muted = false;
    this.pushToTalk = false;
    store.live.send({ type: "voice_state", inVoice: false, muted: false, speaking: false });
  }
}

function ChatLog({ messages, label }: { messages: MessageView[]; label: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);
  return (
    <div className="chat-log" ref={ref} role="log" aria-live="polite" aria-label={label}>
      {messages.map((message) => (
        <div key={message.id} className="chat-msg">
          <Bean userId={message.fromUserId} size={22} />
          <span style={{ minWidth: 0 }}>
            <span className="chat-time">{timeOf(message.sentAt)} </span>
            <strong>{handleOf(message.fromUserId)}</strong>
            <span> {message.body}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function handleOf(userId: number): string {
  if (store.me?.id === userId) return store.me.handle;
  return (
    store.friends.friends.find((f) => f.user.id === userId)?.user.handle ??
    store.party?.members.find((m) => m.user.id === userId)?.user.handle ??
    store.match?.participants.find((p) => p.id === userId)?.handle ??
    String(userId)
  );
}

function PartyChatTab(): JSX.Element {
  const [body, setBody] = useState("");
  const [busy, run] = usePending();

  const send = run(async () => {
    const text = body;
    setBody("");
    try {
      const result = await api.post<{ message: MessageView }>("/api/party/messages", { body: text });
      store.partyMessages = [...store.partyMessages, result.message];
      store.emit();
    } catch (e) {
      setBody(text);
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <>
      <ChatLog messages={store.partyMessages} label="Party chat" />
      <div className="chat-send">
        <label className="sr-only" htmlFor="party-msg">
          Message party
        </label>
        <input
          id="party-msg"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message party"
        />
        <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void send()}>
          Send
        </button>
      </div>
    </>
  );
}

function MessagesTab(): JSX.Element {
  const open = store.openDm;
  const setOpen = (next: number | null): void => {
    store.openDm = next;
    if (next !== null) store.unreadDm.set(next, 0);
    store.emit();
  };
  const [body, setBody] = useState("");
  const [busy, run] = usePending();

  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<number>).detail;
      setOpen(detail);
    };
    window.addEventListener("pc-open-dm", handler);
    return () => window.removeEventListener("pc-open-dm", handler);
  }, []);

  const thread = open !== null ? (store.dmThreads.get(open) ?? []) : null;
  useEffect(() => {
    if (open !== null && (store.unreadDm.get(open) ?? 0) > 0) {
      store.unreadDm.set(open, 0);
      store.emit();
    }
  }, [open]);

  const send = run(async () => {
    if (open === null) return;
    const text = body;
    setBody("");
    try {
      const result = await api.post<{ message: MessageView }>(`/api/dms/${open}/messages`, { body: text });
      const existing = store.dmThreads.get(open) ?? [];
      store.dmThreads.set(open, [...existing, result.message]);
      store.unreadDm.set(open, 0);
      if (!store.conversations.includes(open)) store.conversations = [open, ...store.conversations];
      store.emit();
    } catch (e) {
      setBody(text);
      store.notify(e instanceof ApiError ? e.message : "Something went wrong. Try again.", "error");
    }
  });

  return (
    <>
      {open === null ? (
        <ul className="friends-list" aria-label="Conversations" style={{ overflowY: "auto" }}>
          {store.conversations.map((userId) => (
            <li key={userId} className="friend-row">
              <Bean userId={userId} />
              <button type="button" className="btn btn-small friend-handle truncate" style={{ justifyContent: "flex-start" }} onClick={() => setOpen(userId)}>
                {handleOf(userId)}
              </button>
            </li>
          ))}
          {store.conversations.length === 0 && <li style={{ color: "var(--ink-soft)" }}>No conversations yet.</li>}
        </ul>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            <button type="button" className="btn btn-small" onClick={() => setOpen(null)}>
              <Icon name="arrowLeft" size={16} /> All conversations
            </button>
          </p>
          <ChatLog messages={thread ?? []} label={`Messages with ${handleOf(open)}`} />
          <div className="chat-send">
            <label className="sr-only" htmlFor="dm-msg">
              Message {handleOf(open)}
            </label>
            <input
              id="dm-msg"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${handleOf(open)}`}
            />
            <button type="button" className="btn" disabled={busy} aria-busy={busy} onClick={() => void send()}>
              Send
            </button>
          </div>
        </>
      )}
    </>
  );
}

function VoicePanel(): JSX.Element {
  const voice = VoiceSession.get();
  const [joined, setJoined] = useState(voice.joined);
  const [muted, setMuted] = useState(voice.muted);
  const [pushToTalk, setPushToTalk] = useState(voice.pushToTalk);
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = usePending();

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      const inField = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (inField) return;
      if (event.code === "KeyV") {
        voice.talkHeld(true);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "KeyV") voice.talkHeld(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [voice]);

  // Offer connections to party members in voice.
  useEffect(() => {
    if (!joined) return;
    const party = store.party;
    if (!party) return;
    for (const member of party.members) {
      if (member.user.id === store.me?.id) continue;
      const state = store.voiceMembers.get(member.user.id);
      if (state?.inVoice) voice.offerTo(member.user.id);
    }
  }, [joined, store.voiceMembers, store.party, voice]);

  const join = run(async () => {
    setError(null);
    try {
      await voice.join();
      setJoined(true);
      store.notify("You joined voice.", "success");
    } catch {
      setError("Microphone blocked. Allow microphone access to talk.");
      store.notify("Microphone blocked. Allow microphone access to talk.", "error");
    }
  });

  const leave = (): void => {
    voice.leave();
    setJoined(false);
    setMuted(false);
    setPushToTalk(false);
    store.notify("You left voice.", "success");
  };

  const party = store.party;
  const members = party?.members ?? [];

  return (
    <section className="panel" aria-label="Voice" style={{ padding: 14 }}>
      <div className="voice-controls">
        {joined ? (
          <button type="button" className="btn btn-small" onClick={leave}>
            Leave voice
          </button>
        ) : (
          <button type="button" className="btn btn-small" disabled={busy} aria-busy={busy} onClick={() => void join()}>
            {busy ? "Connecting…" : "Join voice"}
          </button>
        )}
        {joined && (
          <>
            <button
              type="button"
              className="btn btn-small"
              aria-pressed={muted}
              onClick={() => {
                const next = !muted;
                voice.setMuted(next);
                setMuted(next);
              }}
            >
              <Icon name={muted ? "micOff" : "mic"} size={16} /> Mute
            </button>
            <label className="switch">
              <input
                type="checkbox"
                checked={pushToTalk}
                onChange={(e) => {
                  const next = e.target.checked;
                  voice.setPushToTalk(next);
                  setPushToTalk(next);
                }}
                aria-label="Push to talk"
                role="switch"
              />
              Push to talk
              {pushToTalk && <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>Hold V to talk</span>}
            </label>
          </>
        )}
      </div>
      {error && <p className="field-error" style={{ margin: "6px 0 0" }}>{error}</p>}
      <ul className="friends-list" aria-label="Voice" style={{ marginTop: 10 }}>
        {members.map((member) => {
          const state = store.voiceMembers.get(member.user.id);
          const isMe = member.user.id === store.me?.id;
          const inVoice = isMe ? joined : (state?.inVoice ?? false);
          const isMuted = isMe ? muted : (state?.muted ?? false);
          const speaking = isMe ? false : (state?.speaking ?? false);
          return (
            <li
              key={member.user.id}
              className="voice-tile"
              data-user-id={member.user.id}
              data-connected={inVoice ? "true" : "false"}
              data-muted={isMuted ? "true" : "false"}
              data-speaking={speaking ? "true" : "false"}
            >
              <Bean userId={member.user.id} size={24} />
              <span className="truncate" style={{ flex: 1 }}>
                {member.user.handle}
                {isMe ? " (you)" : ""}
              </span>
              <Icon name={inVoice ? (isMuted ? "micOff" : "mic") : "mic"} size={16} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DockBody(): JSX.Element {
  const tab = store.dockTab;
  const setTab = (next: "party" | "messages"): void => {
    store.dockTab = next;
    if (next === "party") {
      store.unreadParty = 0;
    } else {
      for (const key of store.unreadDm.keys()) store.unreadDm.set(key, 0);
    }
    store.emit();
  };
  const partyUnread = store.unreadCount("party");
  const dmUnread = store.unreadCount("messages");

  const partyLabel = partyUnread > 0 ? `Party chat (${partyUnread} unread)` : "Party chat";
  const messagesLabel = dmUnread > 0 ? `Messages (${dmUnread} unread)` : "Messages";

  return (
    <>
      <div className="dock-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className="dock-tab"
          aria-selected={tab === "party"}
          onClick={() => setTab("party")}
        >
          {partyLabel}
        </button>
        <button
          type="button"
          role="tab"
          className="dock-tab"
          aria-selected={tab === "messages"}
          onClick={() => setTab("messages")}
        >
          {messagesLabel}
        </button>
      </div>
      <div className="dock-body">
        {tab === "party" ? <PartyChatTab /> : <MessagesTab />}
        <VoicePanel />
      </div>
    </>
  );
}
