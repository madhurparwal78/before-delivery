import { useEffect, useRef, useState } from 'react';
import { DISCARD_PROMPT, STORAGE_DOWN_CHECKOUT } from '../../shared/copy';
import type { Item, Loan, MemberSummary } from '../../shared/types';
import { Dialog } from './Dialog';
import { FormProblems, problemsFrom, problemsOf, type Problems } from './FormProblems';
import { PhotoPicker, type PickedPhoto } from './PhotoPicker';
import { api, ApiFailed } from '../lib/api';

interface NewLoanDialogProps {
  readonly members: readonly MemberSummary[];
  readonly items: readonly Item[];
  readonly isCoordinator: boolean;
  readonly startingTag: string | null;
  readonly onClose: () => void;
  readonly onCheckedOut: (loan: Loan) => void;
  readonly onReservedOnly: (loan: Loan, picked: PickedPhoto | null) => void;
  readonly announce: (text: string) => void;
  readonly onSessionEnded: (text: string) => void;
}

export function NewLoanDialog({
  members,
  items,
  isCoordinator,
  startingTag,
  onClose,
  onCheckedOut,
  onReservedOnly,
  announce,
  onSessionEnded,
}: NewLoanDialogProps): JSX.Element {
  const [memberText, setMemberText] = useState('');
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tagText, setTagText] = useState('');
  const [tagMessage, setTagMessage] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(() => (startingTag ? [startingTag] : []));
  const [checkedOutAt, setCheckedOutAt] = useState('');
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [phase, setPhase] = useState<'idle' | 'reserving' | 'checking-out'>('idle');
  const [discardOpen, setDiscardOpen] = useState(false);

  const memberBox = useRef<HTMLInputElement>(null);
  const tagBox = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);

  const filtered =
    memberText.trim() === ''
      ? members
      : members.filter(
          (candidate) =>
            candidate.name.toLowerCase().includes(memberText.trim().toLowerCase()) ||
            candidate.email.toLowerCase().includes(memberText.trim().toLowerCase()),
        );

  useEffect(() => {
    memberBox.current?.focus();
  }, []);

  const hasEntries = member !== null || tags.length > 0 || picked !== null;

  function requestClose(): void {
    if (hasEntries) {
      lastFocused.current = document.activeElement as HTMLElement | null;
      setDiscardOpen(true);
      return;
    }
    onClose();
  }

  function addTag(): void {
    const typed = tagText.trim().toUpperCase();
    if (typed === '') return;
    const found = items.find((item) => item.tag.toUpperCase() === typed);
    if (!found) {
      setTagMessage(`No tool has tag ${typed}.`);
      return;
    }
    if (tags.some((tag) => tag.toUpperCase() === typed)) {
      setTagMessage(`${typed} is already on this loan.`);
      return;
    }
    setTags([...tags, found.tag]);
    setTagText('');
    setTagMessage(null);
  }

  async function checkOut(): Promise<void> {
    if (inFlight.current) return;
    const missing: { field: string; message: string }[] = [];
    if (member === null) missing.push({ field: 'member_id', message: 'Choose a member.' });
    if (tags.length === 0) missing.push({ field: 'item_ids', message: 'Add at least one tool.' });
    if (picked === null) missing.push({ field: 'photo', message: 'Take or choose a photo.' });
    if (missing.length > 0) {
      setProblems(problemsOf(missing));
      window.setTimeout(() => summary.current?.focus(), 0);
      return;
    }
    const itemIds = tags
      .map((tag) => items.find((item) => item.tag.toUpperCase() === tag.toUpperCase())?.id)
      .filter((id): id is number => id !== undefined);

    inFlight.current = true;
    setPhase('reserving');
    let reserved: Loan;
    try {
      const body: Record<string, unknown> = { member_id: member?.id, item_ids: itemIds };
      if (isCoordinator && checkedOutAt.trim() !== '') body.checked_out_at = checkedOutAt.trim();
      const result = await api.post<{ loan: Loan }>('/api/loans', body);
      reserved = result.loan;
      setProblems(null);
    } catch (error) {
      inFlight.current = false;
      setPhase('idle');
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        onSessionEnded(error.error);
        return;
      }
      if (error.status === 422) {
        setProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
        return;
      }
      announce(error.error);
      window.setTimeout(() => memberBox.current?.focus(), 0);
      return;
    }

    setPhase('checking-out');
    try {
      const form = new FormData();
      form.append('photo', (picked as PickedPhoto).file);
      form.append('captured_at', (picked as PickedPhoto).capturedAt);
      const result = await api.post<{ loan: Loan }>(`/api/loans/${reserved.id}/checkout`, form);
      onCheckedOut(result.loan);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        onSessionEnded(error.error);
        return;
      }
      announce(error.status === 503 ? STORAGE_DOWN_CHECKOUT : error.error);
      onReservedOnly(reserved, picked);
    } finally {
      inFlight.current = false;
      setPhase('idle');
    }
  }

  const pendingLabel =
    phase === 'reserving' ? 'Reserving...' : phase === 'checking-out' ? 'Checking out...' : null;

  return (
    <>
      <Dialog
        label="New loan"
        onEscape={requestClose}
        inert={discardOpen}
        className="new-loan-dialog"
      >
        <h2>New loan</h2>
        {discardOpen ? null : (
          <FormProblems problems={problems} ref={summary} onJump={() => undefined} />
        )}
        <div className="combo-wrap">
          <label>
            Member
            <input
              ref={memberBox}
              aria-label="Member"
              role="combobox"
              aria-expanded={listOpen && filtered.length > 0}
              aria-controls="members-listbox"
              aria-autocomplete="list"
              aria-activedescendant={
                listOpen && filtered.length > 0 ? `member-option-${activeIndex}` : undefined
              }
              value={memberText}
              onFocus={() => setListOpen(true)}
              onChange={(event) => {
                setMemberText(event.target.value);
                setMember(null);
                setListOpen(true);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  if (!listOpen) {
                    setListOpen(true);
                    setActiveIndex(0);
                  } else if (filtered.length > 0) {
                    setActiveIndex((activeIndex + 1) % filtered.length);
                  }
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  if (filtered.length > 0) {
                    setActiveIndex((activeIndex - 1 + filtered.length) % filtered.length);
                  }
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const chosen = filtered[activeIndex];
                  if (listOpen && chosen) pickMember(chosen);
                  return;
                }
                if (event.key === 'Escape' && listOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  setListOpen(false);
                }
              }}
            />
          </label>
          {listOpen && filtered.length > 0 ? (
            <ul role="listbox" id="members-listbox" aria-label="Members" className="members-list">
              {filtered.map((candidate, index) => (
                <li
                  key={candidate.id}
                  id={`member-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={index === activeIndex ? 'option-active' : ''}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pickMember(candidate);
                  }}
                >
                  {candidate.name} ({candidate.email})
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <label>
          Add tool by tag
          <input
            ref={tagBox}
            aria-label="Add tool by tag"
            value={tagText}
            onChange={(event) => {
              setTagText(event.target.value);
              setTagMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
          />
        </label>
        {tagMessage ? <p className="field-message">{tagMessage}</p> : null}

        <ul aria-label="Tools on this loan" className="loan-tools">
          {tags.map((tag) => (
            <li key={tag}>
              <span className="numerals">{tag}</span>
              <button type="button" onClick={() => setTags(tags.filter((other) => other !== tag))}>
                Remove {tag}
              </button>
            </li>
          ))}
        </ul>

        {isCoordinator ? (
          <label>
            Checked out at
            <input
              aria-label="Checked out at"
              value={checkedOutAt}
              onChange={(event) => setCheckedOutAt(event.target.value)}
            />
          </label>
        ) : null}

        <PhotoPicker inputId="new-loan-photo" picked={picked} onPick={setPicked} />

        <button
          type="button"
          aria-busy={pendingLabel !== null}
          aria-disabled={pendingLabel !== null}
          onClick={() => void checkOut()}
        >
          {pendingLabel ?? 'Check out'}
        </button>
        <button type="button" onClick={requestClose}>
          Discard
        </button>
      </Dialog>

      {discardOpen ? (
        <Dialog
          label="Discard this loan?"
          role="alertdialog"
          onEscape={() => {
            setDiscardOpen(false);
            window.setTimeout(() => lastFocused.current?.focus(), 0);
          }}
        >
          <p>{DISCARD_PROMPT}</p>
          <button
            type="button"
            onClick={() => {
              setDiscardOpen(false);
              window.setTimeout(() => lastFocused.current?.focus(), 0);
            }}
          >
            Keep editing
          </button>
          <button type="button" onClick={onClose}>
            Discard loan
          </button>
        </Dialog>
      ) : null}
    </>
  );

  function pickMember(candidate: MemberSummary): void {
    setMember(candidate);
    setMemberText(candidate.name);
    setListOpen(false);
    window.setTimeout(() => tagBox.current?.focus(), 0);
  }
}
