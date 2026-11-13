import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ATTACHMENT_TYPES, FILE_LIMIT_BYTES, FILES_PER_MESSAGE } from '../shared/attachments.js';
import { TOPICS } from '../shared/types.js';
import type { AttachmentBody, Topic, WidgetMe, WidgetThreadBody } from '../shared/types.js';
import { announce, useAnnouncement } from './announce.js';
import { ApiError, api } from './api.js';
import { Column } from './Chrome.js';
import { Formatted, LinkPreview, eventWords, formatTime } from './text.js';

const POLL_MS = 1000;
const ATTACHMENT_POLLS = 24;
const TOPIC_LABELS: Record<Topic, string> = { bug: 'Bug', account: 'Account', purchase: 'Purchase', other: 'Something else' };
const IDENTITY_COPY = "This help window couldn't confirm who you are. Reopen it from the game.";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const newKey = (): string => `hl-${crypto.randomUUID()}`;
const rateNotice = (seconds: number): string => `You're writing faster than the inbox can read. Try again in ${seconds} seconds.`;

export function WidgetPage({ slug, search }: { slug: string; search: string }) {
  const params = new URLSearchParams(search);
  const identity = { 'X-Hushline-Player': params.get('player') ?? '', 'X-Hushline-Player-Signature': params.get('sig') ?? '' };
  const base = `/api/widget/${encodeURIComponent(slug)}`;
  const call = <T,>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> =>
    api<T>(`${base}${path}`, { ...options, headers: identity, staff: false });
  const [me, setMe] = useState<WidgetMe | null>(null);
  const [thread, setThread] = useState<WidgetThreadBody | null>(null);
  const [identityFailed, setIdentityFailed] = useState(false);
  const [text, setText] = useState('');
  const [topic, setTopic] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<{ body?: string; topic?: string; file?: string }>({});
  const [notice, setNotice] = useState<number | null>(null);
  const status = useAnnouncement('Widget announcements');
  const key = useRef('');
  const sending = useRef(false);
  const recheck = useRef<number | undefined>(undefined);
  const threadId = useRef<string | null>(null);
  const shown = useRef('');

  const showThread = (next: WidgetThreadBody): void => {
    const serialised = JSON.stringify(next);
    if (serialised === shown.current) return;
    shown.current = serialised;
    setThread(next);
  };

  const applyBucket = (retryAfterSeconds: number | null, wasBlocked: boolean): void => {
    window.clearTimeout(recheck.current);
    if (retryAfterSeconds !== null) {
      const seconds = retryAfterSeconds;
      setNotice(seconds);
      announce('Widget announcements', rateNotice(seconds));
      recheck.current = window.setTimeout(() => void latest.current.askMe(true), seconds * 1000);
    } else {
      setNotice(null);
      if (wasBlocked) announce('Widget announcements', 'You can write again.');
    }
  };

  const askMe = async (wasBlocked: boolean): Promise<WidgetMe | null> => {
    try {
      const next = await call<WidgetMe>('/me');
      setMe(next);
      threadId.current = next.thread_id;
      applyBucket(next.bucket.retry_after_seconds, wasBlocked);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_identity') {
        setIdentityFailed(true);
        announce('Widget announcements', IDENTITY_COPY);
      }
      return null;
    }
  };

  const refreshThread = async (): Promise<void> => {
    if (threadId.current === null) return;
    try {
      showThread(await call<WidgetThreadBody>(`/threads/${threadId.current}`));
    } catch {
      return;
    }
  };

  const latest = useRef({ askMe, refreshThread });
  latest.current = { askMe, refreshThread };

  useEffect(() => {
    document.title = 'Help · Hushline';
    void latest.current.askMe(false).then(() => latest.current.refreshThread());
    const poll = window.setInterval(() => void latest.current.refreshThread(), POLL_MS);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(recheck.current);
    };
  }, []);

  const pickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    const accepted = [...files];
    let problem: string | undefined;
    for (const file of picked) {
      if (file.size > FILE_LIMIT_BYTES) problem = 'Files can be up to 5,000,000 bytes.';
      else if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) problem = 'Attach a PNG, JPEG or plain-text file.';
      else if (accepted.length >= FILES_PER_MESSAGE) problem = 'Three files per message at most.';
      else accepted.push(file);
    }
    setFiles(accepted);
    setErrors((current) => ({ ...current, file: problem }));
  };

  const upload = async (messageId: string, file: File): Promise<void> => {
    announce('Widget announcements', `Uploading ${file.name}...`);
    const form = new FormData();
    form.append('file', file, file.name);
    const response = await fetch(`${base}/messages/${messageId}/attachments`, { method: 'POST', headers: identity, body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { fields?: Record<string, string> } } | null;
      const sentence = body?.error?.fields?.file ?? `${file.name} didn't upload. Send it again later.`;
      setErrors((current) => ({ ...current, file: sentence }));
      announce('Widget announcements', `${file.name} didn't upload. Send it again later.`);
      return;
    }
    const { attachment } = (await response.json()) as { attachment: AttachmentBody };
    await refreshThread();
    let latest = attachment;
    for (let attempt = 0; attempt < ATTACHMENT_POLLS && latest.status === 'uploading'; attempt += 1) {
      await sleep(500);
      latest = await call<AttachmentBody>(`/attachments/${attachment.id}`).catch(() => latest);
    }
    await refreshThread();
    announce('Widget announcements', latest.status === 'attached' ? `Attached ${latest.filename}.` : `${latest.filename} didn't upload. Send it again later.`);
  };

  const send = async (): Promise<void> => {
    if (sending.current || notice !== null) return;
    const found: typeof errors = {};
    if (text.trim() === '') found.body = 'Write a message before sending.';
    if (threadId.current === null && !TOPICS.includes(topic as Topic)) found.topic = 'Choose what this is about.';
    setErrors((current) => ({ file: current.file, ...found }));
    if (found.body || found.topic) return;
    sending.current = true;
    announce('Widget announcements', 'Sending...');
    key.current ||= newKey();
    try {
      const sent = await call<{ message: { id: string }; thread: { id: string } }>('/messages', {
        method: 'POST',
        body: threadId.current === null ? { body: text, topic } : { body: text },
        key: key.current,
      });
      threadId.current = sent.thread.id;
      key.current = '';
      const queued = files;
      setText('');
      setFiles([]);
      setErrors({});
      announce('Widget announcements', 'Sent. Replies appear here.');
      await refreshThread();
      await askMe(false);
      for (const file of queued) await upload(sent.message.id, file);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const seconds = Number(error.headers.get('Retry-After') ?? 1);
        applyBucket(seconds, false);
      } else if (error instanceof ApiError && error.code === 'validation') {
        setErrors({ body: error.fields.body, topic: error.fields.topic });
      } else announce('Widget announcements', 'Message not sent. Try again.');
    } finally {
      sending.current = false;
    }
  };

  const gameName = me?.game.name ?? 'the game';
  return (
    <main className="screen widget">
      <Column className="widget-column">
        <h1>{me ? `Help with ${gameName}` : 'Help'}</h1>
        {identityFailed ? (
          <p className="note">{IDENTITY_COPY}</p>
        ) : (
          <>
            <ul className="conversation" role="list" aria-label="Conversation">
              {thread?.messages.map((message) => (
                <li key={message.id} className={`message message-${message.kind}`}>
                  <p className="message-meta">
                    <span className="author">{message.author.role === 'player' ? 'You' : message.author.name}</span>{' '}
                    <time className="figures" dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                  </p>
                  <p className="message-body">{message.event ? eventWords(message.event) : <Formatted text={message.body ?? ''} />}</p>
                  {message.attachments.length > 0 ? (
                    <ul className="attachments" role="list">
                      {message.attachments.map((attachment) => (
                        <li key={attachment.id}>
                          <span>{attachment.filename}</span> <span className="word">{attachment.status}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {message.unfurl ? <LinkPreview preview={message.unfurl} /> : null}
                </li>
              ))}
            </ul>
            <form className="form" onSubmit={(event) => event.preventDefault()}>
              {thread === null && me !== null ? (
                <>
                  <label htmlFor="topic" className="label">Topic</label>
                  <select id="topic" className="field" value={topic} onChange={(event) => setTopic(event.target.value)} aria-describedby={errors.topic ? 'topic-error' : undefined}>
                    <option value="" disabled hidden>Choose a topic</option>
                    {TOPICS.map((name) => <option key={name} value={name}>{TOPIC_LABELS[name]}</option>)}
                  </select>
                  {errors.topic ? <p className="error" id="topic-error">{errors.topic}</p> : null}
                </>
              ) : null}
              <label htmlFor="message" className="label">Message</label>
              <textarea id="message" className="field" rows={4} value={text} onChange={(event) => setText(event.target.value)} aria-describedby={errors.body ? 'message-error' : undefined} />
              {errors.body ? <p className="error" id="message-error">{errors.body}</p> : null}
              <div className="filepicker">
                <span className="filepicker-label" aria-hidden="true">Attach a file</span>
                <input id="file" type="file" className="filepicker-input" multiple accept="image/png,image/jpeg,text/plain" aria-label="Attach a file" onChange={pickFiles} />
              </div>
              {errors.file ? <p className="error">{errors.file}</p> : null}
              {files.length > 0 ? (
                <ul className="picked" role="list">
                  {files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}</li>)}
                </ul>
              ) : null}
              <button type="button" className="button primary send" data-blocked={notice !== null} aria-disabled={notice !== null} onClick={() => void send()}>
                Send
              </button>
            </form>
          </>
        )}
        <div role="status" aria-label="Widget announcements" aria-live="polite" className="announcements">{status}</div>
      </Column>
    </main>
  );
}
