import { useEffect, useRef, useState } from 'react';
import type { Message, User } from '../../shared/types.js';
import { copy } from '../lib/copy.js';
import { store, useApp } from '../lib/store.js';
import { Bean, useDialog } from '../lib/ui.js';
import { voice } from '../lib/voice.js';

function timeOf(sentAt: string): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageRow({ message, author }: { message: Message; author: User | null }) {
  return (
    <li className="message-row" data-user-id={message.fromUserId}>
      <Bean hue={author?.hue ?? 200} size={22} />
      <span className="handle">{author?.handle ?? `#${message.fromUserId}`}</span>
      <span className="message-time">{timeOf(message.sentAt)}</span>
      <span className="message-body">{message.body}</span>
    </li>
  );
}

function useAuthors(): (userId: number) => User | null {
  const { me, friends, party, participants } = useApp();
  return (userId: number) => {
    if (me !== null && userId === me.id) return me;
    const fromParty = party?.members.find((member) => member.user.id === userId);
    if (fromParty !== undefined) return fromParty.user;
    const fromFriends = friends.friends.find((entry) => entry.user.id === userId);
    if (fromFriends !== undefined) return fromFriends.user;
    return participants.find((user) => user.id === userId) ?? null;
  };
}

function PartyChat() {
  const { partyMessages, pending, fieldErrors } = useApp();
  const [body, setBody] = useState('');
  const authorOf = useAuthors();
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = logRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [partyMessages]);

  const submit = async (): Promise<void> => {
    if (await store.sendPartyMessage(body)) setBody('');
  };

  return (
    <div className="chat-pane">
      <div role="log" aria-label="Party chat" className="chat-log" tabIndex={0} ref={logRef}>
        <ul className="plain-list">
          {partyMessages.map((message) => (
            <MessageRow key={message.id} message={message} author={authorOf(message.fromUserId)} />
          ))}
        </ul>
      </div>
      <form
        className="chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="party-message-field">
          Message party
        </label>
        <input
          id="party-message-field"
          aria-label="Message party"
          value={body}
          aria-describedby={fieldErrors.message === undefined ? undefined : 'party-message-error'}
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          type="submit"
          className="primary"
          disabled={pending['send-party-message'] === true}
          aria-busy={pending['send-party-message'] === true}
        >
          Send
        </button>
        {fieldErrors.message === undefined ? null : (
          <span className="field-error" id="party-message-error">
            {fieldErrors.message}
          </span>
        )}
      </form>
    </div>
  );
}

function Messages() {
  const { conversations, dmThreads, openDm, pending, fieldErrors, friends } = useApp();
  const [body, setBody] = useState('');
  const authorOf = useAuthors();
  const thread = openDm === null ? [] : (dmThreads[openDm] ?? []);
  const other = openDm === null ? null : authorOf(openDm);

  const submit = async (): Promise<void> => {
    if (openDm === null) return;
    if (await store.sendDirectMessage(openDm, body)) setBody('');
  };

  return (
    <div className="chat-pane">
      <ul className="conversation-list" aria-label="Conversations">
        {conversations.map((userId) => {
          const user = authorOf(userId);
          return (
            <li key={userId} data-user-id={userId}>
              <button
                type="button"
                className={openDm === userId ? 'conversation selected' : 'conversation'}
                onClick={() => void store.openConversation(userId)}
              >
                <Bean hue={user?.hue ?? 200} size={22} />
                <span className="handle">{user?.handle ?? `#${userId}`}</span>
              </button>
            </li>
          );
        })}
        {conversations.length === 0 ? (
          <li className="empty-hint">
            {friends.friends.length === 0
              ? 'Add a friend to start messaging.'
              : 'Pick Message on a friend to start a conversation.'}
          </li>
        ) : null}
      </ul>
      {openDm === null || other === null ? null : (
        <>
          <div
            role="log"
            aria-label={`Messages with ${other.handle}`}
            className="chat-log"
            tabIndex={0}
          >
            <ul className="plain-list">
              {thread.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  author={authorOf(message.fromUserId)}
                />
              ))}
            </ul>
          </div>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor="dm-field">
              {`Message ${other.handle}`}
            </label>
            <input
              id="dm-field"
              aria-label={`Message ${other.handle}`}
              value={body}
              aria-describedby={fieldErrors.message === undefined ? undefined : 'dm-error'}
              onChange={(event) => setBody(event.target.value)}
            />
            <button
              type="submit"
              className="primary"
              disabled={pending['send-dm'] === true}
              aria-busy={pending['send-dm'] === true}
            >
              Send
            </button>
            {fieldErrors.message === undefined ? null : (
              <span className="field-error" id="dm-error">
                {fieldErrors.message}
              </span>
            )}
          </form>
        </>
      )}
    </div>
  );
}

function VoicePanel() {
  const { me, party, voiceJoined, voiceMuted, pushToTalk, voiceTiles, pending } = useApp();
  const authorOf = useAuthors();

  useEffect(() => {
    if (!pushToTalk) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyV' || event.repeat) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      voice.setTalking(true);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'KeyV') return;
      voice.setTalking(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [pushToTalk]);

  const join = async (): Promise<void> => {
    if (me === null) return;
    store.notice(copy.connectingVoice);
    try {
      await voice.join(me.id);
      store.setVoiceFlags({ joined: true });
      store.notice(copy.joinedVoice);
    } catch {
      store.notice(copy.microphoneBlocked);
    }
  };

  const tiles = Object.values(voiceTiles).filter((tile) =>
    party === null ? false : party.members.some((member) => member.user.id === tile.userId),
  );

  return (
    <section className="voice-panel" aria-label="Voice">
      <h3>Voice</h3>
      <div className="voice-actions">
        {voiceJoined ? (
          <button
            type="button"
            onClick={() => {
              voice.leave();
              store.setVoiceFlags({ joined: false, muted: false, pushToTalk: false });
            }}
          >
            Leave voice
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={pending['join-voice'] === true}
            onClick={() => void join()}
          >
            Join voice
          </button>
        )}
        {voiceJoined ? (
          <>
            <button
              type="button"
              aria-pressed={voiceMuted}
              onClick={() => {
                const muted = !voiceMuted;
                voice.setMuted(muted);
                store.setVoiceFlags({ muted });
              }}
            >
              Mute
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={pushToTalk}
              onClick={() => {
                const next = !pushToTalk;
                voice.setPushToTalk(next);
                store.setVoiceFlags({ pushToTalk: next });
              }}
            >
              Push to talk
            </button>
          </>
        ) : null}
      </div>
      {voiceJoined && pushToTalk ? <p className="voice-hint">Hold V to talk</p> : null}
      <ul className="voice-tiles" aria-label="Voice">
        {tiles.map((tile) => {
          const user = authorOf(tile.userId);
          return (
            <li
              key={tile.userId}
              className="voice-tile"
              data-user-id={tile.userId}
              data-connected={tile.connected ? 'true' : 'false'}
              data-muted={tile.muted ? 'true' : 'false'}
              data-speaking={tile.speaking ? 'true' : 'false'}
            >
              <Bean hue={user?.hue ?? 200} size={28} />
              <span className="handle">{user?.handle ?? `#${tile.userId}`}</span>
              <span className="voice-state">
                {tile.muted ? 'Muted' : tile.speaking ? 'Speaking' : 'Quiet'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DockBody() {
  const { dockTab, unreadParty, unreadDm } = useApp();
  return (
    <div className="dock-body">
      <div className="tablist" role="tablist" aria-label="Dock channels">
        <button
          type="button"
          role="tab"
          id="tab-party"
          aria-selected={dockTab === 'party'}
          aria-controls="panel-party"
          className={dockTab === 'party' ? 'tab selected' : 'tab'}
          onClick={() => store.setDockTab('party')}
        >
          {unreadParty > 0 ? `Party chat (${unreadParty} unread)` : 'Party chat'}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-messages"
          aria-selected={dockTab === 'messages'}
          aria-controls="panel-messages"
          className={dockTab === 'messages' ? 'tab selected' : 'tab'}
          onClick={() => store.setDockTab('messages')}
        >
          {unreadDm > 0 ? `Messages (${unreadDm} unread)` : 'Messages'}
        </button>
      </div>
      <div
        role="tabpanel"
        id={dockTab === 'party' ? 'panel-party' : 'panel-messages'}
        aria-labelledby={dockTab === 'party' ? 'tab-party' : 'tab-messages'}
        className="tabpanel"
      >
        {dockTab === 'party' ? <PartyChat /> : <Messages />}
      </div>
      <VoicePanel />
    </div>
  );
}

export function Dock() {
  const { layout, dockExpanded, dockPanelOpen } = useApp();
  const close = (): void => store.setDockPanel(false);
  const dialogRef = useDialog(layout !== 'wide' && dockPanelOpen, close);

  if (layout !== 'wide') {
    if (!dockPanelOpen) return null;
    return (
      <div className="panel-backdrop dock-backdrop">
        <div
          className="panel dock-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Party dock"
          ref={dialogRef}
        >
          <div className="panel-head">
            <h2>Party dock</h2>
            <button type="button" onClick={close}>
              Close
            </button>
          </div>
          <DockBody />
        </div>
      </div>
    );
  }

  return (
    <aside className={dockExpanded ? 'dock' : 'dock collapsed'} aria-label="Party dock">
      <button
        type="button"
        className="dock-toggle"
        aria-expanded={dockExpanded}
        onClick={() => store.toggleDock()}
      >
        {dockExpanded ? 'Collapse dock' : 'Expand dock'}
      </button>
      {dockExpanded ? <DockBody /> : null}
    </aside>
  );
}
