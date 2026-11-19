import type { JSX, RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

/** A range of the visible text that carries review marks. */
export interface Mark {
  from: number;
  to: number;
  className: string;
  anim?: string;
  /** The suggestion this mark draws, when it draws one. */
  of?: string;
}

/** A point where a suggestion would insert text, drawn as a callout above the line. */
export interface InsertPoint {
  at: number;
  text: string;
  /** Drawn inline in the text flow (only while an accept plays). */
  inline?: boolean;
  anim?: string;
  of?: string;
}

interface EditorProps {
  path: string;
  text: string;
  marks: Mark[];
  points: InsertPoint[];
  readOnly: boolean;
  sourceRef: RefObject<HTMLTextAreaElement>;
  mirrorRef: RefObject<HTMLDivElement>;
  onInput: () => void;
  onSelection: () => void;
}

interface Piece {
  text: string;
  classes: string[];
  anim?: string | undefined;
}

function lineContent(text: string, start: number, marks: Mark[], points: InsertPoint[]): (Piece | InsertPoint)[] {
  const end = start + text.length;
  const inside = marks.filter((mark) => mark.from < end && mark.to > start && mark.to > mark.from);
  const here = points.filter((point) => point.at >= start && point.at <= end);
  const cuts = new Set<number>([start, end]);
  for (const mark of inside) {
    cuts.add(Math.max(start, mark.from));
    cuts.add(Math.min(end, mark.to));
  }
  for (const point of here) cuts.add(point.at);
  const ordered = [...cuts].sort((a, b) => a - b);
  const out: (Piece | InsertPoint)[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const from = ordered[i] as number;
    for (const point of here) if (point.at === from) out.push(point);
    const to = ordered[i + 1];
    if (to === undefined || to === from) continue;
    const covering = inside.filter((mark) => mark.from <= from && mark.to >= to);
    out.push({
      text: text.slice(from - start, to - start),
      classes: covering.map((mark) => mark.className),
      anim: covering.find((mark) => mark.anim)?.anim,
    });
  }
  return out;
}

function isPoint(piece: Piece | InsertPoint): piece is InsertPoint {
  return "at" in piece;
}

/**
 * Caret keys in a read-only source: the same moves on every platform, so reviewers
 * and viewers can place the caret and select with Shift and the arrow keys.
 */
function moveReadOnlyCaret(event: KeyboardEvent): void {
  const field = event.currentTarget as HTMLTextAreaElement;
  if (event.altKey) return;
  const word = event.ctrlKey || event.metaKey;
  // Editable fields keep the platform's own caret keys, except document start and end.
  if (!field.readOnly && !(word && (event.key === "Home" || event.key === "End"))) return;
  const value = field.value;
  const backward = field.selectionDirection === "backward";
  const anchor = backward ? field.selectionEnd : field.selectionStart;
  const head = backward ? field.selectionStart : field.selectionEnd;
  const lineBegin = (at: number) => value.lastIndexOf("\n", at - 1) + 1;
  const lineEnd = (at: number) => {
    const found = value.indexOf("\n", at);
    return found < 0 ? value.length : found;
  };
  let next: number;
  switch (event.key) {
    case "ArrowLeft":
      next = word ? 0 : Math.max(0, head - 1);
      if (!event.shiftKey && field.selectionStart !== field.selectionEnd && !word) next = field.selectionStart;
      break;
    case "ArrowRight":
      next = word ? value.length : Math.min(value.length, head + 1);
      if (!event.shiftKey && field.selectionStart !== field.selectionEnd && !word) next = field.selectionEnd;
      break;
    case "Home":
      next = word ? 0 : lineBegin(head);
      break;
    case "End":
      next = word ? value.length : lineEnd(head);
      break;
    case "ArrowUp": {
      const begin = lineBegin(head);
      if (begin === 0) next = 0;
      else {
        const above = lineBegin(begin - 1);
        next = Math.min(above + (head - begin), begin - 1);
      }
      break;
    }
    case "ArrowDown": {
      const begin = lineBegin(head);
      const end = lineEnd(head);
      if (end === value.length) next = value.length;
      else next = Math.min(end + 1 + (head - begin), lineEnd(end + 1));
      break;
    }
    default:
      return;
  }
  event.preventDefault();
  if (event.shiftKey) {
    if (next < anchor) field.setSelectionRange(next, anchor, "backward");
    else field.setSelectionRange(anchor, next, "forward");
  } else field.setSelectionRange(next, next);
}

const CALLOUT_GAP = 6;

/** Keep every insertion callout inside the source column and apart from its neighbours on the same line. */
function placeCallouts(mirror: HTMLElement): void {
  const column = mirror.getBoundingClientRect();
  const right = column.right - parseFloat(getComputedStyle(mirror).paddingRight || "0");
  for (const line of Array.from(mirror.querySelectorAll<HTMLElement>(".ln"))) {
    let edge = -Infinity;
    for (const callout of Array.from(line.querySelectorAll<HTMLElement>(".ins-callout"))) {
      callout.style.left = "0px";
      callout.classList.remove("ins-below");
      const box = callout.getBoundingClientRect();
      let shift = Math.max(0, edge + CALLOUT_GAP - box.left);
      if (box.right + shift > right) shift = right - box.right;
      if (box.left + shift < edge + CALLOUT_GAP) {
        callout.classList.add("ins-below");
        shift = Math.min(0, right - box.right);
      } else {
        edge = box.right + shift;
      }
      callout.style.left = `${shift}px`;
    }
  }
}

/** The source: a native text field over a mirror that draws the review marks and the gutter. */
export function Editor(props: EditorProps): JSX.Element {
  useLayoutEffect(() => {
    if (props.mirrorRef.current) placeCallouts(props.mirrorRef.current);
  });
  // Suggest edit and Comment follow the selection however the browser reports it, touch handles included.
  const onSelection = useRef(props.onSelection);
  onSelection.current = props.onSelection;
  useLayoutEffect(() => {
    const field = props.sourceRef.current;
    if (!field) return;
    const changed = () => onSelection.current();
    const fromDocument = () => {
      if (document.activeElement === field) changed();
    };
    field.addEventListener("selectionchange", changed);
    document.addEventListener("selectionchange", fromDocument);
    return () => {
      field.removeEventListener("selectionchange", changed);
      document.removeEventListener("selectionchange", fromDocument);
    };
  }, []);
  const lines = props.text.split("\n");
  let offset = 0;
  return (
    <div class="sheet">
      <div class="text-col">
        <div class="mirror" ref={props.mirrorRef} aria-hidden="true">
          {lines.map((line, index) => {
            const start = offset;
            offset += line.length + 1;
            const pieces = lineContent(line, start, props.marks, props.points);
            return (
              <div class="ln" data-ln={index + 1} key={index}>
                <span class="ln-num">{index + 1}</span>
                {pieces.length === 0 || (pieces.length === 1 && !isPoint(pieces[0] as Piece) && (pieces[0] as Piece).text === "")
                  ? "​"
                  : pieces.map((piece, i) =>
                      isPoint(piece) ? (
                        piece.inline ? (
                          <span class="ins-inline" data-anim={piece.anim} key={`p${i}`}>{piece.text}</span>
                        ) : (
                          <span class="ins-point" key={`p${i}`}>
                            <span class="ins-callout" data-anim={piece.anim}>{piece.text}</span>
                          </span>
                        )
                      ) : piece.classes.length || piece.anim ? (
                        <span class={piece.classes.join(" ")} data-anim={piece.anim} key={i}>{piece.text}</span>
                      ) : (
                        piece.text
                      ),
                    )}
              </div>
            );
          })}
        </div>
        <textarea
          id="source"
          ref={props.sourceRef}
          class="source"
          aria-label={`Source of ${props.path}`}
          readOnly={props.readOnly}
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          wrap="soft"
          onInput={props.onInput}
          onKeyDown={moveReadOnlyCaret}
          onSelect={props.onSelection}
          onKeyUp={props.onSelection}
          onMouseUp={props.onSelection}
          onFocus={props.onSelection}
        />
      </div>
    </div>
  );
}
