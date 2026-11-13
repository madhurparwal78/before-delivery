// The dock: party chat, direct messages and the voice panel.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Mic, MicOff, Send } from "lucide";
import { ApiFailure, post } from "./api.js";
import { Bean } from "./bean.js";
import { COPY } from "./copy.js";
import { Icon } from "./icon.js";
import { announce, announceFailure } from "./notices.js";
import { addMessage, directMessages, friends, loadConversation, me, party, partyChat, unread } from "./state.js";
import { useStore } from "./store.js";
import { formatTime, useAction } from "./ui.js";
import { joinVoice, leaveVoice, setPushToTalk, toggleMute, voice } from "./voice.js";
import type { Message } from "../shared/api.js";

export type DockTab = "party" | "messages";

function useHandles(): Map<number, string> {
  const self = useStore(me);
  const current = useStore(party);
  const view = useStore(friends);
  const names = new Map<number, string>();
  for (const entry of view?.friends ?? []) names.set(entry.user.id, entry.user.handle);
  for (const member of current?.members ?? []) names.set(member.user.id, member.user.handle);
  if (self) names.set(self.id, self.handle);
  return names;
}

function ChatLog({ label, messages }: { label: string; messages: Message[] }) {
  const names = useHandles();
  const log = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (log.current !== null) log.current.scrollTop = log.current.scrollHeight;
  }, [messages.length]);
  return (
    <div ref={log} role="log" aria-label={label} class="chat-log" tabIndex={0}>
      {messages.length === 0 ? <p class="empty">No messages yet.</p> : null}
      {messages.map((message) => (
        <article key={message.id} class="chat-message">
          <Bean userId={message.fromUserId} size={28} />
          <div>
            <p class="chat-meta"><span class="handle">{names.get(message.fromUserId) ?? "former member"}</span> <time class="numeric" dateTime={message.sentAt}>{formatTime(message.sentAt)}</time></p>
            <p class="chat-body">{message.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function Composer({ id, label, path }: { id: string; label: string; path: string }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useAction();
  const errorId = `${id}-error`;
  const submit = (event: JSX.TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      setError(null);
      try {
        const { message } = await post<{ message: Message }>(path, { body });
        addMessage(message);
        setBody("");
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.code === "validation_failed") {
          setError(COPY.messageLength);
          announce(COPY.checkFields);
          return;
        }
        announceFailure(failure, { rate_limited: COPY.slowDown, blocked: COPY.cantMessage, not_friends: COPY.cantMessage });
      }
    });
  };
  return (
    <form class="composer" onSubmit={submit}>
      <div class="composer-row">
        <input id={id} type="text" aria-label={label} placeholder={label} value={body} autocomplete="off"
          aria-invalid={error === null ? undefined : "true"} aria-describedby={error === null ? undefined : errorId}
          onInput={(event: JSX.TargetedEvent<HTMLInputElement>) => setBody(event.currentTarget.value)} />
        <button type="submit" class="button primary" disabled={pending} aria-busy={pending ? "true" : undefined}>
          <Icon node={Send} />
          <span>Send</span>
        </button>
      </div>
      {error === null ? null : <p class="field-error" id={errorId}>{error}</p>}
    </form>
  );
}

function PartyChat() {
  const messages = useStore(partyChat);
  return (
    <>
      <ChatLog label="Party chat" messages={messages} />
      <Composer id="party-message" label="Message party" path="/api/party/messages" />
    </>
  );
}

function Messages({ openUser, onOpen }: { openUser: number | null; onOpen: (userId: number | null) => void }) {
  const conversations = useStore(directMessages);
  const view = useStore(friends);
  const names = useHandles();
  useEffect(() => {
    for (const entry of view?.friends ?? []) {
      if (!conversations.has(entry.user.id)) void loadConversation(entry.user.id).catch(() => undefined);
    }
  }, [view]);
  const started = (view?.friends ?? []).filter((entry) => (conversations.get(entry.user.id)?.length ?? 0) > 0 || entry.user.id === openUser);
  const handle = openUser === null ? "" : names.get(openUser) ?? "";
  return (
    <>
      <ul aria-label="Conversations" class="conversations">
        {started.map((entry) => (
          <li key={entry.user.id} class={entry.user.id === openUser ? "open" : ""}>
            <button type="button" class="button quiet conversation" aria-current={entry.user.id === openUser ? "true" : undefined}
              onClick={() => onOpen(entry.user.id)}>
              <Bean userId={entry.user.id} size={24} />
              <span>{entry.user.handle}</span>
            </button>
          </li>
        ))}
      </ul>
      {started.length === 0 ? <p class="empty">Message a friend from the rail to start a conversation.</p> : null}
      {openUser === null ? null : (
        <div class="conversation-open">
          <h3>{handle}</h3>
          <ChatLog label={`Messages with ${handle}`} messages={conversations.get(openUser) ?? []} />
          <Composer key={openUser} id={`dm-${openUser}`} label={`Message ${handle}`} path={`/api/dms/${openUser}/messages`} />
        </div>
      )}
    </>
  );
}

function VoicePanel() {
  const state = useStore(voice);
  const self = useStore(me);
  const current = useStore(party);
  const members = current?.members ?? [];
  const tiles = members.filter(({ user }) => (user.id === self?.id ? state.joined : state.peers.get(user.id)?.inVoice === true));
  return (
    <section role="region" aria-label="Voice" class="voice">
      <div class="voice-head">
        <h3>Voice</h3>
        {state.joined ? (
          <button type="button" class="button secondary" onClick={leaveVoice}>Leave voice</button>
        ) : (
          <button type="button" class="button primary" disabled={state.connecting} aria-busy={state.connecting ? "true" : undefined}
            onClick={() => void joinVoice()}>
            <Icon node={Mic} />
            <span>{state.connecting ? COPY.connecting : "Join voice"}</span>
          </button>
        )}
      </div>
      {state.joined ? (
        <div class="voice-controls">
          <button type="button" class="button secondary" aria-pressed={state.muted ? "true" : "false"} onClick={toggleMute}>
            <Icon node={state.muted ? MicOff : Mic} />
            <span>Mute</span>
          </button>
          <button type="button" role="switch" class="switch" aria-checked={state.pushToTalk ? "true" : "false"}
            onClick={() => setPushToTalk(!state.pushToTalk)}>
            <span class="switch-track" aria-hidden="true"><span class="switch-thumb" /></span>
            <span>Push to talk</span>
          </button>
          {state.pushToTalk ? <p class="hint">Hold V to talk</p> : null}
        </div>
      ) : null}
      <ul aria-label="Voice" class="voice-tiles">
        {tiles.map(({ user }) => {
          const own = user.id === self?.id;
          const peer = state.peers.get(user.id);
          const muted = own ? state.muted : peer?.muted === true;
          const speaking = own ? state.speaking : peer?.speaking === true;
          const connected = own ? state.joined : peer?.connected === true;
          return (
            <li key={user.id} data-user-id={user.id} data-connected={String(connected)} data-muted={String(muted)} data-speaking={String(speaking)}
              class={`voice-tile ${speaking ? "speaking" : ""} ${muted ? "muted" : ""} ${connected ? "" : "connecting"}`}>
              <Bean userId={user.id} size={36} />
              <span class="handle">{user.handle}</span>
              <span class="voice-status">
                <Icon node={muted ? MicOff : Mic} size={16} />
                <span class="visually-hidden">{muted ? "Muted" : speaking ? "Speaking" : connected ? "Connected" : "Connecting"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DockContent({ tab, onTab, openUser, onOpen }: {
  tab: DockTab; onTab: (tab: DockTab) => void; openUser: number | null; onOpen: (userId: number | null) => void;
}) {
  const self = useStore(me);
  const counts = useStore(unread);
  if (!self?.emailVerified) return <p class="locked">{COPY.verifyFirst} Chat and voice unlock once your email is verified.</p>;
  const named = (label: string, n: number) => n >= 1 ? `${label} (${n} unread)` : label;
  const direct = [...counts.direct.values()].reduce((sum, n) => sum + n, 0);
  const tabs: { id: DockTab; label: string }[] = [
    { id: "party", label: named("Party chat", counts.party) }, { id: "messages", label: named("Messages", direct) },
  ];
  const keyed = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = tab === "party" ? "messages" : "party";
    onTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#tab-${next}`)?.focus();
  };
  return (
    <>
      <div role="tablist" aria-label="Dock" class="tabs" onKeyDown={keyed}>
        {tabs.map((item) => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id ? "true" : "false"}
            aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} class="tab" onClick={() => onTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="panel-party" aria-labelledby="tab-party" hidden={tab !== "party"} class="tab-panel">
        <PartyChat />
      </div>
      <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages" hidden={tab !== "messages"} class="tab-panel">
        <Messages openUser={openUser} onOpen={onOpen} />
      </div>
      <VoicePanel />
    </>
  );
}
