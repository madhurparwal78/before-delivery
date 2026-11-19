import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface SourceMark {
  kind: 'deleted' | 'commented';
  from: number;
  to: number;
  /** A deletion that is collapsing out of the text after an accept. */
  collapsing?: boolean;
}

export interface SourceGhost {
  id: string;
  at: number;
  text: string;
  state: 'open' | 'collapsing' | 'settled';
}

export interface SourceHandle {
  focus(): void;
  setCaret(offset: number): void;
  setSelection(from: number, to: number): void;
  selection(): { from: number; to: number } | null;
  scrollLineToTop(line: number): void;
  lineTops(): number[];
  viewportTop(): number;
  element(): HTMLElement | null;
}

interface Props {
  path: string;
  text: string;
  editable: boolean;
  marks: SourceMark[];
  ghosts: SourceGhost[];
  onInput: (next: string) => void;
  onSelectionChange: () => void;
  onLayoutChange: () => void;
}

interface TextRecord {
  node: Text;
  start: number;
}

function isGhost(element: Element): boolean {
  return element instanceof HTMLElement && element.dataset.ghost === 'true';
}

function isBlock(element: Element): boolean {
  return element.tagName === 'DIV' || element.tagName === 'P';
}

/**
 * The text of the editor: every block element is a line, a `br` inside a line
 * breaks it unless it is the line's last child, and ghosts count for nothing.
 */
function collect(root: HTMLElement): { text: string; records: TextRecord[] } {
  let text = '';
  let seenBlock = false;
  const records: TextRecord[] = [];

  const walkInline = (node: Node): void => {
    const children = Array.from(node.childNodes);
    children.forEach((child, index) => {
      if (child.nodeType === Node.TEXT_NODE) {
        records.push({ node: child as Text, start: text.length });
        text += (child as Text).data;
        return;
      }
      if (!(child instanceof Element) || isGhost(child)) return;
      if (child.tagName === 'BR') {
        if (index !== children.length - 1) text += '\n';
        return;
      }
      if (isBlock(child)) {
        if (seenBlock) text += '\n';
        seenBlock = true;
      }
      walkInline(child);
    });
  };

  const children = Array.from(root.childNodes);
  if (children.some((child) => child instanceof Element && isBlock(child))) {
    for (const child of children) {
      if (child instanceof Element && isBlock(child)) {
        if (seenBlock) text += '\n';
        seenBlock = true;
        walkInline(child);
        continue;
      }
      if (child.nodeType === Node.TEXT_NODE) {
        records.push({ node: child as Text, start: text.length });
        text += (child as Text).data;
        continue;
      }
      if (child instanceof Element && !isGhost(child)) walkInline(child);
    }
  } else {
    walkInline(root);
  }
  return { text, records };
}

function markClassesFor(text: string, marks: readonly SourceMark[]): Uint8Array {
  const flags = new Uint8Array(text.length);
  for (const mark of marks) {
    const from = Math.max(0, Math.min(mark.from, text.length));
    const to = Math.max(from, Math.min(mark.to, text.length));
    const bit = (mark.kind === 'deleted' ? 1 : 2) | (mark.collapsing === true ? 4 : 0);
    for (let index = from; index < to; index += 1) flags[index] |= bit;
  }
  return flags;
}

function classOf(flag: number): string {
  const classes: string[] = [];
  if ((flag & 1) !== 0) classes.push('mark-deleted');
  if ((flag & 2) !== 0) classes.push('mark-commented');
  if ((flag & 4) !== 0) classes.push('mark-collapsing');
  return classes.join(' ');
}

function render(
  root: HTMLElement,
  text: string,
  marks: readonly SourceMark[],
  ghosts: readonly SourceGhost[],
): void {
  const flags = markClassesFor(text, marks);
  const document_ = root.ownerDocument;
  const fragment = document_.createDocumentFragment();
  let lineIndex = 0;
  let cursor = 0;

  const ghostsAt = new Map<number, SourceGhost[]>();
  for (const ghost of ghosts) {
    const list = ghostsAt.get(ghost.at) ?? [];
    list.push(ghost);
    ghostsAt.set(ghost.at, list);
  }

  while (cursor <= text.length) {
    const breakAt = text.indexOf('\n', cursor);
    const end = breakAt < 0 ? text.length : breakAt;
    const line = document_.createElement('div');
    line.className = 'source-line';
    line.dataset.line = String(lineIndex + 1);
    line.dataset.start = String(cursor);

    let index = cursor;
    let runStart = cursor;
    const flush = (upTo: number): void => {
      if (upTo <= runStart) return;
      const span = document_.createElement('span');
      const className = classOf(flags[runStart] ?? 0);
      if (className !== '') span.className = className;
      span.dataset.offset = String(runStart);
      span.textContent = text.slice(runStart, upTo);
      line.appendChild(span);
      runStart = upTo;
    };

    while (index <= end) {
      if (index < end && index > runStart && (flags[index] ?? 0) !== (flags[runStart] ?? 0)) {
        flush(index);
      }
      const atGhost = ghostsAt.get(index);
      if (atGhost !== undefined) {
        flush(index);
        for (const ghost of atGhost) {
          const span = document_.createElement('span');
          span.dataset.ghost = 'true';
          span.dataset.suggestion = ghost.id;
          span.className =
            ghost.state === 'open'
              ? 'mark-inserted'
              : ghost.state === 'collapsing'
                ? 'mark-inserted mark-collapsing'
                : 'mark-settled';
          span.contentEditable = 'false';
          span.textContent = ghost.text;
          line.appendChild(span);
        }
      }
      index += 1;
    }
    flush(end);
    if (line.childNodes.length === 0) line.appendChild(document_.createElement('br'));
    fragment.appendChild(line);

    lineIndex += 1;
    if (breakAt < 0) break;
    cursor = breakAt + 1;
  }

  root.replaceChildren(fragment);
}

function positionOf(
  root: HTMLElement,
  records: readonly TextRecord[],
  offset: number,
): { node: Node; offset: number } | null {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (offset >= record.start && offset <= record.start + record.node.data.length) {
      return { node: record.node, offset: offset - record.start };
    }
  }
  const emptyLine = root.querySelector(`.source-line[data-start="${offset}"]`);
  if (emptyLine !== null) return { node: emptyLine, offset: 0 };
  return records.length > 0 ? { node: records[0].node, offset: 0 } : null;
}

function offsetOf(
  records: readonly TextRecord[],
  text: string,
  node: Node,
  offset: number,
): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const record = records.find((candidate) => candidate.node === node);
    if (record !== undefined) return record.start + offset;
    return 0;
  }
  const children = Array.from(node.childNodes);
  const target = children[offset] ?? null;
  if (target === null) return text.length;
  for (const record of records) {
    if (target.contains(record.node) || target === record.node) return record.start;
  }
  return text.length;
}

export const SourceEditor = forwardRef<SourceHandle, Props>(function SourceEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendered = useRef<string>('');
  const editable = useRef<boolean>(props.editable);
  editable.current = props.editable;
  const signature = JSON.stringify([props.path, props.text, props.marks, props.ghosts]);

  /**
   * The source always carries a caret, so Shift and the arrow keys select text
   * for reviewers and viewers too, but a read-only source accepts no change.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return () => undefined;
    const block = (event: Event): void => {
      if (!editable.current) event.preventDefault();
    };
    const events = ['beforeinput', 'paste', 'cut', 'drop'];
    for (const name of events) host.addEventListener(name, block);
    return () => {
      for (const name of events) host.removeEventListener(name, block);
    };
  }, []);

  const read = (): { text: string; records: TextRecord[] } => {
    const host = hostRef.current;
    if (host === null) return { text: '', records: [] };
    return collect(host);
  };

  useImperativeHandle(ref, () => ({
    focus() {
      hostRef.current?.focus();
    },
    setCaret(offset: number) {
      this.setSelection(offset, offset);
    },
    setSelection(from: number, to: number) {
      const host = hostRef.current;
      if (host === null) return;
      const { records } = read();
      const start = positionOf(host, records, from);
      const end = positionOf(host, records, to);
      if (start === null || end === null) return;
      const selection = window.getSelection();
      if (selection === null) return;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    selection() {
      const host = hostRef.current;
      const selection = window.getSelection();
      if (host === null || selection === null || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) return null;
      const { text, records } = read();
      const from = offsetOf(records, text, range.startContainer, range.startOffset);
      const to = offsetOf(records, text, range.endContainer, range.endOffset);
      return from <= to ? { from, to } : { from: to, to: from };
    },
    scrollLineToTop(line: number) {
      const host = hostRef.current;
      if (host === null) return;
      const element = host.querySelector(`[data-line="${line}"]`);
      if (element instanceof HTMLElement) {
        const container = host.parentElement;
        if (container !== null) container.scrollTop = element.offsetTop;
      }
    },
    lineTops() {
      const host = hostRef.current;
      if (host === null) return [];
      const base = host.getBoundingClientRect().top;
      return Array.from(host.querySelectorAll('.source-line')).map((line) =>
        line instanceof HTMLElement ? line.getBoundingClientRect().top - base : 0,
      );
    },
    viewportTop() {
      const host = hostRef.current;
      return host === null ? 0 : host.getBoundingClientRect().top;
    },
    element() {
      return hostRef.current;
    },
  }));

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    if (rendered.current === signature) return;
    const selection = window.getSelection();
    const hasFocus = host.contains(document.activeElement);
    let saved: { from: number; to: number } | null = null;
    if (hasFocus && selection !== null && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const { text, records } = collect(host);
      saved = {
        from: offsetOf(records, text, range.startContainer, range.startOffset),
        to: offsetOf(records, text, range.endContainer, range.endOffset),
      };
    }
    render(host, props.text, props.marks, props.ghosts);
    rendered.current = signature;
    if (saved !== null) {
      const { records } = collect(host);
      const start = positionOf(host, records, saved.from);
      const end = positionOf(host, records, saved.to);
      if (start !== null && end !== null && selection !== null) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    props.onLayoutChange();
  }, [signature, props.text, props.marks, props.ghosts]);

  return (
    <div
      ref={hostRef}
      className="source"
      role="textbox"
      aria-multiline="true"
      aria-label={`Source of ${props.path}`}
      aria-readonly={props.editable ? undefined : true}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={0}
      onInput={() => {
        const { text } = read();
        rendered.current = JSON.stringify([props.path, text, props.marks, props.ghosts]);
        props.onInput(text);
      }}
      onKeyUp={props.onSelectionChange}
      onMouseUp={props.onSelectionChange}
      onSelect={props.onSelectionChange}
    />
  );
});
