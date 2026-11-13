import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ATTACHMENT_TYPES, UPLOAD_LIMIT } from '../shared/attachments.ts';
import { LABELS, isWriter, type BoardMember, type Card } from '../shared/types.ts';
import { call } from './api.ts';
import { locate, type BoardData } from './board-state.ts';
import { COPY, displayName } from './copy.ts';
import { Modal } from './overlay.tsx';
import {
  addChecklistItem, attachFile, closeCard, deleteCard, deleteChecklistItem, addNotice, removeAttachment, saveCard, setDraft,
  setPrivateMembers, tickChecklistItem, useStore, type CardDraft,
} from './store.ts';
import { PaperclipIcon } from './icons.tsx';

function ReadOnlyCard({ card, locked }: { card: Card; locked: boolean }): ReactElement {
  return (
    <>
      <h2>{card.title}</h2>
      <p className="muted read-only-note">Read only</p>
      {locked && <p className="field-error locked-copy">{COPY.lockedEdit}</p>}
      <dl className="facts">
        <dt>Labels</dt>
        <dd className="fact-labels">
          {card.labels.length > 0 ? card.labels.map((label) => <span key={label} className="label">{label}</span>) : <span className="muted">No labels</span>}
        </dd>
        <dt>Due date</dt>
        <dd>{card.dueDate ?? <span className="muted">No due date</span>}</dd>
        <dt>Owner</dt>
        <dd>{card.owner?.displayName ?? <span className="muted">No owner</span>}</dd>
      </dl>
      <Checklist card={card} editable={false} />
      <div className="actions"><button type="button" className="outline" data-autofocus onClick={closeCard}>Close</button></div>
    </>
  );
}

function Checklist({ card, editable }: { card: Card; editable: boolean }): ReactElement {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState<string[]>([]);

  const add = async (): Promise<void> => {
    setBusy((b) => [...b, 'new']);
    const fields = await addChecklistItem(card, text);
    setBusy((b) => b.filter((x) => x !== 'new'));
    setProblem(fields?.['text']);
    if (fields === null) setText('');
  };
  const guard = async (id: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy((b) => [...b, id]);
    await work();
    setBusy((b) => b.filter((x) => x !== id));
  };

  return (
    <div role="group" aria-label="Checklist" className={editable ? 'checklist' : 'checklist read-only'}>
      <p className="group-title" aria-hidden="true">Checklist</p>
      <ul>
        {card.checklist.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={item.done} disabled={!editable || busy.includes(item.id)} onChange={() => void guard(item.id, () => tickChecklistItem(card, item.id, !item.done))} />
              <span>{item.text}</span>
            </label>
            {editable && (
              <button type="button" className="ghost small danger-text" aria-label={`Delete ${item.text}`} onClick={() => void guard(item.id, () => deleteChecklistItem(card, item.id))}>
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <div className="add-item">
          <input
            type="text"
            aria-label="New checklist item"
            value={text}
            disabled={busy.includes('new')}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void add();
              }
            }}
          />
          <button type="button" className="outline" onClick={() => void add()}>Add item</button>
          {problem && <p className="field-error">{problem}</p>}
        </div>
      )}
    </div>
  );
}

type Writer = BoardMember & { userId: string };
const isWriterRow = (member: BoardMember): member is Writer => member.userId !== undefined && member.role !== undefined && isWriter(member.role);

function Privacy({ card, members, selfId }: { card: Card; members: Writer[]; selfId: string }): ReactElement {
  const named = (card.privateMembers ?? []).map((m) => m.userId);
  const shared = named.length === 0;
  const [busy, setBusy] = useState(false);
  const apply = async (ids: string[]): Promise<void> => {
    setBusy(true);
    await setPrivateMembers(card, ids);
    setBusy(false);
  };
  const toggle = (userId: string): void => {
    if (shared) void apply([selfId, ...(userId === selfId ? [] : [userId])]);
    else void apply(named.includes(userId) ? named.filter((id) => id !== userId) : [...named, userId]);
  };
  return (
    <div role="group" aria-label="Who can see this card" className="privacy">
      <p className="group-title" aria-hidden="true">Who can see this card</p>
      <label>
        <input type="checkbox" checked={shared} disabled={busy || shared} onChange={() => void apply([])} />
        <span>Everyone on this board</span>
      </label>
      {members.map((member) => (
        <label key={member.userId}>
          <input type="checkbox" checked={named.includes(member.userId)} disabled={busy || (member.userId === selfId && !shared)} onChange={() => toggle(member.userId)} />
          <span>{member.displayName}</span>
        </label>
      ))}
    </div>
  );
}

type Upload = { id: number; filename: string };

function Attachments({ card }: { card: Card }): ReactElement {
  const storageDown = useStore((s) => s.service.storage === 'down');
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const sequence = useRef(0);

  const upload = async (file: File): Promise<void> => {
    const shown = displayName(file.name);
    const entry = { id: ++sequence.current, filename: shown };
    setUploads((u) => [...u, entry]);
    const status = await attachFile(card, file);
    setUploads((u) => u.filter((x) => x.id !== entry.id));
    if (status === null || status === 403 || status === 404) return;
    const message =
      status === 413 ? `${shown} is too large. Files can be up to ${UPLOAD_LIMIT.toLocaleString('en-US')} bytes.`
      : status === 415 ? `${shown} isn't a PDF, JPEG or PNG.`
      : status === 422 ? `${shown} has a name that can't be stored.`
      : `Couldn't attach ${shown}. Attachments are unavailable right now.`;
    setProblems((p) => [...p, message]);
  };

  return (
    <div className="attachments">
      <p className="group-title" aria-hidden="true">Attachments</p>
      <div className="attach-row">
        <button type="button" className="outline" onClick={() => input.current?.click()}>
          <PaperclipIcon />
          Attach a file
        </button>
        <input
          ref={input}
          type="file"
          hidden
          tabIndex={-1}
          accept={ATTACHMENT_TYPES.join(',')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            setProblems([]);
            if (file) void upload(file);
          }}
        />
      </div>
      <ul aria-label="Attachments">
        {(card.attachments ?? []).map((file) => (
          <li key={file.id}>
            <a
              href={`/api/attachments/${file.id}`}
              download
              onClick={(event) => {
                if (storageDown) {
                  event.preventDefault();
                  addNotice(`Couldn't open ${displayName(file.filename)}. Attachments are unavailable right now.`);
                }
              }}
            >
              {displayName(file.filename)}
            </a>
            <button type="button" className="ghost small" aria-label={`Remove ${displayName(file.filename)}`} onClick={() => void removeAttachment(card, file.id)}>
              Remove
            </button>
          </li>
        ))}
        {uploads.map((row) => (
          <li key={`up-${row.id}`} className="uploading">
            <span>Uploading {row.filename}…</span>
            <span className="progress-bar" aria-hidden="true" />
          </li>
        ))}
      </ul>
      {problems.map((message) => (
        <p key={message} className="field-error">{message}</p>
      ))}
    </div>
  );
}

function DeleteConfirm({ card, onClose }: { card: Card; onClose: () => void }): ReactElement {
  const [pending, setPending] = useState(false);
  return (
    <Modal label="Delete this card?" role="alertdialog" onClose={onClose}>
      <h2>Delete this card?</h2>
      <p>{card.title} and its attachments will be removed for everyone.</p>
      <div className="actions">
        <button
          type="button"
          className="danger"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void deleteCard(card).then((deleted) => {
              if (!deleted) onClose();
            });
          }}
        >
          {pending ? 'Deleting…' : 'Delete'}
        </button>
        <button type="button" className="outline" data-autofocus onClick={onClose}>Keep card</button>
      </div>
    </Modal>
  );
}

function EditableCard({ card, board, selfId }: { card: Card; board: BoardData; selfId: string }): ReactElement {
  const draft: CardDraft = useStore((s) => s.drafts[card.id]) ?? {};
  const [members, setMembers] = useState<Writer[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void call<{ members: BoardMember[] }>(`/api/boards/${board.id}/members`)
      .then((reply) => setMembers(reply.members.filter(isWriterRow)))
      .catch(() => undefined);
  }, [board.id]);

  const title = draft.title ?? card.title;
  const notes = draft.notes ?? card.notes ?? '';
  const due = draft.dueDate ?? card.dueDate ?? '';
  const labels = draft.labels ?? card.labels;
  const owner = draft.ownerUserId !== undefined ? (draft.ownerUserId ?? '') : (card.owner?.userId ?? '');

  const save = async (): Promise<void> => {
    if (Object.keys(draft).length === 0) return;
    setSaving(true);
    const outcome = await saveCard(card, draft.dueDate === '' ? { ...draft, dueDate: null } : draft);
    setErrors(outcome.fields);
    setSaving(false);
  };

  return (
    <>
      <h2>{card.title}</h2>
      <label className="field">
        <span>Title</span>
        <input type="text" aria-label="Title" data-autofocus value={title} onChange={(e) => setDraft(card.id, { title: e.target.value })} />
        {errors['title'] && <span className="field-error">{errors['title']}</span>}
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea aria-label="Notes" rows={4} value={notes} onChange={(e) => setDraft(card.id, { notes: e.target.value })} />
        {errors['notes'] && <span className="field-error">{errors['notes']}</span>}
      </label>
      <div className="two">
        <label className="field">
          <span>Due date</span>
          <input type="text" aria-label="Due date" inputMode="numeric" placeholder="YYYY-MM-DD" autoComplete="off" value={due} onChange={(e) => setDraft(card.id, { dueDate: e.target.value })} />
          {errors['dueDate'] && <span className="field-error">{errors['dueDate']}</span>}
        </label>
        <label className="field">
          <span>Owner</span>
          <select aria-label="Owner" value={owner} onChange={(e) => setDraft(card.id, { ownerUserId: e.target.value === '' ? null : e.target.value })}>
            <option value="">No owner</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.displayName}</option>
            ))}
          </select>
          {errors['ownerUserId'] && <span className="field-error">{errors['ownerUserId']}</span>}
        </label>
      </div>
      <div role="group" aria-label="Labels" className="labels-group">
        <p className="group-title" aria-hidden="true">Labels</p>
        {LABELS.map((label) => (
          <label key={label}>
            <input type="checkbox" checked={labels.includes(label)} onChange={(e) => setDraft(card.id, { labels: LABELS.filter((l) => (l === label ? e.target.checked : labels.includes(l))) })} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <Checklist card={card} editable />
      <Privacy card={card} members={members} selfId={selfId} />
      <Attachments card={card} />
      <div className="actions">
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
        <button type="button" className="outline" onClick={closeCard}>Close</button>
        {board.role === 'admin' && <button type="button" className="danger-outline" onClick={() => setConfirming(true)}>Delete card</button>}
      </div>
      {confirming && <DeleteConfirm card={card} onClose={() => setConfirming(false)} />}
    </>
  );
}

export function CardDialog({ cardId }: { cardId: string }): ReactElement | null {
  const board = useStore((s) => s.board);
  const standalone = useStore((s) => s.cardRoute?.card ?? null);
  const locked = useStore((s) => s.locked[cardId] === true);
  const selfId = useStore((s) => s.me?.userId);
  const card = (board ? locate(board, cardId)?.card : undefined) ?? standalone;
  useEffect(() => {
    if (!card) closeCard();
  }, [card]);
  if (!card || !board || !selfId) return null;
  const editable = isWriter(board.role) && !locked;
  return (
    <Modal label={card.title} className="card-dialog" onClose={closeCard} fallbackFocus={`[data-card-button="${cardId}"]`}>
      {editable ? <EditableCard card={card} board={board} selfId={selfId} /> : <ReadOnlyCard card={card} locked={locked} />}
    </Modal>
  );
}

