import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, CalendarPlus, Hash, Images, LogOut, Menu, Search, UserPlus, Users, X } from "lucide-react";
import { api, apiMessage } from "./api";
import { endSession, NoticesRegion } from "./App";
import { Composer } from "./Composer";
import { Chip, RoleChip } from "./components/Chip";
import { FieldError } from "./components/Dialog";
import { useLayer } from "./components/layers";
import { MessageText } from "./components/MessageText";
import { loadChannels, loadHistory } from "./data";
import { DeleteDialog, EditDialog } from "./dialogs/MessageDialogs";
import { InviteDialog, MembersDialog, PeopleDialog } from "./dialogs/PeopleDialogs";
import { ScheduleDialog } from "./dialogs/ScheduleDialog";
import { broadcastLive, useNarrow, useReducedMotion } from "./hooks";
import { resync, startLive, stop } from "./live";
import { type MessageAction, MessageList } from "./MessageList";
import { PhotoDialog, PhotosPanel } from "./panels/PhotosPanel";
import { ReceiptsPanel } from "./panels/ReceiptsPanel";
import { ScheduledPanel } from "./panels/ScheduledPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { ThreadPanel } from "./panels/ThreadPanel";
import { VersionsPanel } from "./panels/VersionsPanel";
import { managesPeople, schedules, startsTopLevel } from "./permissions";
import { cachedSearch, runSearch } from "./query";
import { channelPath, dropParameter, navigate, useAddress } from "./route";
import { notify, putEntries, resetSession, setState, useMe, useStore } from "./store";
import type { Channel, Me, Message } from "./types";

const NOT_FOUND = "That was not found.";

export type QuoteDraft = { messageId: string; authorName: string; text: string };

type LocalPanel = { kind: "receipts" | "versions"; messageId: string } | { kind: "photos" } | { kind: "scheduled" } | null;

type DialogState =
  | { kind: "edit"; message: Message }
  | { kind: "delete"; message: Message }
  | { kind: "members" }
  | { kind: "people" }
  | { kind: "invite" }
  | { kind: "schedule" }
  | null;

type PanelKind = "search" | "thread" | "photos" | "receipts" | "versions" | "scheduled";

export function Shell() {
  const state = useStore();
  const me = useMe();
  const address = useAddress();
  const narrow = useNarrow();
  const channelId = address.screen === "channel" ? address.channelId : null;
  const channel = state.channels.find((c) => c.id === channelId) ?? null;
  const [railOpen, setRailOpen] = useState(false);
  const [localPanel, setLocalPanel] = useState<LocalPanel>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [quotes, setQuotes] = useState<{ channel: QuoteDraft | null; thread: QuoteDraft | null }>({ channel: null, thread: null });
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [scheduledVersion, setScheduledVersion] = useState(0);

  // Live connection for the whole session.
  useEffect(() => {
    void loadChannels();
    startLive({
      onSessionEnded: endSession,
      onReset: () => broadcastLive({ name: "stream.reset", data: {} }),
      onEvent: (name, data) => broadcastLive({ name, data }),
    });
    return () => stop();
  }, []);

  // "/" goes to the person's first channel by name.
  useEffect(() => {
    if (address.screen === "root" && state.channelsLoaded && state.channels[0]) navigate(channelPath(state.channels[0].id), { replace: true });
  }, [address.screen, state.channelsLoaded, state.channels]);

  // Opening a channel loads its history; a reset or reconnect refetches it.
  const known = channel !== null;
  useEffect(() => {
    if (channelId && known) void loadHistory(channelId);
  }, [channelId, known]);

  useEffect(() => {
    const onReset = (event: Event) => {
      if ((event as CustomEvent<{ name: string }>).detail.name === "stream.reset") void resync(channelId && known ? channelId : null);
    };
    window.addEventListener("rimewire:live", onReset);
    return () => window.removeEventListener("rimewire:live", onReset);
  }, [channelId, known]);

  // Not found and lost access are announced once per address.
  const revokedName = channelId ? state.revoked[channelId] : undefined;
  const channelState: "ok" | "loading" | "not_found" | "lost" = channel ? "ok" : !state.channelsLoaded ? "loading" : revokedName ? "lost" : "not_found";
  useEffect(() => {
    if (address.screen !== "channel") return;
    if (channelState === "not_found") notify(NOT_FOUND);
    if (channelState === "lost" && revokedName) notify(`You no longer have access to #${revokedName}.`);
  }, [address.screen, channelState, revokedName, channelId]);

  // Panels: the address carries search, thread or photo; the rest live on this screen.
  const q = address.screen === "channel" ? address.q : null;
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [, setSearched] = useState(0);
  const queryRefusal = q !== null ? (refusals[q] ?? null) : null;
  const queryAccepted = q !== null && cachedSearch(q) !== undefined;
  // A query arriving by address (reload, Back, a shared link) opens results only once the
  // server has accepted it; a refused one shows its copy under the box.
  useEffect(() => {
    if (q === null || cachedSearch(q) || refusals[q]) return;
    let live = true;
    runSearch(q).then(
      (outcome) => {
        if (!live) return;
        if ("refused" in outcome) setRefusals((current) => ({ ...current, [q]: outcome.refused }));
        else setSearched((n) => n + 1);
      },
      (failure: unknown) => notify(apiMessage(failure)),
    );
    return () => {
      live = false;
    };
  }, [q, refusals]);
  const addressPanel: PanelKind | null =
    channelState !== "ok"
      ? null
      : q !== null
        ? queryAccepted
          ? "search"
          : null
        : pendingQuery !== null
          ? "search"
          : address.screen === "channel" && address.thread
            ? "thread"
            : address.screen === "channel" && address.photo
              ? "photos"
              : null;
  const panel: PanelKind | null = channelState !== "ok" ? null : addressPanel ?? localPanel?.kind ?? null;

  useEffect(() => {
    setLocalPanel(null);
    setQuotes({ channel: null, thread: null });
  }, [channelId]);

  const closeDetails = useCallback(() => {
    setLocalPanel(null);
    if (address.screen === "channel" && (address.q !== null || address.thread || address.photo)) dropParameter();
  }, [address]);

  const openLocal = (next: Exclude<LocalPanel, null>) => {
    if (address.screen === "channel" && (address.q !== null || address.thread || address.photo)) dropParameter();
    setLocalPanel(next);
  };

  const openThread = (rootId: string) => {
    setLocalPanel(null);
    if (channelId) navigate(channelPath(channelId, { thread: rootId }));
  };

  const onAction = (action: MessageAction, message: Message) => {
    switch (action) {
      case "reply":
        openThread(message.id);
        break;
      case "quote": {
        const draft = { messageId: message.id, authorName: message.author.name, text: message.text };
        setQuotes((current) => (message.thread_root_id ? { ...current, thread: draft } : { ...current, channel: draft }));
        break;
      }
      case "edit":
        setDialog({ kind: "edit", message });
        break;
      case "delete":
        setDialog({ kind: "delete", message });
        break;
      case "pin":
      case "unpin":
        void togglePin(message, action === "pin");
        break;
      case "receipts":
        openLocal({ kind: "receipts", messageId: message.id });
        break;
      case "versions":
        openLocal({ kind: "versions", messageId: message.id });
        break;
    }
  };

  const goToMessage = (message: { id: string; channel_id: string; thread_root_id: string | null }) => {
    setLocalPanel(null);
    if (message.thread_root_id) navigate(channelPath(message.channel_id, { thread: message.thread_root_id }));
    else {
      navigate(channelPath(message.channel_id));
      setFocusTarget(message.id);
    }
  };

  const signOut = async () => {
    try {
      await api("DELETE", "/api/session");
    } finally {
      stop();
      resetSession("signedOut");
    }
  };

  const composerAllowed = channel ? startsTopLevel(me.user.role, channel.kind) : false;

  return (
    <div className={`shell${panel ? " has-detail" : ""}`}>
      <TopBar me={me} q={q} queryRefusal={queryRefusal} channelId={channelId} onSearching={(query) => {
        setLocalPanel(null);
        setPendingQuery(query);
      }} onSignOut={signOut} railOpen={railOpen} onToggleRail={() => setRailOpen((open) => !open)} />
      <div className="workspace">
        <Rail
          me={me}
          channels={state.channels}
          currentId={channelId}
          open={railOpen}
          narrow={narrow}
          onClose={() => setRailOpen(false)}
          onPeople={() => setDialog({ kind: "people" })}
          onInvite={() => setDialog({ kind: "invite" })}
        />
        <main className="message-column" aria-labelledby={channel ? "channel-title" : undefined}>
          {channelState === "ok" && channel ? (
            <>
              <ChannelHeader
                channel={channel}
                me={me}
                onPhotos={() => openLocal({ kind: "photos" })}
                onScheduled={() => openLocal({ kind: "scheduled" })}
                onSchedule={() => setDialog({ kind: "schedule" })}
                onMembers={() => setDialog({ kind: "members" })}
              />
              <PinnedStrip channel={channel} />
              <MessageList key={channel.id} channel={channel} me={me} onAction={onAction} onOpenThread={openThread} focusTarget={focusTarget} onFocused={() => setFocusTarget(null)} />
              {composerAllowed ? (
                <Composer
                  key={channel.id}
                  channel={channel}
                  threadRootId={null}
                  quote={quotes.channel}
                  onClearQuote={() => setQuotes((current) => ({ ...current, channel: null }))}
                />
              ) : (
                <p className="replies-only">Replies only — open a thread to respond.</p>
              )}
            </>
          ) : (
            <ColumnState state={channelState} revokedName={revokedName} hasChannels={state.channels.length > 0} isRoot={address.screen === "root"} />
          )}
          <NoticesRegion className="notices" />
        </main>
        {channel ? (
          <DetailHost panel={panel} onClose={closeDetails}>
            {panel === "search" && q === null && pendingQuery !== null ? <SearchPanel query={pendingQuery} pending /> : null}
            {panel === "search" && q !== null ? <SearchPanel query={q} onOpen={(result) => {
              setLocalPanel(null);
              if (result.kind === "photo" && result.attachment_id) navigate(channelPath(result.channel.id, { photo: result.attachment_id }));
              else goToMessage({ id: result.message_id, channel_id: result.channel.id, thread_root_id: result.thread_root_id });
            }} /> : null}
            {panel === "thread" && address.screen === "channel" && address.thread ? (
              <ThreadPanel
                key={address.thread}
                channel={channel}
                rootId={address.thread}
                me={me}
                onAction={onAction}
                quote={quotes.thread}
                onClearQuote={() => setQuotes((current) => ({ ...current, thread: null }))}
              />
            ) : null}
            {panel === "photos" ? <PhotosPanel channel={channel} /> : null}
            {panel === "receipts" && localPanel?.kind === "receipts" ? <ReceiptsPanel key={localPanel.messageId} messageId={localPanel.messageId} /> : null}
            {panel === "versions" && localPanel?.kind === "versions" ? <VersionsPanel key={localPanel.messageId} messageId={localPanel.messageId} /> : null}
            {panel === "scheduled" ? <ScheduledPanel channel={channel} me={me} refreshKey={scheduledVersion} /> : null}
          </DetailHost>
        ) : null}
      </div>
      {address.screen === "channel" && address.photo && channel && channelState === "ok" ? (
        <PhotoDialog key={address.photo} channel={channel} attachmentId={address.photo} onGoTo={goToMessage} />
      ) : null}
      {dialog?.kind === "edit" ? <EditDialog message={dialog.message} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "delete" ? <DeleteDialog message={dialog.message} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "members" && channel ? <MembersDialog channel={channel} me={me} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "people" ? <PeopleDialog me={me} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "invite" ? <InviteDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "schedule" && channel ? (
        <ScheduleDialog channel={channel} zone={me.workspace.time_zone} onClose={() => setDialog(null)} onScheduled={() => setScheduledVersion((n) => n + 1)} />
      ) : null}
      <LiveRegions />
    </div>
  );
}

// Pin and unpin; the pinned strip and chips follow the channel.updated and message.updated
// events the change sends to every member.
async function togglePin(message: Message, pin: boolean): Promise<void> {
  setState((current) => ({ pendingPins: { ...current.pendingPins, [message.id]: true } }));
  try {
    if (pin) await api("POST", `/api/channels/${message.channel_id}/pins`, { message_id: message.id });
    else await api("DELETE", `/api/channels/${message.channel_id}/pins/${message.id}`);
    notify(pin ? "Pinned." : "Unpinned.");
  } catch (error) {
    notify(apiMessage(error));
  } finally {
    setState((current) => {
      const pendingPins = { ...current.pendingPins };
      delete pendingPins[message.id];
      return { pendingPins };
    });
  }
}

function TopBar(props: {
  me: Me;
  q: string | null;
  queryRefusal: string | null;
  channelId: string | null;
  onSearching: (query: string | null) => void;
  onSignOut: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  const { me, q, queryRefusal, channelId } = props;
  const [text, setText] = useState(q ?? "");
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  useEffect(() => {
    setText(q ?? "");
    setError(null);
  }, [q]);
  const shownError = error ?? queryRefusal;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = text.trim();
    props.onSearching(trimmed);
    try {
      const outcome = await runSearch(trimmed);
      if ("refused" in outcome) {
        setError(outcome.refused);
        return;
      }
      setError(null);
      if (channelId) navigate(channelPath(channelId, { q: trimmed }));
    } catch (failure) {
      setError(apiMessage(failure));
    } finally {
      props.onSearching(null);
    }
  };

  return (
    <header className="top-bar">
      <a className="skip-link" href="#messages" onClick={(event) => {
        event.preventDefault();
        document.getElementById("messages")?.focus();
      }}>
        Skip to messages
      </a>
      <form className="search" role="search" onSubmit={submit}>
        <Search aria-hidden="true" size={20} className="search-glyph" />
        <input
          type="search"
          aria-label="Search messages"
          placeholder="Search this workspace"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? errorId : undefined}
        />
        {shownError ? <FieldError id={errorId} text={shownError} /> : null}
      </form>
      <div className="who">
        <span className="who-name">{me.user.name}</span>
        <RoleChip role={me.user.role} />
      </div>
      <button className="button button-quiet top-button" type="button" onClick={props.onSignOut} aria-label="Sign out">
        <LogOut aria-hidden="true" size={20} />
        <span className="wide-only" aria-hidden="true">
          Sign out
        </span>
      </button>
      <button className="button button-quiet top-button channels-button" type="button" aria-expanded={props.railOpen} onClick={props.onToggleRail} aria-label="Channels">
        <Menu aria-hidden="true" size={20} />
      </button>
    </header>
  );
}

function Rail(props: {
  me: Me;
  channels: Channel[];
  currentId: string | null;
  open: boolean;
  narrow: boolean;
  onClose: () => void;
  onPeople: () => void;
  onInvite: () => void;
}) {
  const { me, channels, currentId, open, narrow } = props;
  useLayer("rail", props.onClose, open && narrow);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open && narrow) ref.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open, narrow]);
  return (
    <>
      {open && narrow ? <div className="scrim" onClick={props.onClose} aria-hidden="true" /> : null}
      <nav ref={ref} className={`rail${open ? " rail-open" : ""}`} aria-label="Channels">
        <p className="rail-workspace">{me.workspace.name}</p>
        <p className="rail-who">
          <span className="who-name">{me.user.name}</span>
          <RoleChip role={me.user.role} />
        </p>
        {channels.length === 0 ? <p className="rail-empty">No channels yet. An operations manager adds you to them.</p> : null}
        <ul className="rail-list">
          {channels.map((channel) => (
            <li key={channel.id}>
              <a
                href={channelPath(channel.id)}
                className={`rail-link${channel.unread_count > 0 ? " unread" : ""}`}
                aria-current={channel.id === currentId ? "page" : undefined}
                aria-label={channel.unread_count > 0 ? `${channel.name}, ${channel.unread_count} unread` : channel.name}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(channelPath(channel.id));
                  props.onClose();
                }}
              >
                <Hash aria-hidden="true" size={16} className="rail-hash" />
                <span className="rail-name">{channel.name}</span>
                {channel.unread_count > 0 ? (
                  <>
                    {" "}
                    <span className="badge" key={channel.unread_count}>
                      {channel.unread_count}
                    </span>
                  </>
                ) : null}
              </a>
            </li>
          ))}
        </ul>
        {managesPeople(me.user.role) ? (
          <div className="rail-foot">
            <button className="button button-quiet button-block" type="button" onClick={props.onPeople}>
              <Users aria-hidden="true" size={20} />
              Workspace people
            </button>
            <button className="button button-quiet button-block" type="button" onClick={props.onInvite}>
              <UserPlus aria-hidden="true" size={20} />
              Invite technician
            </button>
          </div>
        ) : null}
      </nav>
    </>
  );
}

function ChannelHeader(props: { channel: Channel; me: Me; onPhotos: () => void; onScheduled: () => void; onSchedule: () => void; onMembers: () => void }) {
  const { channel, me } = props;
  return (
    <div className="channel-header">
      <div className="channel-title-row">
        <span className="channel-hash" aria-hidden="true">
          #
        </span>
        <h1 id="channel-title" className="channel-title">
          {channel.name}
        </h1>
        <span className="kind-chip">{channel.kind === "broadcast" ? "Broadcast" : "Crew"}</span>
        {channel.private ? <Chip kind="private" label="Private" /> : null}
      </div>
      <div className="channel-actions">
        <button className="button button-quiet" type="button" onClick={props.onPhotos}>
          <Images aria-hidden="true" size={20} />
          Photos
        </button>
        <button className="button button-quiet" type="button" onClick={props.onScheduled}>
          <CalendarClock aria-hidden="true" size={20} />
          Scheduled posts
        </button>
        {schedules(me.user.role) ? (
          <button className="button button-quiet" type="button" onClick={props.onSchedule}>
            <CalendarPlus aria-hidden="true" size={20} />
            Schedule post
          </button>
        ) : null}
        <button className="button button-quiet" type="button" onClick={props.onMembers}>
          <Users aria-hidden="true" size={20} />
          Members
        </button>
      </div>
    </div>
  );
}

function PinnedStrip({ channel }: { channel: Channel }) {
  const { entries } = useStore();
  const ids = channel.pinned_message_ids;
  const missing = ids.filter((id) => !entries[id]);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    for (const id of missingKey.split(",")) {
      api<{ message: Message }>("GET", `/api/messages/${id}`).then(
        (body) => putEntries([body.message]),
        () => undefined,
      );
    }
  }, [missingKey]);
  if (ids.length === 0) return null;
  return (
    <section className="pinned" aria-label="Pinned">
      <ul>
        {ids.map((id) => {
          const entry = entries[id];
          if (!entry || entry.deleted) return null;
          return (
            <li key={id} className="pinned-item">
              <Chip kind="pinned" label="Pinned" active />
              <MessageText text={entry.text} className="pinned-text" />
              {entry.pinned_by ? <p className="pinned-by">Pinned by {entry.pinned_by.name}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ColumnState({ state, revokedName, hasChannels, isRoot }: { state: "loading" | "not_found" | "lost" | "ok"; revokedName: string | undefined; hasChannels: boolean; isRoot: boolean }) {
  let copy = "Loading channels…";
  if (state === "not_found") copy = NOT_FOUND;
  if (state === "lost" && revokedName) copy = `You no longer have access to #${revokedName}.`;
  if (isRoot && state !== "loading" && !hasChannels) copy = "You are not in any channels yet. An operations manager adds you to them.";
  return (
    <div className="column-state" id="messages" tabIndex={-1}>
      <p>{copy}</p>
    </div>
  );
}

// The detail column: travels in from its edge, leaves in about a sixth of a second. Its
// contents show once it has landed, so nothing moves under a pointer.
function DetailHost({ panel, onClose, children }: { panel: PanelKind | null; onClose: () => void; children: ReactNode }) {
  const reduced = useReducedMotion();
  const last = useRef<{ panel: PanelKind; content: ReactNode } | null>(null);
  const [previous, setPrevious] = useState(panel);
  const [leaving, setLeaving] = useState<{ panel: PanelKind; content: ReactNode } | null>(null);
  if (panel !== previous) {
    setPrevious(panel);
    setLeaving(panel === null && !reduced ? last.current : null);
  }
  if (panel) last.current = { panel, content: children };
  useLayer("panel", onClose, panel !== null);
  const shown = panel ? { panel, content: children } : leaving;
  if (!shown) return null;
  return (
    <aside
      className={`detail${panel ? "" : " detail-leaving"}`}
      aria-label="Details"
      data-panel={shown.panel}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && !panel) setLeaving(null);
      }}
    >
      <div className="detail-bar">
        <button className="button button-quiet" type="button" onClick={onClose} disabled={!panel}>
          <X aria-hidden="true" size={20} />
          Close details
        </button>
      </div>
      <div className="detail-body" data-scroll-root>
        {shown.content}
      </div>
    </aside>
  );
}

function LiveRegions() {
  const { delivery, upload } = useStore();
  return (
    <>
      <div role="status" aria-label="Delivery updates" className="visually-hidden">
        {delivery ? <p key={delivery.id}>{delivery.text}</p> : null}
      </div>
      <div role="status" aria-label="Upload progress" className="visually-hidden">
        {upload ? <p key={upload.id}>{upload.text}</p> : null}
      </div>
    </>
  );
}
