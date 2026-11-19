import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  Channel,
  Message,
  MessageOrPlaceholder,
  SearchResult,
  StreamEvent,
  User,
  Workspace,
} from '../shared/api';
import { ROLE_LABELS } from '../shared/api';
import { chipForCounts, chipLabel } from '../shared/chips';
import { ApiFailure, apiGet, apiSend, apiSendWithTimeout, apiUpload } from './api';
import { setBusinessZone } from './format';
import { MessageList, type MessageAction, type PendingSend } from './MessageList';
import { PhotosPanel, PhotoDialog, ScheduledPanel, SearchPanel, ThreadPanel, VersionsPanel } from './Panels';
import { ReceiptsPanel } from './Receipts';
import {
  DeleteMessageDialog,
  EditMessageDialog,
  InviteDialog,
  MembersDialog,
  SchedulePostDialog,
  WorkspacePeopleDialog,
} from './Dialogs';
import { PrivateChip, RoleChip } from './Chips';
import { MenuGlyph, SearchGlyph } from './Icons';
import { MessageText } from './MessageText';
import { pushEscapeHandler } from './escape';

const PHOTO_SIGNATURES = ['jpeg', 'png', 'webp'] as const;
const PHOTO_BYTES = 10_000_000;
const PHOTOS_PER_MESSAGE = 4;

type PanelKind = 'none' | 'thread' | 'receipts' | 'versions' | 'photos' | 'scheduled' | 'search';

interface Address {
  channelId: string | null;
  q: string | null;
  thread: string | null;
  photo: string | null;
}

function readAddress(): Address {
  const path = window.location.pathname;
  const match = /^\/c\/([^/]+)/.exec(path);
  const params = new URLSearchParams(window.location.search);
  return {
    channelId: match === null ? null : (match[1] as string),
    q: params.get('q'),
    thread: params.get('thread'),
    photo: params.get('photo'),
  };
}

function addressToUrl(address: Address): string {
  const base = address.channelId === null ? '/' : `/c/${address.channelId}`;
  if (address.q !== null) return `${base}?q=${encodeURIComponent(address.q)}`;
  if (address.thread !== null) return `${base}?thread=${address.thread}`;
  if (address.photo !== null) return `${base}?photo=${address.photo}`;
  return base;
}

async function signatureOf(file: File): Promise<(typeof PHOTO_SIGNATURES)[number] | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  const text = new TextDecoder().decode(head);
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'webp';
  return null;
}

export function Shell({
  me,
  workspace,
  onSessionEnded,
}: {
  me: User;
  workspace: Workspace;
  onSessionEnded: () => void;
}): ReactElement {
  setBusinessZone(workspace.time_zone);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [address, setAddress] = useState<Address>(readAddress);
  const [messages, setMessages] = useState<MessageOrPlaceholder[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [notice, setNotice] = useState('');
  const [deliveryUpdate, setDeliveryUpdate] = useState('');
  const [uploadUpdate, setUploadUpdate] = useState('');
  const [uploadFraction, setUploadFraction] = useState<number | null>(null);
  const [channelNotFound, setChannelNotFound] = useState(false);
  const [lostChannelName, setLostChannelName] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<Message | null>(null);
  const [tray, setTray] = useState<File[]>([]);
  const [trayRefusals, setTrayRefusals] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchBox, setSearchBox] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'none' }
    | { kind: 'edit'; message: Message }
    | { kind: 'delete'; message: Message }
    | { kind: 'members' }
    | { kind: 'people' }
    | { kind: 'invite' }
    | { kind: 'schedule' }
  >({ kind: 'none' });
  const [panelOverride, setPanelOverride] = useState<{ kind: PanelKind; messageId?: string }>({ kind: 'none' });
  const [railOpen, setRailOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [dimmedPins, setDimmedPins] = useState<Set<string>>(new Set());
  const [photoTarget, setPhotoTarget] = useState<{ id: string; filename: string; messageId: string | null } | null>(
    null,
  );

  const listRef = useRef<HTMLDivElement>(null);
  const chipLabels = useRef(new Map<string, string>());
  const deliveredQueue = useRef(new Set<string>());
  const liveDown = useRef<number | null>(null);

  const channel = useMemo(
    () => channels.find((entry) => entry.id === address.channelId) ?? null,
    [channels, address.channelId],
  );

  const bump = useCallback(() => setRefreshKey((value) => value + 1), []);

  const navigate = useCallback((next: Address, replace = false): void => {
    const url = addressToUrl(next);
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setAddress(next);
  }, []);

  useEffect(() => {
    const onPop = (): void => setAddress(readAddress());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const loadChannels = useCallback(async (): Promise<Channel[]> => {
    const result = await apiGet<{ channels: Channel[] }>('/api/channels');
    setChannels(result.channels);
    return result.channels;
  }, []);

  useEffect(() => {
    void loadChannels().then((list) => {
      if (address.channelId === null && list.length > 0) navigate({ ...readAddress(), channelId: list[0]!.id }, true);
    });
  }, [loadChannels, navigate, address.channelId]);

  useEffect(() => {
    if (address.channelId === null) return;
    setChannelNotFound(false);
    setLostChannelName(null);
    setOlderFailed(false);
    void apiGet<{ messages: MessageOrPlaceholder[]; next_cursor: string | null }>(
      `/api/channels/${address.channelId}/messages`,
    )
      .then((result) => {
        setMessages(result.messages);
        setNextCursor(result.next_cursor);
      })
      .catch(() => {
        setMessages([]);
        setChannelNotFound(true);
        setNotice('That was not found.');
      });
  }, [address.channelId, refreshKey]);

  useEffect(() => {
    if (address.q === null) {
      setSearchResults(null);
      return;
    }
    setSearchBox(address.q);
    setSearchLoading(true);
    setSearchError(null);
    void apiGet<{ results: SearchResult[]; total: number }>(`/api/search?q=${encodeURIComponent(address.q)}`)
      .then((result) => {
        setSearchResults(result.results);
        setNotice(
          result.total === 0
            ? `No results for “${address.q as string}”.`
            : `${result.total} ${result.total === 1 ? 'result' : 'results'} for “${address.q as string}”.`,
        );
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure) setSearchError(error.body.errors?.['q'] ?? error.message);
        setSearchResults(null);
      })
      .finally(() => setSearchLoading(false));
  }, [address.q]);

  useEffect(() => {
    if (address.photo === null) {
      setPhotoTarget(null);
      return;
    }
    const found = messages
      .filter((message): message is Message => !message.deleted)
      .flatMap((message) => message.attachments.map((attachment) => ({ attachment, messageId: message.id })))
      .find((entry) => entry.attachment.id === address.photo);
    setPhotoTarget({
      id: address.photo,
      filename: found?.attachment.filename ?? 'Photo',
      messageId: found?.messageId ?? null,
    });
  }, [address.photo, messages]);

  const applyEvent = useCallback(
    (event: StreamEvent): void => {
      if (event.type === 'session.ended') {
        onSessionEnded();
        return;
      }
      if (event.type === 'stream.reset') {
        void loadChannels();
        bump();
        return;
      }
      if (event.type === 'channel.added') {
        setChannels((list) =>
          list.some((entry) => entry.id === event.data.channel.id)
            ? list.map((entry) => (entry.id === event.data.channel.id ? event.data.channel : entry))
            : [...list, event.data.channel].sort((left, right) => left.name.localeCompare(right.name)),
        );
        return;
      }
      if (event.type === 'channel.updated') {
        setChannels((list) =>
          list.map((entry) => (entry.id === event.data.channel.id ? event.data.channel : entry)),
        );
        return;
      }
      if (event.type === 'channel.revoked') {
        setChannels((list) => {
          const lost = list.find((entry) => entry.id === event.data.channel_id);
          if (lost !== undefined && lost.id === address.channelId) setLostChannelName(lost.name);
          return list.filter((entry) => entry.id !== event.data.channel_id);
        });
        return;
      }
      if (event.type === 'message.created') {
        const message = event.data.message;
        if (message.channel_id !== address.channelId) return;
        if (message.thread_root_id === null) {
          setMessages((list) => (list.some((entry) => entry.id === message.id) ? list : [message, ...list]));
        } else {
          bumpThread();
        }
        return;
      }
      if (event.type === 'message.updated') {
        const message = event.data.message;
        setMessages((list) => list.map((entry) => (entry.id === message.id ? message : entry)));
        bumpThread();
        return;
      }
      if (event.type === 'message.deleted') {
        setMessages((list) => list.filter((entry) => entry.id !== event.data.message_id));
        bumpThread();
        return;
      }
      if (event.type === 'receipts.updated') {
        setMessages((list) =>
          list.map((entry) =>
            entry.id === event.data.message_id && !entry.deleted
              ? {
                  ...entry,
                  recipient_count: event.data.recipient_count,
                  delivered_count: event.data.delivered_count,
                  read_count: event.data.read_count,
                }
              : entry,
          ),
        );
        bumpThread();
      }
    },
    [address.channelId, bump, loadChannels, onSessionEnded],
  );

  const [threadKey, setThreadKey] = useState(0);
  const bumpThread = useCallback(() => setThreadKey((value) => value + 1), []);

  const applyRef = useRef(applyEvent);
  applyRef.current = applyEvent;
  const noticeRef = useRef(setNotice);
  noticeRef.current = setNotice;

  useEffect(() => {
    const source = new EventSource('/api/events');
    const handler = (event: MessageEvent<string>): void => {
      applyRef.current({
        id: Number(event.lastEventId),
        type: event.type,
        data: JSON.parse(event.data),
      } as StreamEvent);
    };
    for (const name of [
      'message.created',
      'message.updated',
      'message.deleted',
      'receipts.updated',
      'channel.updated',
      'channel.added',
      'channel.revoked',
      'stream.reset',
      'session.ended',
    ]) {
      source.addEventListener(name, handler as EventListener);
    }
    source.onopen = () => {
      if (liveDown.current !== null) {
        liveDown.current = null;
        noticeRef.current('Live updates resumed.');
        void loadChannels();
        bump();
      }
    };
    source.onerror = () => {
      if (liveDown.current === null) liveDown.current = Date.now();
    };
    const timer = window.setInterval(() => {
      if (liveDown.current !== null && Date.now() - liveDown.current >= 5000) {
        noticeRef.current('Live updates paused. Reconnecting.');
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      source.close();
    };
  }, [bump, loadChannels]);

  useEffect(() => {
    for (const message of messages) {
      if (message.deleted || message.author.id === me.id) continue;
      deliveredQueue.current.add(message.id);
    }
    const timer = window.setTimeout(() => {
      const ids = [...deliveredQueue.current];
      deliveredQueue.current.clear();
      if (ids.length > 0) {
        void apiSend('POST', '/api/receipts', { message_ids: ids.slice(0, 100), state: 'delivered' }).catch(
          () => undefined,
        );
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [messages, me.id]);

  useEffect(() => {
    if (document.visibilityState !== 'visible') return undefined;
    const ids = messages
      .filter((message) => !message.deleted && message.author.id !== me.id)
      .map((message) => message.id);
    if (ids.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      void apiSend('POST', '/api/receipts', { message_ids: ids.slice(0, 100), state: 'read' })
        .then(() => void loadChannels())
        .catch(() => undefined);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [messages, me.id, loadChannels]);

  useEffect(() => {
    for (const message of messages) {
      if (message.deleted || message.author.id !== me.id) continue;
      const label = chipLabel(chipForCounts(message.delivered_count, message.read_count));
      const previous = chipLabels.current.get(message.id);
      if (previous !== undefined && previous !== label) {
        if (label === 'Delivered') setDeliveryUpdate('Message delivered.');
        else if (label.startsWith('Read · ')) setDeliveryUpdate(`Message read by ${message.read_count}.`);
      }
      chipLabels.current.set(message.id, label);
    }
  }, [messages, me.id]);

  const refusalFor = async (file: File, trayCount: number): Promise<string | null> => {
    if (trayCount >= PHOTOS_PER_MESSAGE) return 'That is more photos than one message can carry.';
    if ((await signatureOf(file)) === null) return `${file.name} is not a JPEG, PNG or WebP photo.`;
    if (file.size > PHOTO_BYTES) return `${file.name} is over the photo size limit.`;
    return null;
  };

  const chooseFiles = async (files: FileList): Promise<void> => {
    const accepted: File[] = [...tray];
    const refusals: string[] = [];
    for (const file of Array.from(files)) {
      const refusal = await refusalFor(file, accepted.length);
      if (refusal === null) accepted.push(file);
      else refusals.push(refusal);
    }
    setTray(accepted);
    setTrayRefusals(refusals);
    if (refusals.length > 0) setUploadUpdate(refusals.join(' '));
  };

  const performSend = useCallback(
    async (send: PendingSend): Promise<void> => {
      const target = address.channelId;
      if (target === null) return;
      try {
        let created: { message: Message };
        if (send.files.length > 0) {
          const form = new FormData();
          form.append('client_message_id', send.clientMessageId);
          form.append('text', send.text);
          if (send.threadRootId !== null) form.append('thread_root_id', send.threadRootId);
          if (send.quotedMessageId !== null) form.append('quoted_message_id', send.quotedMessageId);
          for (const file of send.files) form.append('file', file);
          let announced = 0;
          setUploadFraction(0);
          created = await apiUpload<{ message: Message }>(
            `/api/channels/${target}/messages`,
            form,
            (fraction) => {
              setUploadFraction(fraction);
              const step = Math.floor(fraction * 4) * 25;
              if (step > announced && step > 0) {
                announced = step;
                setUploadUpdate(
                  `Uploading ${send.files.length} ${send.files.length === 1 ? 'photo' : 'photos'}: ${step}%.`,
                );
              }
            },
          );
          setUploadFraction(null);
          setUploadUpdate(
            send.files.length === 1 ? '1 photo sent.' : `${send.files.length} photos sent.`,
          );
        } else {
          created = await apiSendWithTimeout<{ message: Message }>('POST', `/api/channels/${target}/messages`, {
            client_message_id: send.clientMessageId,
            text: send.text,
            thread_root_id: send.threadRootId,
            quoted_message_id: send.quotedMessageId,
          });
        }
        setPending((list) => list.filter((entry) => entry.clientMessageId !== send.clientMessageId));
        setDeliveryUpdate('Message sent.');
        if (created.message.thread_root_id === null) {
          setMessages((list) =>
            list.some((entry) => entry.id === created.message.id) ? list : [created.message, ...list],
          );
        } else {
          bumpThread();
        }
      } catch (error) {
        setUploadFraction(null);
        const copy =
          error instanceof ApiFailure ? error.message : 'Message failed to send. Use Retry send.';
        setPending((list) =>
          list.map((entry) =>
            entry.clientMessageId === send.clientMessageId ? { ...entry, state: 'failed', error: copy } : entry,
          ),
        );
        setDeliveryUpdate(
          error instanceof ApiFailure
            ? `Message failed to send: ${error.message}`
            : 'Message failed to send. Use Retry send.',
        );
        if (error instanceof ApiFailure && send.files.length > 0) {
          setUploadUpdate(`Photo upload stopped: ${error.message}`);
        }
      }
    },
    [address.channelId, bumpThread],
  );

  const startSend = useCallback(
    (text: string, files: File[], quotedMessageId: string | null, threadRootId: string | null): void => {
      const send: PendingSend = {
        clientMessageId: crypto.randomUUID(),
        text,
        files,
        quotedMessageId,
        threadRootId,
        createdAt: Date.now(),
        state: 'pending',
        error: null,
      };
      setPending((list) => [...list, send]);
      void performSend(send);
    },
    [performSend],
  );

  const onAction = (action: MessageAction, message: Message): void => {
    if (action === 'reply') navigate({ ...address, q: null, photo: null, thread: message.id });
    else if (action === 'quote') setQuoted(message);
    else if (action === 'edit') setDialog({ kind: 'edit', message });
    else if (action === 'delete') setDialog({ kind: 'delete', message });
    else if (action === 'receipts') setPanelOverride({ kind: 'receipts', messageId: message.id });
    else if (action === 'versions') setPanelOverride({ kind: 'versions', messageId: message.id });
    else if (action === 'pin' || action === 'unpin') void togglePin(action, message);
  };

  const togglePin = async (action: 'pin' | 'unpin', message: Message): Promise<void> => {
    setDimmedPins((set) => new Set(set).add(message.id));
    try {
      if (action === 'pin') {
        await apiSend('POST', `/api/channels/${message.channel_id}/pins`, { message_id: message.id });
        setNotice('Pinned.');
      } else {
        await apiSend('DELETE', `/api/channels/${message.channel_id}/pins/${message.id}`);
        setNotice('Unpinned.');
      }
      await loadChannels();
      bump();
    } catch (error) {
      if (error instanceof ApiFailure) setNotice(error.message);
    } finally {
      setDimmedPins((set) => {
        const next = new Set(set);
        next.delete(message.id);
        return next;
      });
    }
  };

  const panel: { kind: PanelKind; messageId?: string } =
    address.q !== null && searchError === null
      ? { kind: 'search' }
      : address.thread !== null
        ? { kind: 'thread', messageId: address.thread }
        : address.photo !== null
          ? { kind: 'photos' }
          : panelOverride;

  const panelHeading: Record<PanelKind, string> = {
    none: '',
    thread: 'Thread',
    receipts: 'Receipts',
    versions: 'Version history',
    photos: 'Photos',
    scheduled: 'Scheduled posts',
    search: 'Search results',
  };

  const closeDetails = (): void => {
    setPanelOverride({ kind: 'none' });
    if (address.q !== null || address.thread !== null || address.photo !== null) {
      navigate({ channelId: address.channelId, q: null, thread: null, photo: null }, true);
    }
  };

  const shellEscape = useRef<() => void>(() => undefined);
  shellEscape.current = () => {
    if (railOpen) {
      setRailOpen(false);
      return;
    }
    closeDetails();
  };
  useEffect(() => pushEscapeHandler(() => shellEscape.current()), []);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    if (scrolledUp) return;
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [ordered, pending, scrolledUp]);
  const pinnedMessages = useMemo(
    () =>
      (channel?.pinned_message_ids ?? [])
        .map((id) => ordered.find((entry) => entry.id === id))
        .filter((entry): entry is Message => entry !== undefined && !entry.deleted),
    [channel, ordered],
  );

  const broadcastReadOnly = channel?.kind === 'broadcast' && me.role === 'field_technician';
  const canSchedule = me.role === 'dispatcher' || me.role === 'ops_manager';

  const loadOlder = async (): Promise<void> => {
    if (nextCursor === null || loadingOlder || address.channelId === null) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    const list = listRef.current;
    const anchoredHeight = list === null ? 0 : list.scrollHeight - list.scrollTop;
    try {
      const result = await apiGet<{ messages: MessageOrPlaceholder[]; next_cursor: string | null }>(
        `/api/channels/${address.channelId}/messages?before=${encodeURIComponent(nextCursor)}`,
      );
      setMessages((current) => [...current, ...result.messages]);
      setNextCursor(result.next_cursor);
      window.requestAnimationFrame(() => {
        if (list !== null) list.scrollTop = list.scrollHeight - anchoredHeight;
      });
    } catch {
      setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#messages">
        Skip to messages
      </a>
      <header className="top-bar">
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = searchBox.trim();
            setSearchError(null);
            void apiGet<{ results: SearchResult[]; total: number }>(`/api/search?q=${encodeURIComponent(value)}`)
              .then(() => navigate({ channelId: address.channelId, q: value, thread: null, photo: null }))
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) setSearchError(error.body.errors?.['q'] ?? error.message);
              });
          }}
        >
          <SearchGlyph />
          <input
            type="search"
            aria-label="Search messages"
            placeholder="Search this workspace"
            value={searchBox}
            onChange={(event) => setSearchBox(event.target.value)}
          />
          {searchError !== null ? <p className="field-error">{searchError}</p> : null}
        </form>
        <span className="who">
          <span>{me.name}</span>
          <RoleChip label={ROLE_LABELS[me.role]} />
        </span>
        <button
          type="button"
          onClick={() => {
            void apiSend('DELETE', '/api/session').finally(onSessionEnded);
          }}
        >
          Sign out
        </button>
        <button type="button" className="rail-toggle" onClick={() => setRailOpen((value) => !value)}>
          <MenuGlyph />
          Channels
        </button>
      </header>

      <div className="columns">
        <nav aria-label="Channels" className={railOpen ? 'rail rail-open' : 'rail'}>
          <h2 className="workspace-name">{workspace.name}</h2>
          <ul>
            {channels.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`/c/${entry.id}`}
                  aria-current={entry.id === address.channelId ? 'page' : undefined}
                  className={entry.unread_count > 0 ? 'channel-link unread' : 'channel-link'}
                  aria-label={entry.unread_count > 0 ? `${entry.name}, ${entry.unread_count} unread` : entry.name}
                  onClick={(event) => {
                    event.preventDefault();
                    setRailOpen(false);
                    setPanelOverride({ kind: 'none' });
                    navigate({ channelId: entry.id, q: null, thread: null, photo: null });
                  }}
                >
                  <span>{entry.name}</span>
                  {entry.unread_count > 0 ? <span className="mono badge">{entry.unread_count}</span> : null}
                </a>
              </li>
            ))}
          </ul>
          {me.role === 'ops_manager' ? (
            <div className="rail-foot">
              <button type="button" onClick={() => setDialog({ kind: 'people' })}>
                Workspace people
              </button>
              <button type="button" onClick={() => setDialog({ kind: 'invite' })}>
                Invite technician
              </button>
            </div>
          ) : null}
        </nav>

        <main className="message-column">
          {lostChannelName !== null ? (
            <p className="alert-text">{`You no longer have access to #${lostChannelName}.`}</p>
          ) : channelNotFound || channel === null ? (
            <p className="alert-text">That was not found.</p>
          ) : (
            <>
              <h1 className="channel-title">
                <span aria-hidden="true">#</span>
                {channel.name}
              </h1>
              <p className="channel-kind">
                {channel.kind === 'broadcast' ? 'Broadcast' : 'Crew'}
                {channel.private ? <PrivateChip /> : null}
              </p>
              <div className="channel-actions">
                <button type="button" onClick={() => setPanelOverride({ kind: 'photos' })}>
                  Photos
                </button>
                <button type="button" onClick={() => setPanelOverride({ kind: 'scheduled' })}>
                  Scheduled posts
                </button>
                {canSchedule ? (
                  <button type="button" onClick={() => setDialog({ kind: 'schedule' })}>
                    Schedule post
                  </button>
                ) : null}
                <button type="button" onClick={() => setDialog({ kind: 'members' })}>
                  Members
                </button>
              </div>

              <section aria-label="Pinned" className="pinned">
                {pinnedMessages.map((message) => (
                  <div key={message.id} className="pinned-item">
                    <span className="message-text">
                      <MessageText text={message.text} />
                    </span>
                    <span className="pinned-by">{`Pinned by ${message.pinned_by?.name ?? ''}`}</span>
                  </div>
                ))}
              </section>

              <section
                aria-label="Messages"
                id="messages"
                className="messages"
                tabIndex={-1}
                ref={listRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  setScrolledUp(element.scrollHeight - element.scrollTop - element.clientHeight > 80);
                  if (element.scrollTop < 60) void loadOlder();
                }}
              >
                {loadingOlder ? <p>Loading older messages…</p> : null}
                {olderFailed ? (
                  <p>
                    Could not load older messages.{' '}
                    <button type="button" onClick={() => void loadOlder()}>
                      Try again
                    </button>
                  </p>
                ) : null}
                <MessageList
                  messages={ordered}
                  pending={pending}
                  me={me}
                  dimmedPins={dimmedPins}
                  onAction={onAction}
                  onOpenThread={(rootId) => navigate({ ...address, q: null, photo: null, thread: rootId })}
                  onOpenPhoto={(attachmentId) =>
                    navigate({ channelId: address.channelId, q: null, thread: null, photo: attachmentId })
                  }
                  onRetry={(send) => {
                    setPending((list) =>
                      list.map((entry) =>
                        entry.clientMessageId === send.clientMessageId
                          ? { ...entry, state: 'pending', error: null }
                          : entry,
                      ),
                    );
                    void performSend({ ...send, state: 'pending', error: null });
                  }}
                  onDiscard={(send) => {
                    setPending((list) => list.filter((entry) => entry.clientMessageId !== send.clientMessageId));
                    setTray([]);
                    setTrayRefusals([]);
                  }}
                />
              </section>

              {scrolledUp ? (
                <button
                  type="button"
                  onClick={() => {
                    const element = listRef.current;
                    if (element !== null) element.scrollTop = element.scrollHeight;
                    setScrolledUp(false);
                    const newest = element?.querySelector<HTMLElement>('article:last-of-type');
                    newest?.focus();
                  }}
                >
                  Jump to newest messages
                </button>
              ) : null}

              {broadcastReadOnly ? (
                <p className="composer-note">Replies only — open a thread to respond.</p>
              ) : (
                <div className="composer">
                  {quoted !== null ? (
                    <div className="quote-preview">
                      <span className="message-text">
                        <MessageText text={quoted.text} />
                      </span>
                      <button type="button" onClick={() => setQuoted(null)}>
                        Remove quote
                      </button>
                    </div>
                  ) : null}
                  {tray.length > 0 ? (
                    <ul aria-label="Photos to send" className="tray">
                      {tray.map((file) => (
                        <li key={file.name}>
                          <span>{file.name}</span>
                          <button
                            type="button"
                            onClick={() => setTray((list) => list.filter((entry) => entry !== file))}
                          >
                            {`Remove ${file.name}`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {trayRefusals.map((refusal) => (
                    <p key={refusal} className="refusal">
                      <span aria-hidden="true">⚠</span> {refusal}
                    </p>
                  ))}
                  {uploadFraction !== null ? (
                    <progress
                      aria-label="Upload progress"
                      max={100}
                      value={Math.round(uploadFraction * 100)}
                    />
                  ) : null}
                  <label className="attach">
                    <span>Attach photos</span>
                    <input
                      type="file"
                      aria-label="Attach photos"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        if (event.target.files !== null) void chooseFiles(event.target.files);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  <textarea
                    aria-label="Message"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submitDraft();
                      }
                    }}
                  />
                  <button type="button" onClick={submitDraft}>
                    Send
                  </button>
                </div>
              )}
            </>
          )}
          <div className="notices" role="status" aria-label="Notices">
            {notice}
          </div>
        </main>

        {panel.kind !== 'none' ? (
          <aside aria-label="Details" className="detail">
            <button type="button" onClick={closeDetails}>
              Close details
            </button>
            <h2>{panelHeading[panel.kind]}</h2>
            {panel.kind === 'thread' && panel.messageId !== undefined ? (
              <ThreadPanel
                rootId={panel.messageId}
                me={me}
                onAction={onAction}
                onOpenPhoto={(attachmentId) =>
                  navigate({ channelId: address.channelId, q: null, thread: null, photo: attachmentId })
                }
                onSendReply={(text, rootId) => startSend(text, [], null, rootId)}
                refreshKey={threadKey}
              />
            ) : null}
            {panel.kind === 'receipts' && panel.messageId !== undefined ? (
              <ReceiptsPanel messageId={panel.messageId} refreshKey={threadKey} />
            ) : null}
            {panel.kind === 'versions' && panel.messageId !== undefined ? (
              <VersionsPanel messageId={panel.messageId} />
            ) : null}
            {panel.kind === 'photos' && channel !== null ? (
              <PhotosPanel
                channel={channel}
                refreshKey={refreshKey}
                onOpenPhoto={(attachmentId) =>
                  navigate({ channelId: address.channelId, q: null, thread: null, photo: attachmentId })
                }
              />
            ) : null}
            {panel.kind === 'scheduled' && channel !== null ? (
              <ScheduledPanel
                channel={channel}
                canCancel={canSchedule}
                refreshKey={refreshKey}
                onNotice={setNotice}
                onChanged={bump}
              />
            ) : null}
            {panel.kind === 'search' ? (
              <SearchPanel
                results={searchResults}
                loading={searchLoading}
                onOpenResult={(result) => {
                  navigate({
                    channelId: result.channel.id,
                    q: null,
                    thread: result.thread_root_id,
                    photo: result.attachment_id ?? null,
                  });
                  if (result.thread_root_id === null && result.attachment_id === undefined) {
                    window.setTimeout(() => focusArticle(result.message_id), 400);
                  }
                }}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      <div className="visually-hidden" role="status" aria-label="Delivery updates">
        {deliveryUpdate}
      </div>
      <div className="visually-hidden" role="status" aria-label="Upload progress">
        {uploadUpdate}
      </div>

      {address.photo !== null ? (
        <PhotoDialog
          attachment={photoTarget}
          onClose={closeDetails}
          onGoToMessage={(messageId) => {
            navigate({ channelId: address.channelId, q: null, thread: null, photo: null }, true);
            window.setTimeout(() => focusArticle(messageId), 50);
          }}
        />
      ) : null}

      {dialog.kind === 'edit' ? (
        <EditMessageDialog
          message={dialog.message}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={bump}
          onNotice={setNotice}
        />
      ) : null}
      {dialog.kind === 'delete' ? (
        <DeleteMessageDialog
          message={dialog.message}
          onClose={() => setDialog({ kind: 'none' })}
          onDeleted={bump}
          onNotice={setNotice}
        />
      ) : null}
      {dialog.kind === 'members' && channel !== null ? (
        <MembersDialog channel={channel} me={me} onClose={() => setDialog({ kind: 'none' })} onNotice={setNotice} />
      ) : null}
      {dialog.kind === 'people' ? (
        <WorkspacePeopleDialog me={me} onClose={() => setDialog({ kind: 'none' })} onNotice={setNotice} />
      ) : null}
      {dialog.kind === 'invite' ? (
        <InviteDialog onClose={() => setDialog({ kind: 'none' })} onNotice={setNotice} />
      ) : null}
      {dialog.kind === 'schedule' && channel !== null ? (
        <SchedulePostDialog
          channel={channel}
          onClose={() => setDialog({ kind: 'none' })}
          onNotice={setNotice}
          onScheduled={bump}
        />
      ) : null}
    </div>
  );

  function focusArticle(messageId: string): void {
    const article = document.getElementById(`message-${messageId}`);
    article?.scrollIntoView({ block: 'center' });
    article?.focus();
  }

  function submitDraft(): void {
    if (draft.trim().length === 0 && tray.length === 0) return;
    startSend(draft, tray, quoted?.id ?? null, null);
    setDraft('');
    setTray([]);
    setTrayRefusals([]);
    setQuoted(null);
  }
}
