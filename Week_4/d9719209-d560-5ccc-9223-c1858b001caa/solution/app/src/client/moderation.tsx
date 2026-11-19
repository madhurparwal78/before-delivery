import { useRef, useState, type FormEvent } from 'react';
import type { CommunityView, PostView } from '../shared/types.js';
import { ApiError, api } from './api.js';
import { announce } from './announce.js';
import { Button, Field, Modal, RadioGroup, useFocusFirstInvalid } from './ui.js';

/** What a refused moderator action reports as the post's current state. */
export interface PostCurrent { version: number; state: PostView['state']; locked: boolean; lockedUntil: string | null; pinned: boolean }

/** Turns a lost moderator race into the alert and hands the winner's state to the page. */
export function raceLost(error: unknown, apply: (current: PostCurrent) => void): boolean {
  if (!(error instanceof ApiError) || (error.code !== 'CONFLICT' && error.code !== 'SLOT_TAKEN')) return false;
  announce('Another moderator acted first', true);
  if (error.current && 'version' in error.current) apply(error.current as unknown as PostCurrent);
  return true;
}

interface RemoveDialogProps {
  kind: 'post' | 'comment';
  targetId: string;
  /** The post's version, for post removals. */
  version?: number;
  community: CommunityView;
  onClose: () => void;
  /** Called once the removal succeeded (the dialog has already announced it). */
  onDone: () => void;
  /** Called with the winner's state when another moderator acted first. */
  onConflict?: (current: PostCurrent) => void;
}

const SPAM = 'spam';
const OTHER = 'other';

export function RemoveDialog({ kind, targetId, version, community, onClose, onDone, onConflict }: RemoveDialogProps): React.JSX.Element {
  const [reason, setReason] = useState<string | null>(null);
  const [publicNote, setPublicNote] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);

  const options = [
    ...community.rules.map((rule) => ({ value: `rule:${rule.id}`, label: rule.title })),
    { value: SPAM, label: 'Spam' },
    { value: OTHER, label: 'Other' },
  ];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (reason === null) next.reason = 'Choose a reason';
    else if (reason === OTHER && publicNote.trim() === '') next.publicNote = 'Add a public note for Other';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      setTries((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    const body = {
      ...(kind === 'post' ? { version } : {}),
      reason: reason?.startsWith('rule:') ? 'rule' : reason,
      ...(reason?.startsWith('rule:') ? { ruleId: reason.slice(5) } : {}),
      ...(publicNote.trim() !== '' ? { publicNote: publicNote.trim() } : {}),
      ...(privateNote.trim() !== '' ? { privateNote: privateNote.trim() } : {}),
    };
    try {
      await api('POST', `/api/${kind === 'post' ? 'posts' : 'comments'}/${targetId}/removal`, body);
      announce(kind === 'post' ? 'Post removed' : 'Comment removed');
      onDone();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setErrors(error.fields);
        setTries((n) => n + 1);
      } else if (onConflict && raceLost(error, onConflict)) {
        onClose();
      } else {
        announce("The removal didn't go through", true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={kind === 'post' ? 'Remove post' : 'Remove comment'} onClose={onClose}>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <RadioGroup label="Reason" name="reason" options={options} value={reason} onChange={setReason} error={errors.reason} />
        <Field label="Public note" error={errors.publicNote}>
          {(props) => <textarea {...props} rows={2} value={publicNote} onChange={(e) => setPublicNote(e.target.value)} />}
        </Field>
        <Field label="Private note (moderators only)" error={errors.privateNote}>
          {(props) => <textarea {...props} rows={2} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="danger" busy={busy}>Remove</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

const DURATIONS = [
  { value: 'indefinite', label: 'Until unlocked' },
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

export function LockDialog({ post, onClose, onDone, onConflict }: {
  post: PostView; onClose: () => void; onDone: (post: PostView) => void; onConflict: (current: PostCurrent) => void;
}): React.JSX.Element {
  const [duration, setDuration] = useState('indefinite');
  const [busy, setBusy] = useState(false);
  const lock = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await api<PostView>('POST', `/api/posts/${post.id}/lock`, { version: post.version, duration });
      announce('Thread locked');
      onDone(updated);
      onClose();
    } catch (error) {
      if (raceLost(error, onConflict)) onClose();
      else announce("The lock didn't go through", true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Lock thread" onClose={onClose}>
      <form onSubmit={(e) => void lock(e)}>
        <RadioGroup label="Duration" name="duration" options={DURATIONS} value={duration} onChange={setDuration} />
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy}>Lock</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function ReplacePinDialog({ post, pinned, onClose, onDone, onConflict }: {
  post: PostView; pinned: Array<{ id: string; title: string }>; onClose: () => void;
  onDone: (post: PostView) => void; onConflict: (current: PostCurrent) => void;
}): React.JSX.Element {
  const [replace, setReplace] = useState<string | null>(pinned[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await api<PostView>('POST', `/api/posts/${post.id}/pin`, { version: post.version, replacePostId: replace });
      announce('Post pinned');
      onDone(updated);
      onClose();
    } catch (error) {
      if (raceLost(error, onConflict)) onClose();
      else announce("The pin didn't go through", true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Replace a pin" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <RadioGroup label="Pinned post to replace" name="replace" options={pinned.map((p) => ({ value: p.id, label: p.title }))} value={replace} onChange={setReplace} />
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={busy}>Replace pin</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
