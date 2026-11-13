import { useCallback, useEffect, useRef, useState } from 'react';
import { COPY, attachedAnnouncement, attachmentFailedAnnouncement, rateLimitNotice, uploadingAnnouncement } from '../../shared/copy';
import type { ThreadBody, ThreadMessage, Topic, WidgetMeBody } from '../../shared/types';
import { formatPlayerText, formatText, formatTime } from '../lib/format';
import { eventWords } from '../lib/format';
import { newIdempotencyKey } from '../lib/media';

const TOPIC_OPTIONS: Array<{ value: Topic; label: string }> = [
  { value: 'bug', label: 'Bug' },
  { value: 'account', label: 'Account' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'other', label: 'Something else' },
];

const MAX_FILE_BYTES = 5_000_000;

interface WidgetResponse<T> {
  status: number;
  body: T | null;
  retryAfterSeconds: number | null;
}

interface WidgetPageProps {
  slug: string;
  gameName: string;
}

export function WidgetPage({ slug, gameName }: WidgetPageProps): React.ReactElement {
  const search = new URLSearchParams(window.location.search);
  const playerId = search.get('player') ?? '';
  const signature = search.get('sig') ?? '';

  const [identityValid, setIdentityValid] = useState(true);
  const [thread, setThread] = useState<ThreadBody | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [topic, setTopic] = useState<Topic>('bug');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [retrySeconds, setRetrySeconds] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const draftKeyRef = useRef<string | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  const call = useCallback(
    async <T,>(
      path: string,
      options: { method?: string; body?: unknown; idempotencyKey?: string; form?: FormData } = {},
    ): Promise<WidgetResponse<T>> => {
      const headers: Record<string, string> = {
        'X-Hushline-Player': playerId,
        'X-Hushline-Player-Signature': signature,
      };
      if (options.body !== undefined) headers['Content-Type'] = 'application/json';
      if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
      const init: RequestInit = { method: options.method ?? 'GET', headers };
      if (options.body !== undefined) init.body = JSON.stringify(options.body);
      if (options.form !== undefined) init.body = options.form;
      const response = await fetch(path, init);
      const retryAfter = response.headers.get('Retry-After');
      let body: T | null = null;
      try {
        body = (await response.json()) as T;
      } catch {
        body = null;
      }
      return {
        status: response.status,
        body,
        retryAfterSeconds: retryAfter === null ? null : Number(retryAfter),
      };
    },
    [playerId, signature],
  );

  const scheduleBucketCheck = useCallback(
    (seconds: number) => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        void (async () => {
          const me = await call<WidgetMeBody>(`/api/widget/${slug}/me`);
          if (me.status !== 200 || me.body === null) return;
          if (me.body.bucket.level >= 1) {
            setRetrySeconds(null);
            setAnnouncement(COPY.widgetCanWrite);
            return;
          }
          const next = me.body.bucket.retry_after_seconds ?? 1;
          setRetrySeconds(next);
          setAnnouncement(rateLimitNotice(next));
          scheduleBucketCheck(next);
        })();
      }, Math.max(1, seconds) * 1000);
    },
    [call, slug],
  );

  /** The widget's rate-limit state always comes from the server's latest answer. */
  const readMe = useCallback(async () => {
    const me = await call<WidgetMeBody>(`/api/widget/${slug}/me`);
    if (me.status === 401) {
      setIdentityValid(false);
      setAnnouncement(COPY.widgetIdentity);
      return null;
    }
    if (me.status !== 200 || me.body === null) return null;
    setIdentityValid(true);
    setThreadId(me.body.thread_id);
    if (me.body.bucket.level < 1) {
      const seconds = me.body.bucket.retry_after_seconds ?? 1;
      setRetrySeconds(seconds);
      setAnnouncement(rateLimitNotice(seconds));
      scheduleBucketCheck(seconds);
    } else {
      setRetrySeconds(null);
    }
    return me.body;
  }, [call, slug, scheduleBucketCheck]);

  useEffect(() => {
    void readMe();
  }, [readMe]);

  const refreshThread = useCallback(
    async (id: string) => {
      const response = await call<ThreadBody>(`/api/widget/${slug}/threads/${encodeURIComponent(id)}`);
      if (response.status === 200 && response.body !== null) setThread(response.body);
    },
    [call, slug],
  );

  useEffect(() => {
    if (threadId === null) return;
    void refreshThread(threadId);
    const timer = window.setInterval(() => {
      void refreshThread(threadId);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [threadId, refreshThread]);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    },
    [],
  );

  const pickFiles = (chosen: FileList | null): void => {
    const list = chosen === null ? [] : [...chosen];
    if (list.length > 3) {
      setFileError(COPY.widgetFileCount);
      return;
    }
    const tooBig = list.find((file) => file.size > MAX_FILE_BYTES || file.size === 0);
    if (tooBig !== undefined && tooBig.size > MAX_FILE_BYTES) {
      setFileError(COPY.widgetFileSize);
      return;
    }
    setFileError('');
    setFiles(list);
  };

  const uploadFiles = async (messageId: string, chosen: File[]): Promise<void> => {
    for (const file of chosen) {
      setAnnouncement(uploadingAnnouncement(file.name));
      const form = new FormData();
      form.append('file', file, file.name);
      const response = await call<{ attachment: { id: string; filename: string } }>(
        `/api/widget/${slug}/messages/${encodeURIComponent(messageId)}/attachments`,
        { method: 'POST', form },
      );
      if (response.status !== 202 || response.body === null) {
        setFileError(
          response.status === 413 ? COPY.widgetFileSize : COPY.widgetFileType,
        );
        continue;
      }
      const stored = response.body.attachment;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const state = await call<{ status: string; filename: string }>(
          `/api/widget/${slug}/attachments/${encodeURIComponent(stored.id)}`,
        );
        if (state.status !== 200 || state.body === null) break;
        if (state.body.status === 'attached') {
          setAnnouncement(attachedAnnouncement(state.body.filename));
          break;
        }
        if (state.body.status === 'failed') {
          setAnnouncement(attachmentFailedAnnouncement(state.body.filename));
          break;
        }
      }
    }
  };

  const send = async (): Promise<void> => {
    if (pending || retrySeconds !== null) return;
    const trimmed = message.trim();
    if (trimmed === '') {
      setMessageError(COPY.widgetMessageEmpty);
      setAnnouncement(COPY.widgetMessageEmpty);
      return;
    }
    setMessageError('');
    if (draftKeyRef.current === null) draftKeyRef.current = newIdempotencyKey();
    const key = draftKeyRef.current;
    const chosen = files;
    setPending(true);
    setAnnouncement(COPY.widgetSending);
    const payload: { body: string; topic?: Topic } = { body: message };
    if (threadId === null) payload.topic = topic;
    const response = await call<{ message: ThreadMessage; thread: { id: string } }>(
      `/api/widget/${slug}/messages`,
      { method: 'POST', body: payload, idempotencyKey: key },
    );
    setPending(false);
    if (response.status === 429) {
      const seconds = response.retryAfterSeconds ?? 1;
      setRetrySeconds(seconds);
      setAnnouncement(rateLimitNotice(seconds));
      scheduleBucketCheck(seconds);
      return;
    }
    if (response.status !== 201 || response.body === null) {
      setAnnouncement(COPY.widgetFailed);
      return;
    }
    draftKeyRef.current = null;
    setMessage('');
    setFiles([]);
    setAnnouncement(COPY.widgetSent);
    setThreadId(response.body.thread.id);
    await refreshThread(response.body.thread.id);
    if (chosen.length > 0) await uploadFiles(response.body.message.id, chosen);
    await readMe();
    await refreshThread(response.body.thread.id);
  };

  const conversation = thread?.messages ?? [];

  return (
    <div className="column widget">
      <h1>{`Help with ${gameName}`}</h1>
      {identityValid ? (
        <ul className="messages" aria-label="Conversation">
          {conversation.map((entry) => (
            <li key={entry.id} className={`message ${entry.kind}`}>
              <span className="message-author">{entry.author.name}</span>
              <span className="figures message-time">{formatTime(entry.created_at)}</span>
              <span className="message-body">
                {entry.kind === 'event' && entry.event !== null
                  ? eventWords(entry.event)
                  : entry.kind === 'player'
                    ? formatPlayerText(entry.body ?? '')
                    : formatText(entry.body ?? '')}
              </span>
              {entry.attachments.map((attachment) => (
                <span className="attachment" key={attachment.id}>
                  <span className="attachment-name">{attachment.filename}</span>
                  <span className="attachment-status">{attachment.status}</span>
                </span>
              ))}
              {entry.unfurl !== null && (
                <span className="unfurl">
                  <span className="unfurl-title">{entry.unfurl.title}</span>
                  {entry.unfurl.description !== null && (
                    <span className="unfurl-description">{entry.unfurl.description}</span>
                  )}
                  <span className="unfurl-host">{hostOf(entry.unfurl.url)}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="pane-note">{COPY.widgetIdentity}</p>
      )}
      {identityValid && (
        <div className="widget-form">
          {threadId === null && (
            <div className="field">
              <label htmlFor="widget-topic">Topic</label>
              <select
                id="widget-topic"
                value={topic}
                onChange={(event) => setTopic(event.target.value as Topic)}
              >
                {TOPIC_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="widget-message">Message</label>
            <textarea
              id="widget-message"
              value={message}
              onChange={(event) => {
                if (draftKeyRef.current === null) draftKeyRef.current = newIdempotencyKey();
                setMessage(event.target.value);
              }}
            />
            {messageError !== '' && <p className="field-error">{messageError}</p>}
          </div>
          <div className="field">
            <label htmlFor="widget-file">Attach a file</label>
            <input
              id="widget-file"
              type="file"
              multiple
              onChange={(event) => pickFiles(event.target.files)}
            />
            {files.length > 0 && (
              <ul className="picked-files">
                {files.map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
              </ul>
            )}
            {fileError !== '' && <p className="field-error">{fileError}</p>}
          </div>
          {retrySeconds !== null && <p className="field-error">{rateLimitNotice(retrySeconds)}</p>}
          <button
            type="button"
            className={retrySeconds === null ? 'accent-button' : 'ink-button'}
            aria-disabled={retrySeconds !== null ? 'true' : undefined}
            onClick={() => void send()}
          >
            Send
          </button>
        </div>
      )}
      <p className="live-region" role="status" aria-label="Widget announcements" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
