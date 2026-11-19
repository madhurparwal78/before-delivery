import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BRANCH_COLOURS, ICONS, SHAPES, type DocTopic, type PublicOp, type TaskFields, type ThreadInfo } from '../../shared/model.ts';
import { parseNote, type Block, type Inline } from '../../shared/notes.ts';
import { COPY, can, noticeQuota, noticeTooLarge } from '../../shared/rules.ts';
import { lockOf } from '../../shared/tree.ts';
import { HttpError, api } from '../api.ts';
import { Glyph } from './glyphs.tsx';
import { newOpId, type MapSession } from './session.ts';
import type { DetailsTab } from './ui.ts';
import { useSession } from './useSession.ts';

function InlineView(props: { nodes: Inline[] }) {
  return (
    <>
      {props.nodes.map((node, at) => {
        switch (node.kind) {
          case 'bold':
            return <strong key={at}>{node.text}</strong>;
          case 'italic':
            return <em key={at}>{node.text}</em>;
          case 'code':
            return <code key={at}>{node.text}</code>;
          case 'link':
            return (
              <a key={at} href={node.href} target="_blank" rel="noopener noreferrer nofollow">
                {node.text}
              </a>
            );
          case 'text':
            return <span key={at}>{node.text}</span>;
        }
      })}
    </>
  );
}

/** Safe markdown subset: every other character stays literal text. */
export function NoteView(props: { text: string }) {
  const blocks: Block[] = parseNote(props.text);
  return (
    <>
      {blocks.map((block, at) =>
        block.kind === 'list' ? (
          <ul key={at}>
            {block.items.map((item, i) => (
              <li key={i}>
                <InlineView nodes={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={at}>
            <InlineView nodes={block.inline} />
          </p>
        ),
      )}
    </>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <label class="field-row">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

function StyleControls(props: { session: MapSession; topic: DocTopic; editable: boolean }) {
  const { session, topic, editable } = props;
  const style = (patch: { colour?: string | null; shape?: DocTopic['shape']; icon?: string | null }): void => {
    session.submit([{ op_id: newOpId(), kind: 'style', topic_id: topic.id, ...patch } as PublicOp]);
  };
  return (
    <fieldset class="style-controls" disabled={!editable}>
      <legend>Style</legend>
      <div class="swatches" role="group" aria-label="Colour">
        <button type="button" class="swatch swatch-none" aria-pressed={topic.colour === null} aria-label="Default colour" onClick={() => style({ colour: null })}>
          Auto
        </button>
        {BRANCH_COLOURS.map((colour) => (
          <button key={colour} type="button" class="swatch" style={{ '--branch': `var(--c-${colour})` }} aria-pressed={topic.colour === colour} aria-label={`Colour ${colour}`} onClick={() => style({ colour })} />
        ))}
        {session.display.custom_colours.map((hex) => (
          <button key={hex} type="button" class="swatch" style={{ '--branch': hex }} aria-pressed={topic.colour === hex} aria-label={`Colour ${hex}`} onClick={() => style({ colour: hex })} />
        ))}
      </div>
      <label class="field-row">
        <span>Custom colour</span>
        <input
          type="color"
          aria-label="Custom colour"
          value={topic.colour?.startsWith('#') ? topic.colour : '#1a40ff'}
          onChange={(event) => {
            const hex = event.currentTarget.value.toLowerCase();
            const save: PublicOp[] = session.display.custom_colours.includes(hex) ? [] : [{ op_id: newOpId(), kind: 'custom_colour', colour: hex }];
            session.submit([...save, { op_id: newOpId(), kind: 'style', topic_id: topic.id, colour: hex }]);
          }}
        />
      </label>
      <Field label="Shape">
        <select value={topic.shape ?? ''} onChange={(event) => style({ shape: event.currentTarget.value === '' ? null : (event.currentTarget.value as DocTopic['shape']) })}>
          <option value="">Theme default</option>
          {SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {shape}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Icon">
        <select value={topic.icon ?? ''} onChange={(event) => style({ icon: event.currentTarget.value === '' ? null : event.currentTarget.value })}>
          <option value="">None</option>
          {ICONS.map((icon) => (
            <option key={icon} value={icon}>
              {icon}
            </option>
          ))}
        </select>
      </Field>
    </fieldset>
  );
}

function BranchControls(props: { session: MapSession; topic: DocTopic }) {
  const { session, topic } = props;
  const lock = lockOf(session.display.topics, topic.id);
  const mine = lock !== null && lock.holder === session.me.name;
  const owner = can(session.role, 'unlock_any');
  const change = (kind: 'lock' | 'unlock'): void => session.submit([{ op_id: newOpId(), kind, topic_id: topic.id }]);
  const restrict = (restricted: boolean): void => session.submit([{ op_id: newOpId(), kind: 'restrict', topic_id: topic.id, restricted }]);
  if (!can(session.role, 'lock')) return null;
  return (
    <fieldset class="style-controls branch-controls">
      <legend>Branch</legend>
      {lock ? <p class="muted">{`Locked by ${lock.holder}`}</p> : null}
      {!lock ? (
        <button type="button" class="btn btn-secondary btn-small" onClick={() => change('lock')}>
          Lock branch
        </button>
      ) : null}
      {lock && !lock.inherited && (mine || owner) ? (
        <button type="button" class="btn btn-secondary btn-small" onClick={() => change('unlock')}>
          Unlock branch
        </button>
      ) : null}
      {can(session.role, 'restrict') ? (
        <button type="button" class="btn btn-secondary btn-small" aria-pressed={topic.restricted} onClick={() => restrict(!topic.restricted)}>
          {topic.restricted ? 'Lift restriction' : 'Restrict branch'}
        </button>
      ) : null}
    </fieldset>
  );
}

function NotesTab(props: { session: MapSession; topic: DocTopic }) {
  const { session, topic } = props;
  const editable = session.canEdit;
  const [draft, setDraft] = useState(topic.note);
  const [status, setStatus] = useState('');
  const latest = useRef({ draft, topic });
  latest.current = { draft, topic };
  const dirty = useRef(false);
  const file = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    setDraft(topic.note);
    dirty.current = false;
  }, [topic.id]);
  useLayoutEffect(() => {
    if (!dirty.current) setDraft(topic.note);
  }, [topic.note]);

  const commit = (): void => {
    const { draft: text, topic: current } = latest.current;
    if (!dirty.current || text === current.note) return;
    dirty.current = false;
    session.submit([{ op_id: newOpId(), kind: 'note', topic_id: current.id, text }]);
  };
  useLayoutEffect(() => commit, [topic.id]);

  const attach = async (picked: File): Promise<void> => {
    const { attach_max_bytes: limit, map_quota_bytes: quota } = session.settings;
    if (picked.size > limit) {
      setStatus(noticeTooLarge(limit));
      return;
    }
    setStatus(`Uploading ${picked.name}`);
    try {
      await api('POST', `/api/maps/${session.mapId}/topics/${topic.id}/attachments`, new Uint8Array(await picked.arrayBuffer()));
      setStatus('Image attached.');
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      if (error.code === 'wrong_type') setStatus(COPY.wrong_type);
      else if (error.code === 'quota_exceeded') setStatus(noticeQuota(quota));
      else if (error.code === 'too_large') setStatus(noticeTooLarge(limit));
      else setStatus(error.message);
    }
  };

  return (
    <div class="tab-body">
      <label class="field-col">
        <span>Note</span>
        <textarea
          aria-label="Note"
          value={draft}
          readOnly={!editable}
          rows={5}
          onInput={(event) => {
            dirty.current = true;
            setDraft(event.currentTarget.value);
          }}
          onBlur={commit}
        />
      </label>
      <div role="region" aria-label="Note preview" class="note-preview">
        <NoteView text={draft} />
      </div>
      {editable ? (
        <div class="attach">
          <button type="button" class="btn btn-secondary" onClick={() => file.current?.click()}>
            Attach image
          </button>
          <input
            ref={file}
            type="file"
            class="visually-hidden"
            aria-label="Attach image"
            accept="image/png,image/jpeg"
            tabIndex={-1}
            onChange={(event) => {
              const picked = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (picked) void attach(picked);
            }}
          />
        </div>
      ) : null}
      {status ? (
        <p class="attach-status" role="status">
          {status}
        </p>
      ) : null}
      <ul class="attachments">
        {topic.attachments.map((a) => (
          <li key={a.id}>
            <img src={`/api/attachments/${a.id}`} alt={`Attachment on ${topic.title}`} />
            {editable ? (
              <button
                type="button"
                class="btn btn-secondary btn-small"
                aria-label={`Remove attachment ${a.sha256.slice(0, 6)}`}
                onClick={() => void api('DELETE', `/api/attachments/${a.id}`)}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <StyleControls session={session} topic={topic} editable={editable} />
      <BranchControls session={session} topic={topic} />
    </div>
  );
}

const DEFAULT_TASK: TaskFields = { percent: 0, weight: 1, state: 'open', priority: 'normal', due: null, assignee: null };

function TaskTab(props: { session: MapSession; topic: DocTopic }) {
  const { session, topic } = props;
  const editable = session.canEdit;
  const task = topic.task;
  const set = (patch: Partial<TaskFields> | null): void => {
    session.submit([{ op_id: newOpId(), kind: 'task', topic_id: topic.id, task: patch }]);
  };
  const update = (patch: Partial<TaskFields>): void => set(task ? patch : { ...DEFAULT_TASK, ...patch });
  const number = (event: Event, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(Number((event.currentTarget as HTMLInputElement).value) || 0)));
  return (
    <fieldset class="tab-body" disabled={!editable}>
      <label class="check-row">
        <input type="checkbox" aria-label="Task" checked={task !== null} onChange={(event) => set(event.currentTarget.checked ? { ...DEFAULT_TASK } : null)} />
        <span>Task</span>
      </label>
      <label class="check-row">
        <input type="checkbox" aria-label="Done" checked={task?.percent === 100} onChange={(event) => update({ percent: event.currentTarget.checked ? 100 : 0 })} />
        <span>Done</span>
      </label>
      <Field label="Percent done">
        <input type="number" aria-label="Percent done" min={0} max={100} value={task?.percent ?? 0} disabled={!task} onChange={(event) => update({ percent: number(event, 0, 100) })} />
      </Field>
      <Field label="Weight">
        <input type="number" aria-label="Weight" min={0} max={10} value={task?.weight ?? 1} disabled={!task} onChange={(event) => update({ weight: number(event, 0, 10) })} />
      </Field>
      <Field label="Priority">
        <select aria-label="Priority" value={task?.priority ?? 'normal'} disabled={!task} onChange={(event) => update({ priority: event.currentTarget.value as TaskFields['priority'] })}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </Field>
      <Field label="State">
        <select aria-label="State" value={task?.state ?? 'open'} disabled={!task} onChange={(event) => update({ state: event.currentTarget.value as TaskFields['state'] })}>
          <option value="open">Open</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </Field>
      <Field label="Assignee">
        <select aria-label="Assignee" value={task?.assignee ?? ''} disabled={!task} onChange={(event) => update({ assignee: event.currentTarget.value === '' ? null : event.currentTarget.value })}>
          <option value="">Nobody</option>
          {session.roster.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due date">
        <input type="date" aria-label="Due date" value={task?.due ?? ''} disabled={!task} onChange={(event) => update({ due: event.currentTarget.value === '' ? null : event.currentTarget.value })} />
      </Field>
    </fieldset>
  );
}

function CommentsTab(props: { session: MapSession; topic: DocTopic }) {
  const { session, topic } = props;
  const canTalk = can(session.role, 'comment');
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [body, setBody] = useState('');
  const [replying, setReplying] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  const load = async (): Promise<void> => {
    const result = await api<{ threads: ThreadInfo[] }>('GET', `/api/maps/${session.mapId}/topics/${topic.id}/comments`);
    setThreads(result.threads);
  };
  useLayoutEffect(() => {
    void load();
  }, [topic.id, session.activityTick, session.counts.comments[topic.id]]);

  const before = body.slice(0, box.current?.selectionStart ?? body.length);
  const mention = /@([a-z0-9_]*)$/.exec(before);
  const options = mention ? session.roster.filter((name) => name.startsWith(mention[1] ?? '')) : [];
  const choose = (name: string): void => {
    if (!mention) return;
    const start = before.length - mention[0].length;
    setBody(`${body.slice(0, start)}@${name} ${body.slice(before.length)}`);
    setActive(-1);
  };

  const post = async (): Promise<void> => {
    if (body.trim().length === 0) return;
    try {
      await api('POST', `/api/maps/${session.mapId}/topics/${topic.id}/comments`, { body: body.trim(), reply_to: replying });
      setBody('');
      setReplying(null);
      setError('');
      await load();
    } catch (failure) {
      if (failure instanceof HttpError) setError(failure.message);
    }
  };

  const act = async (id: string, verb: 'resolve' | 'reopen'): Promise<void> => {
    await api('POST', `/api/comments/${id}/${verb}`);
    await load();
  };

  const voted = session.counts.mine.has(topic.id);
  const vote = async (): Promise<void> => {
    const result = await api<{ vote_count: number; voted: boolean }>('PUT', `/api/maps/${session.mapId}/topics/${topic.id}/vote`, { voted: !voted });
    session.counts.votes[topic.id] = result.vote_count;
    if (result.voted) session.counts.mine.add(topic.id);
    else session.counts.mine.delete(topic.id);
    session.notify();
  };

  return (
    <div class="tab-body">
      {canTalk ? (
        <button type="button" class="vote" aria-pressed={voted} aria-label={`Vote for ${topic.title}`} onClick={() => void vote()}>
          <Glyph name="star" size={16} /> Vote <span class="figure">{session.counts.votes[topic.id] ?? 0}</span>
        </button>
      ) : null}
      <ul class="threads">
        {threads.map((thread) => (
          <li key={thread.id} class={thread.resolved ? 'thread resolved' : 'thread'}>
            <p class="comment">
              <strong>{thread.author}</strong> {thread.body}
            </p>
            <ul class="replies">
              {thread.replies.map((reply) => (
                <li key={reply.id} class="comment">
                  <strong>{reply.author}</strong> {reply.body}
                </li>
              ))}
            </ul>
            {canTalk ? (
              <div class="thread-actions">
                <button type="button" class="btn btn-secondary btn-small" onClick={() => setReplying(thread.id)}>
                  Reply
                </button>
                {thread.resolved ? (
                  <button type="button" class="btn btn-secondary btn-small" onClick={() => void act(thread.id, 'reopen')}>
                    Reopen
                  </button>
                ) : (
                  <button type="button" class="btn btn-secondary btn-small" onClick={() => void act(thread.id, 'resolve')}>
                    Resolve
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canTalk ? (
        <div class="composer">
          {replying ? <p class="muted">Replying to a thread</p> : null}
          <label class="field-col">
            <span>Add a comment</span>
            <textarea
              ref={box}
              aria-label="Add a comment"
              value={body}
              rows={3}
              onInput={(event) => {
                setBody(event.currentTarget.value);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (options.length === 0) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setActive(Math.min(options.length - 1, Math.max(0, active + step)));
                } else if (event.key === 'Enter' && active >= 0) {
                  event.preventDefault();
                  choose(options[active] as string);
                }
              }}
            />
          </label>
          {options.length > 0 ? (
            <ul role="listbox" aria-label="Mention" class="mention-list">
              {options.map((name, at) => (
                <li key={name} role="option" aria-selected={at === active} class={at === active ? 'active' : undefined} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(name)}>
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p class="field-error">{error}</p> : null}
          <button type="button" class="btn btn-primary" onClick={() => void post()}>
            Post comment
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Details(props: { session: MapSession; topicId: string; tab: DetailsTab; onTab: (tab: DetailsTab) => void; onClose: () => void }) {
  const { session } = props;
  useSession(session);
  const topic = session.display.topics[props.topicId];
  const tabs: { id: DetailsTab; name: string }[] = [
    { id: 'notes', name: 'Notes' },
    { id: 'task', name: 'Task' },
    { id: 'comments', name: 'Comments' },
  ];
  if (!topic) return <p class="muted pad">Select a topic to see its details.</p>;
  return (
    <div class="details">
      <div class="details-head">
        <h2 class="details-title">{topic.title}</h2>
        <button type="button" class="btn btn-secondary btn-small" aria-label="Close details" onClick={props.onClose}>
          <Glyph name="close" size={16} />
        </button>
      </div>
      <div role="tablist" aria-label="Topic details" class="tabs">
        {tabs.map((t, at) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={props.tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={props.tab === t.id ? 0 : -1}
            onClick={() => props.onTab(t.id)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const next = tabs[(at + step + tabs.length) % tabs.length];
              if (next) {
                props.onTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }
            }}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${props.tab}`} aria-labelledby={`tab-${props.tab}`}>
        {props.tab === 'notes' ? <NotesTab session={session} topic={topic} /> : null}
        {props.tab === 'task' ? <TaskTab session={session} topic={topic} /> : null}
        {props.tab === 'comments' ? <CommentsTab session={session} topic={topic} /> : null}
      </div>
    </div>
  );
}
