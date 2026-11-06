// An editable block: renders its stored body, reports typing as ops, keeps the caret through
// re-renders, and leaves Enter, Backspace on empty, undo and the picker trigger to the page.
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { normaliseOps, type Op } from '../../shared/ot.ts';
import { renderBody, sanitizeBody } from '../../shared/richtext.ts';
import { editTextOf, selectionOffsets, setSelection } from './dom.ts';

/** Ops for a change typed at the caret: the changed region ends where the caret now is. */
export function typedOps(before: string, after: string, caret: number): Op[] {
  if (before === after) return [];
  const suffixMax = Math.max(0, Math.min(after.length - caret, before.length, after.length));
  let suffix = 0;
  while (suffix < suffixMax && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix += 1;
  const prefixMax = Math.min(before.length, after.length) - suffix;
  let prefix = 0;
  while (prefix < prefixMax && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  return normaliseOps([
    { retain: prefix }, { delete: before.length - prefix - suffix }, { insert: after.slice(prefix, after.length - suffix) }, { retain: suffix },
  ]);
}

/** The markup shown for a stored body; a trailing line break gets a filler so the empty line can hold the caret. */
export function displayHtml(body: string): string {
  const html = renderBody(body);
  return /<br><\/(p|li|blockquote)>$/.test(html) ? html.replace(/<\/(p|li|blockquote)>$/, '<br data-filler=""></$1>') : html;
}

export interface TextBlockHandle {
  element: HTMLDivElement | null;
  /** Shows `body`, keeping (or moving) the caret when the block has focus. */
  show: (body: string, caret?: { anchor: number; head: number } | null) => void;
  focusAt: (offset: number | 'end') => void;
  selection: () => { anchor: number; head: number } | null;
}

interface Props {
  label: string;
  body: string;
  /** typing: ops against the text before, with the caret before and after */
  onTyped: (ops: Op[], before: string, caretBefore: number, caretAfter: number) => string;
  onEnter: () => void;
  /** a paste, filtered to the allowlist: the whole block's new body */
  onPasted: (body: string) => void;
  onBackspaceEmpty: () => void;
  onFocus: () => void;
  onBlur: () => void;
  readOnly?: boolean;
}

export const TextBlock = forwardRef<TextBlockHandle, Props>(function TextBlock({ label, body, onTyped, onEnter, onPasted, onBackspaceEmpty, onFocus, onBlur, readOnly }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const text = useRef('');
  const caretBefore = useRef(0);
  const composing = useRef(false);
  const shownBody = useRef<string | null>(null);
  const pasting = useRef(false);

  const show = (next: string, caret?: { anchor: number; head: number } | null) => {
    const node = el.current;
    if (!node) return;
    const focused = document.activeElement === node;
    const keep = caret ?? (focused ? selectionOffsets(node) : null);
    const html = displayHtml(next);
    if (node.innerHTML !== html) node.innerHTML = html;
    shownBody.current = next;
    text.current = editTextOf(node);
    node.dataset.empty = text.current === '' ? 'true' : 'false';
    if (focused && keep) {
      const max = text.current.length;
      setSelection(node, Math.min(keep.anchor, max), Math.min(keep.head, max));
    }
  };

  useImperativeHandle(ref, () => ({
    get element() {
      return el.current;
    },
    show,
    focusAt: (offset) => {
      const node = el.current;
      if (!node) return;
      node.focus();
      const at = offset === 'end' ? text.current.length : Math.min(offset, text.current.length);
      setSelection(node, at);
    },
    selection: () => (el.current ? selectionOffsets(el.current) : null),
  }));

  useLayoutEffect(() => {
    if (shownBody.current !== body) show(body);
    // Only a new body from the page re-renders the block; typing keeps the DOM the browser made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const afterTyping = () => {
    const node = el.current;
    if (!node || composing.current || pasting.current) return;
    const now = editTextOf(node);
    const caret = selectionOffsets(node)?.head ?? now.length;
    const before = text.current;
    if (now === before) return;
    const ops = typedOps(before, now, caret);
    text.current = now;
    const stored = onTyped(ops, before, caretBefore.current, caret);
    shownBody.current = stored;
    // Keep the DOM in the canonical form of the stored body (browsers add their own wrappers).
    if (node.innerHTML !== displayHtml(stored)) show(stored, { anchor: caret, head: caret });
    node.dataset.empty = now === '' ? 'true' : 'false';
    caretBefore.current = caret;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const node = el.current;
    if (!node) return;
    caretBefore.current = selectionOffsets(node)?.head ?? 0;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onEnter();
    } else if (e.key === 'Backspace' && text.current === '') {
      e.preventDefault();
      onBackspaceEmpty();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const node = el.current;
    if (!node) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    // The paste keeps only the allowlisted marks before it reaches the block; the server filters it again.
    const filtered = renderBody(sanitizeBody(html || plain)).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
    pasting.current = true;
    document.execCommand('insertHTML', false, filtered);
    pasting.current = false;
    const next = sanitizeBody(node.innerHTML.replace(/ rel="[^"]*"/g, ''));
    const caret = selectionOffsets(node);
    text.current = editTextOf(node);
    shownBody.current = next;
    onPasted(next);
    show(next, caret);
  };

  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const native = e.nativeEvent as InputEvent;
    if (native.inputType === 'historyUndo' || native.inputType === 'historyRedo' || native.inputType === 'insertParagraph') e.preventDefault();
    if (native.inputType === 'insertLineBreak' || native.inputType === 'insertFromPaste' || native.inputType === 'insertFromDrop') {
      const node = el.current;
      if (node) caretBefore.current = selectionOffsets(node)?.head ?? 0;
    }
  };

  return (
    <div
      ref={el}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      contentEditable={readOnly ? false : true}
      suppressContentEditableWarning
      spellCheck
      className="block-text"
      data-placeholder="Write a line…"
      onKeyDown={onKeyDown}
      onBeforeInput={onBeforeInput}
      onInput={afterTyping}
      onPaste={onPaste}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; afterTyping(); }}
      onFocus={onFocus}
      onBlur={onBlur}
      onSelect={() => {
        const node = el.current;
        if (node) caretBefore.current = selectionOffsets(node)?.head ?? caretBefore.current;
      }}
    />
  );
});
