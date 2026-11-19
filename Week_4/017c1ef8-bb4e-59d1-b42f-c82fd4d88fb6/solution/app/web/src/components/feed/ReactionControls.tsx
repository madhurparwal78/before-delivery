import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Post, ReactionSummary, ReactionType } from '../../types';
import { LinkButton, moveRovingFocus } from '../../ui';
import { REACTION_TYPES, applyReaction, reactionName, toggleReact } from './reactions';
import './feed.css';

interface ReactionControlsProps {
  post: Post;
  onChange: (reactions: ReactionSummary) => void;
  onFailure: () => void;
}

/** React (Like or remove), Choose reaction and its toolbar of the five types. */
export function ReactionControls({ post, onChange, onFailure }: ReactionControlsProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const chooser = useRef<HTMLButtonElement>(null);
  const reactButton = useRef<HTMLButtonElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const restoreReact = useRef(false);

  useLayoutEffect(() => {
    if (!open) return;
    const buttons = [...(toolbar.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    (buttons.find((button) => button.getAttribute('aria-pressed') === 'true') ?? buttons[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!busy && restoreReact.current) {
      restoreReact.current = false;
      reactButton.current?.focus();
    }
  }, [busy]);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      chooser.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const run = async (action: () => Promise<ReactionSummary>): Promise<void> => {
    restoreReact.current = document.activeElement === reactButton.current;
    setBusy(true);
    try {
      onChange(await action());
    } catch {
      onFailure();
    } finally {
      setBusy(false);
    }
  };

  const choose = (type: ReactionType): void => {
    returnFocus.current = true;
    setOpen(false);
    void run(() => applyReaction(post, type));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      returnFocus.current = true;
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else {
      moveRovingFocus(event, [...(toolbar.current?.querySelectorAll<HTMLElement>('button') ?? [])], { orientation: 'horizontal', wrap: true, homeEnd: true });
    }
  };

  return (
    <div ref={root} className="reaction-controls">
      <LinkButton ref={reactButton} className="entry-action" aria-pressed={post.reactions.mine !== null} disabled={busy} onClick={() => void run(() => toggleReact(post))}>
        React
      </LinkButton>
      <LinkButton ref={chooser} className="entry-action" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Choose reaction
      </LinkButton>
      {open ? (
        <div ref={toolbar} role="toolbar" aria-label="Reactions" className="reaction-toolbar" onKeyDown={onKeyDown}>
          {REACTION_TYPES.map((type) => (
            <LinkButton key={type} className="entry-action" aria-pressed={post.reactions.mine === type} tabIndex={-1} onClick={() => choose(type)}>
              {reactionName(type)}
            </LinkButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}
