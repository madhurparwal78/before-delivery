import { createContext } from 'preact';
import { useContext, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Button, Time } from '../../ui.tsx';
import type { ChangeView, DiffFile, ThreadView } from '../../../shared/types.ts';
import { commentLine, rowAnchorsThread, rowName, unitsOf, type RowRef, type ViewMode } from './model.ts';

interface DiffContext {
  view: ChangeView;
  mode: ViewMode;
  cursorKey: string | null;
  pointerCursor: boolean;
  newThreads: Set<number>;
  batch: Set<number>;
  reduced: boolean;
  onRowClick(row: RowRef): void;
  onComment(row: RowRef, opener: HTMLElement): void;
  onViewed(path: string, viewed: boolean): void;
  onBatch(commentId: number): void;
  onApply(ids: number[]): void;
  onReply(threadId: number, body: string): Promise<string | null>;
  onResolve(thread: ThreadView): void;
}

export const Ctx = createContext<DiffContext>(null as never);

const STATUS_WORD = { added: 'Added', modified: 'Modified', deleted: 'Deleted' } as const;

function Suggestion({ comment }: { comment: ThreadView['comments'][number] }) {
  const ctx = useContext(Ctx);
  const suggestion = comment.suggestion!;
  const canApply = ctx.view.viewer.is_author || ctx.view.viewer.can_maintain;
  const inBatch = ctx.batch.has(comment.id);
  return (
    <div role="region" aria-label="Suggested change" className="suggestion">
      <pre className="suggestion-lines">{suggestion.lines.map((line, i) => <span key={i} className="sg-line"><span className="sg-mark">+</span>{line}{'\n'}</span>)}</pre>
      {suggestion.state === 'applied' ? (
        <span className="applied">Applied</span>
      ) : canApply ? (
        <div className="suggestion-actions">
          <Button kind="secondary" onClick={() => ctx.onApply([comment.id])}>Apply suggestion</Button>
          <Button kind="secondary" onClick={() => ctx.onBatch(comment.id)}>{inBatch ? 'Remove from batch' : 'Add to batch'}</Button>
        </div>
      ) : null}
    </div>
  );
}

export function Thread({ thread }: { thread: ThreadView }) {
  const ctx = useContext(Ctx);
  const [anim, setAnim] = useState(ctx.newThreads.has(thread.id) && !ctx.reduced ? 'entering' : 'none');
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const failure = await ctx.onReply(thread.id, reply);
    setBusy(false);
    if (failure) setError(failure);
    else setReply('');
  };
  return (
    <article
      className="thread"
      aria-label={`Thread on ${thread.path} line ${thread.line}`}
      tabIndex={-1}
      data-thread-id={thread.id}
      data-state={thread.state}
      data-outdated={String(thread.outdated)}
      data-path={thread.path}
      data-side={thread.side}
      data-line={thread.line}
      data-anim={anim}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setAnim('none');
      }}
    >
      <header className="cp-thread-head">
        <span className="thread-where">{thread.path}:{thread.line}</span>
        {thread.outdated ? <span className="chip">Outdated</span> : null}
        <span className="thread-state">{thread.state === 'resolved' ? 'Resolved' : 'Unresolved'}</span>
      </header>
      <ul className="comments">
        {thread.comments.map((comment) => (
          <li key={comment.id}>
            <div className="comment-meta">
              <strong>{comment.author_name}</strong>
              <Time value={comment.created_at} />
            </div>
            <p className="comment-body">{comment.body}</p>
            {comment.suggestion ? <Suggestion comment={comment} /> : null}
          </li>
        ))}
      </ul>
      <div className="thread-reply" onKeyDown={(event) => { if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); void send(); } }}>
        <textarea aria-label="Reply" value={reply} rows={2} onInput={(event) => setReply(event.currentTarget.value)} />
        {error ? <span role="alert" className="field-error">{error}</span> : null}
        <div className="thread-actions">
          <Button kind="secondary" busy={busy} onClick={() => void send()}>Send reply</Button>
          <Button kind="secondary" onClick={() => ctx.onResolve(thread)}>{thread.state === 'resolved' ? 'Unresolve thread' : 'Resolve thread'}</Button>
        </div>
      </div>
    </article>
  );
}

function Cell({ children, className }: { children?: ComponentChildren; className?: string }) {
  return <div role="cell" className={className}>{children}</div>;
}

function Row({ row, wide }: { row: RowRef; wide?: boolean }) {
  const ctx = useContext(Ctx);
  const isCursor = ctx.cursorKey === row.key;
  const marker = row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' ';
  const line = commentLine(row);
  return (
    <div
      role="row"
      className={`drow drow-${row.kind} ${isCursor ? 'is-cursor' : ''} ${wide ? 'half' : ''}`}
      tabIndex={isCursor ? 0 : -1}
      aria-label={rowName(row)}
      data-path={row.path}
      data-kind={row.kind}
      data-old-line={row.old ?? ''}
      data-new-line={row.new ?? ''}
      data-side={row.side}
      data-cursor={isCursor ? 'true' : undefined}
      onClick={() => ctx.onRowClick(row)}
    >
      <Cell className="ln">{row.old ?? ''}</Cell>
      <Cell className="ln">{row.new ?? ''}</Cell>
      <Cell className="mark">{marker}</Cell>
      <Cell className="code">
        {row.text === '' ? '​' : row.text}
        {isCursor && ctx.pointerCursor ? (
          <button type="button" className="row-comment" aria-label={`Comment on line ${line}`} onClick={(event) => { event.stopPropagation(); ctx.onComment(row, event.currentTarget); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        ) : null}
      </Cell>
    </div>
  );
}

function ThreadRow({ threads }: { threads: ThreadView[] }) {
  if (!threads.length) return null;
  return (
    <div role="row" className="thread-row">
      <div role="cell">{threads.map((thread) => <Thread key={thread.id} thread={thread} />)}</div>
    </div>
  );
}

export function FileSection({ file, index, threads }: { file: DiffFile; index: number; threads: ThreadView[] }) {
  const ctx = useContext(Ctx);
  const viewed = ctx.view.viewed.includes(file.path);
  const units = unitsOf(file, ctx.mode);
  const placed = new Set<number>();
  const after = (...rows: (RowRef | null)[]) => {
    const found = threads.filter((thread) => !placed.has(thread.id) && rows.some((row) => row && rowAnchorsThread(row, thread)));
    found.forEach((thread) => placed.add(thread.id));
    return <ThreadRow threads={found} />;
  };
  const body = units.map((unit, i) => {
    if (unit.type === 'hunk') {
      return (
        <div role="row" key={`h${i}`} className="drow drow-hunk" data-path={file.path} data-kind="hunk" aria-label={unit.header}>
          <Cell className="hunk-text">{unit.header}</Cell>
        </div>
      );
    }
    if (unit.type === 'row') {
      return (
        <div role="none" key={unit.row.key} className="unit">
          <Row row={unit.row} />
          {after(unit.row)}
        </div>
      );
    }
    return (
      <div role="none" key={`${unit.left?.key ?? ''}${unit.right?.key ?? ''}`} className="unit split">
        <div role="none" className="split-pair">
          {unit.left ? <Row row={unit.left} wide /> : <div className="drow-empty" aria-hidden="true" />}
          {unit.right ? <Row row={unit.right} wide /> : <div className="drow-empty" aria-hidden="true" />}
        </div>
        {after(unit.left, unit.right)}
      </div>
    );
  });
  const loose = threads.filter((thread) => !placed.has(thread.id));
  return (
    <section className="file" id={`file-${encodeURIComponent(file.path)}`} data-viewed={String(viewed)} data-path={file.path} data-index={index}>
      <header className="file-head">
        <span className="file-path mono">{file.path}</span>
        <span className={`file-status status-${file.status}`}>{STATUS_WORD[file.status]}</span>
        <label className="check viewed">
          <input type="checkbox" checked={viewed} onChange={(event) => ctx.onViewed(file.path, event.currentTarget.checked)} />
          <span>Viewed</span>
        </label>
      </header>
      <div role="table" aria-label={`Diff of ${file.path}`} className={`diff diff-${ctx.mode}`}>
        <div role="rowgroup">
          {body}
          {loose.length ? <ThreadRow threads={loose} /> : null}
        </div>
      </div>
    </section>
  );
}
