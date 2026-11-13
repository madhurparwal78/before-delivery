import type { RefObject } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { copy } from '../../shared/copy';
import { SNIPPETS } from '../../shared/rules';
import { Icon } from './ui';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface SlashState {
  open: boolean;
  dismissed: boolean;
  filter: string;
  active: number;
  top: number;
}

const CLOSED: SlashState = { open: false, dismissed: false, filter: '', active: 0, top: 0 };

interface SourceProps {
  textarea: RefObject<HTMLTextAreaElement>;
  title: string;
  text: string;
  readOnly: boolean;
  canEdit: boolean;
  isReference: boolean;
  errorLine: number | null;
  status: SaveStatus;
  imageBusy: boolean;
  imageError: string | null;
  /** Where the caret should go after the next change of `text` (a snippet was inserted). */
  pendingCaret: { current: number | null };
  onTitle: (title: string) => void;
  onText: (text: string) => void;
  onImage: (file: File) => void;
}

export function SourcePane(props: SourceProps) {
  const { textarea, text } = props;
  const [slash, setSlash] = useState<SlashState>(CLOSED);
  const fileInput = useRef<HTMLInputElement>(null);
  const lines = text.split('\n').length;
  const matches = SNIPPETS.filter((snippet) => snippet.name.toLowerCase().includes(slash.filter.toLowerCase()));

  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
    if (props.pendingCaret.current !== null) {
      element.setSelectionRange(props.pendingCaret.current, props.pendingCaret.current);
      props.pendingCaret.current = null;
    }
  }, [text]);

  const lineGeometry = (element: HTMLTextAreaElement, caret: number): { start: number; end: number; top: number } => {
    const start = element.value.lastIndexOf('\n', caret - 1) + 1;
    const next = element.value.indexOf('\n', caret);
    const row = element.value.slice(0, start).split('\n').length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    return { start, end: next === -1 ? element.value.length : next, top: (row + 1) * lineHeight + 12 };
  };

  const onInput = (event: Event & { inputType?: string }): void => {
    const element = event.currentTarget as HTMLTextAreaElement;
    props.onText(element.value);
    const caret = element.selectionStart;
    const { start, end, top } = lineGeometry(element, caret);
    const line = element.value.slice(start, end);
    const typed = element.value.slice(start, caret);
    if (/^\/[A-Za-z]*$/.test(line) && typed === line) {
      if (slash.open) {
        setSlash({ ...slash, filter: line.slice(1), active: 0, top });
      } else if (!slash.dismissed && line === '/') {
        setSlash({ open: true, dismissed: false, filter: '', active: 0, top });
      }
    } else {
      setSlash(CLOSED);
    }
  };

  const insert = (index: number): void => {
    const element = textarea.current as HTMLTextAreaElement;
    const snippet = matches[index];
    if (snippet === undefined) {
      return;
    }
    const { start } = lineGeometry(element, element.selectionStart);
    props.pendingCaret.current = start + snippet.caret;
    props.onText(element.value.slice(0, start) + snippet.text + element.value.slice(element.selectionStart));
    setSlash(CLOSED);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!slash.open) {
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length > 0) {
        setSlash({ ...slash, active: (slash.active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length });
      }
    } else if (event.key === 'Enter' && matches.length > 0) {
      event.preventDefault();
      insert(slash.active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setSlash({ ...CLOSED, dismissed: true });
    }
  };

  const status = props.status === 'saving' ? copy.saving : props.status === 'saved' ? copy.saved : props.status === 'failed' ? copy.saveFailed : '';

  return (
    <div class="editor-pane">
      <input
        class="title-input"
        type="text"
        aria-label="Title"
        value={props.title}
        readOnly={!props.canEdit}
        onInput={(event) => props.onTitle(event.currentTarget.value)}
      />
      <div class="editor-toolbar">
        {props.canEdit && !props.isReference && (
          <>
            <button type="button" class="button" aria-busy={props.imageBusy ? 'true' : undefined} onClick={() => fileInput.current?.click()}>
              <Icon name="image" />
              Image
            </button>
            <input
              ref={fileInput}
              type="file"
              class="sr-only"
              tabIndex={-1}
              accept="image/png,image/jpeg,image/webp"
              aria-label="Upload image"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) {
                  props.onImage(file);
                }
              }}
            />
          </>
        )}
        {props.imageError && <p class="form-error">{props.imageError}</p>}
        <span class={`save-status ${props.status}`}>{status}</span>
      </div>
      {props.isReference && <p class="reference-note">This page is generated from the OpenAPI file. Import the file again to change it.</p>}
      <div class="source-frame">
        <div class="gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, index) => (
            <span key={index} data-line={index + 1} data-error={props.errorLine === index + 1 ? 'true' : undefined}>
              {index + 1}
            </span>
          ))}
        </div>
        <textarea
          id="editor"
          ref={textarea}
          aria-label="Page source"
          spellcheck={false}
          wrap="off"
          value={text}
          readOnly={props.readOnly}
          aria-controls={slash.open ? 'slash-menu' : undefined}
          aria-activedescendant={slash.open && matches.length > 0 ? `slash-option-${slash.active}` : undefined}
          onInput={onInput}
          onKeyDown={onKeyDown}
        />
        {slash.open && (
          <ul id="slash-menu" class="slash-menu" role="listbox" aria-label="Insert component" style={`top:${slash.top}px;left:4rem`}>
            {matches.length === 0 ? (
              <li class="slash-empty" role="presentation">
                {copy.noComponentsMatch}
              </li>
            ) : (
              matches.map((snippet, index) => (
                <li key={snippet.name} id={`slash-option-${index}`} role="option" aria-selected={index === slash.active} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(index)}>
                  {snippet.name}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
