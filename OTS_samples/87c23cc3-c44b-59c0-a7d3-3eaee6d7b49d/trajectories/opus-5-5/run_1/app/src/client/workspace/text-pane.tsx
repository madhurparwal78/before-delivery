import type { JSX, Ref } from "preact";
import { useImperativeHandle, useRef, useState } from "preact/hooks";
import type { LangError } from "../../shared/mortise.js";
import { copy } from "../copy.js";
import { prefersReducedMotion } from "../ui.js";
import { TYPE_MS } from "./motion.js";

export interface TextPaneHandle {
  getText(): string;
  setText(text: string): void;
  typeIn(from: string, to: string): Promise<void>;
  focusAt(line: number, column: number): void;
  isTyping(): boolean;
  textarea(): HTMLTextAreaElement | null;
}

interface TextPaneProps {
  label: string;
  initialText: string;
  readOnly: boolean;
  errors: LangError[];
  onInput: (text: string) => void;
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  onPointerDownCapture?: () => void;
  handle: Ref<TextPaneHandle>;
  id?: string;
}

function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length - 1, column: before[before.length - 1]!.length };
}

function offsetOf(text: string, line: number, column: number): number {
  const lines = text.split("\n");
  const l = Math.min(line, lines.length - 1);
  let offset = 0;
  for (let i = 0; i < l; i++) offset += lines[i]!.length + 1;
  return offset + Math.min(column, lines[l]!.length);
}

const countLines = (text: string) => text.split("\n").length;

/** The schema text editor: a plain textarea with a line-number gutter and error markers. */
export function TextPane(props: TextPaneProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const released = useRef(false);
  const typing = useRef(false);
  const [lines, setLines] = useState(() => countLines(props.initialText));
  const [typingNow, setTypingNow] = useState(false);

  const setValue = (text: string, selection?: [number, number]) => {
    const node = area.current!;
    node.value = text;
    if (selection) node.setSelectionRange(selection[0], selection[1]);
    setLines(countLines(text));
  };

  useImperativeHandle(props.handle, () => ({
    getText: () => area.current?.value ?? props.initialText,
    setText(text: string) {
      const node = area.current!;
      if (node.value === text) return;
      const old = node.value;
      const start = lineColumn(old, node.selectionStart);
      const end = lineColumn(old, node.selectionEnd);
      const focused = document.activeElement === node;
      setValue(text);
      if (focused) node.setSelectionRange(offsetOf(text, start.line, start.column), offsetOf(text, end.line, end.column));
    },
    async typeIn(from: string, to: string) {
      let p = 0;
      while (p < from.length && from[p] === to[p]) p++;
      const inserted = to.slice(p, p + to.length - from.length);
      const settle = inserted.endsWith("\n") ? p + inserted.length - (inserted.endsWith("\r\n") ? 2 : 1) : p + inserted.length;
      const valid = to.length > from.length && from.slice(p) === to.slice(p + inserted.length);
      if (!valid || prefersReducedMotion()) {
        setValue(to, [settle, settle]);
        return;
      }
      typing.current = true;
      setTypingNow(true);
      const chars = Array.from(inserted);
      let typed = "";
      for (const ch of chars) {
        typed += ch;
        setValue(from.slice(0, p) + typed + from.slice(p), [p + typed.length, p + typed.length]);
        await new Promise((r) => setTimeout(r, TYPE_MS));
      }
      setValue(to, [settle, settle]);
      typing.current = false;
      setTypingNow(false);
    },
    focusAt(line: number, column: number) {
      const node = area.current!;
      const offset = offsetOf(node.value, line - 1, column - 1);
      node.focus();
      node.setSelectionRange(offset, offset);
    },
    isTyping: () => typing.current,
    textarea: () => area.current,
  }));

  const emit = () => {
    const node = area.current!;
    setLines(countLines(node.value));
    props.onInput(node.value);
  };

  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    props.onKeyDownCapture?.(event as unknown as KeyboardEvent);
    const node = event.currentTarget;
    if (event.key === "Escape") {
      released.current = true;
      return;
    }
    if (event.key !== "Tab") {
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) released.current = false;
      return;
    }
    if (released.current || node.readOnly) {
      released.current = false;
      return;
    }
    event.preventDefault();
    const text = node.value;
    const start = node.selectionStart;
    const end = node.selectionEnd;
    if (!event.shiftKey) {
      node.setRangeText("  ", start, end, "end");
      emit();
      return;
    }
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const block = text.slice(lineStart, end);
    let removedFirst = 0;
    let removedTotal = 0;
    const outdented = block
      .split("\n")
      .map((line, index) => {
        const strip = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;
        if (index === 0) removedFirst = strip;
        removedTotal += strip;
        return line.slice(strip);
      })
      .join("\n");
    if (removedTotal === 0) return;
    node.setRangeText(outdented, lineStart, end, "preserve");
    node.setSelectionRange(Math.max(lineStart, start - removedFirst), Math.max(lineStart, end - removedTotal));
    emit();
  };

  const firstErrorByLine = new Map<number, LangError>();
  for (const error of props.errors) if (!firstErrorByLine.has(error.line)) firstErrorByLine.set(error.line, error);
  const readOnly = props.readOnly || typingNow;

  return (
    <div class="text-pane">
      <div class="gutter" ref={gutter}>
        <div class="gutter-inner">
          {Array.from({ length: lines }, (_, i) => {
            const error = firstErrorByLine.get(i + 1);
            return (
              <div class={`gutter-line ${error ? "has-error" : ""}`} key={i}>
                {error && <span class="gutter-marker" role="img" aria-label={copy.gutter(i + 1, error.message)} title={error.message} />}
                <span class="gutter-number" aria-hidden="true">
                  {i + 1}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <textarea
        ref={area}
        id={props.id}
        class="code-input"
        aria-label={props.label}
        aria-readonly={readOnly ? "true" : undefined}
        readOnly={readOnly}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        wrap="off"
        defaultValue={props.initialText}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPointerDown={() => props.onPointerDownCapture?.()}
        onBlur={() => {
          released.current = false;
        }}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
      />
    </div>
  );
}
