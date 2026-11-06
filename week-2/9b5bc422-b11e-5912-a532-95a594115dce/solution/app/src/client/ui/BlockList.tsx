import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { GripVertical } from "lucide-react";
import { attachmentText } from "../domain/attachments.ts";
import { blockLabel, blockName, indented, isListBlock, isTextBlock, listNumbers, matchingOptions, typeLabel } from "../domain/blocks.ts";
import { columnTotal } from "../domain/records.ts";
import type { BlockType, WorkspaceRecord } from "../domain/types.ts";
import { attachFile, deleteBlock, insertBlockAfter, moveBlock, setBlockChecked, setBlockIndent, setBlockText, turnBlockInto } from "../store/actions.ts";
import { announce } from "../store/announcer.ts";
import { readFile } from "../store/deviceStore.ts";
import { blocksOf, cellsOf, columnsOf, getRecord, hasNotch, rowsOf } from "../store/workspace.ts";
import { BothKept } from "./BothKept.tsx";
import { Link } from "./common.tsx";
import { holdGripTouches } from "./hooks.ts";

/** Line summary a Record table block and its card share. */
export function TableSummary({ tableId }: { tableId: string | null }) {
  const table = tableId ? getRecord("table", tableId) : undefined;
  if (!table) return null;
  const rows = rowsOf(table.id).map(cellsOf);
  const firstNumber = columnsOf(table).find((column) => column.type === "number");
  return (
    <>
      <p className="table-block-name">{table.fields.name}</p>
      <p>{rows.length === 1 ? "1 row" : `${rows.length} rows`}</p>
      {firstNumber && <p>{firstNumber.name} total: {columnTotal(rows, firstNumber.id)}</p>}
    </>
  );
}

export const tableLink = (tableId: string | null): { href: string; name: string } | null => {
  const table = tableId ? getRecord("table", tableId) : undefined;
  return table ? { href: `/records/${table.id}`, name: `Open ${table.fields.name}` } : null;
};

export const blockNameOf = (block: WorkspaceRecord<"block">): string => {
  const kept = block.sync.bothKept["text"];
  const fields = kept ? { ...block.fields, text: String(kept[0] ?? "") } : block.fields;
  const table = block.fields.tableId ? getRecord("table", block.fields.tableId) : undefined;
  return blockName(typeLabel(block.fields.type), blockLabel(fields, table?.fields.name), { notched: hasNotch(block), bothKept: Boolean(kept) });
};

/** Grows a textarea with its text, including when its width changes. */
export function useFittedHeight(element: HTMLTextAreaElement | null, value: string): void {
  useLayoutEffect(() => {
    if (!element) return;
    const fit = (): void => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, value]);
}

export function focusPageBlock(id: string, target: "start" | "end" = "end"): void {
  const root = document.querySelector<HTMLElement>(`[data-page-block="${id}"]`);
  const field = root?.querySelector<HTMLTextAreaElement>("textarea");
  if (field) {
    field.focus();
    const caret = target === "end" ? field.value.length : 0;
    field.setSelectionRange(caret, caret);
  } else (root?.querySelector<HTMLElement>('input[type="file"]') ?? root?.querySelector<HTMLElement>('[role="group"][tabindex]') ?? root)?.focus();
}

function FileBody({ block }: { block: WorkspaceRecord<"block"> }) {
  const attachment = block.fields.attachmentId ? getRecord("attachment", block.fields.attachmentId) : undefined;
  const [source, setSource] = useState("");
  const isImage = block.fields.type === "image";
  useEffect(() => {
    if (!isImage || !block.fields.attachmentId) return;
    let url = "";
    void readFile(block.fields.attachmentId).then((file) => {
      url = file ? URL.createObjectURL(file) : `/api/attachments/${block.fields.attachmentId}`;
      setSource(url);
    });
    return () => URL.revokeObjectURL(url);
  }, [isImage, block.fields.attachmentId]);
  const add = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) void attachFile(block, file);
  };
  if (!block.fields.attachmentId) {
    return (
      <label className="attach">
        <span>Attach a file</span>
        <input type="file" onChange={add} accept={isImage ? "image/*" : undefined} />
      </label>
    );
  }
  return (
    <>
      {source && <img src={source} alt={block.fields.fileName} className="block-image" />}
      <p className="file-name">{attachment?.fields.state === "stored"
        ? <a href={`/api/attachments/${attachment.id}`} download>{block.fields.fileName}</a>
        : block.fields.fileName}</p>
      <p className="file-state">{attachmentText(attachment)}</p>
    </>
  );
}

type SlashMenu = { blockId: string; highlight: number };

function SlashList({ query, highlight, listId }: { query: string; highlight: number; listId: string }) {
  const options = matchingOptions(query);
  return (
    <div className="slash">
      <div role="listbox" id={listId} aria-label="Insert block">
        {options.map((option, index) => (
          <div key={option.type} role="option" id={`${listId}-${index}`} aria-selected={index === highlight} className="slash-option">
            {option.label}
          </div>
        ))}
      </div>
      {options.length === 0 && <p className="slash-empty">No blocks match.</p>}
    </div>
  );
}

function BlockRow({ block, number, ghost, slash, setSlash, onSelect, previous, next, onDragStart, dragShift }: {
  block: WorkspaceRecord<"block">;
  number: number | undefined;
  ghost: boolean;
  slash: SlashMenu | null;
  setSlash: (menu: SlashMenu | null) => void;
  onSelect: (id: string) => void;
  previous: WorkspaceRecord<"block"> | undefined;
  next: WorkspaceRecord<"block"> | undefined;
  onDragStart: (block: WorkspaceRecord<"block">, event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragShift: number;
}) {
  const { type, text, indent, checked } = block.fields;
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const leaving = useRef(false);
  const kept = block.sync.bothKept["text"];
  const shownText = kept ? String(kept[0] ?? "") : text;
  useFittedHeight(field, shownText);
  const name = blockNameOf(block);
  const menuOpen = slash?.blockId === block.id;
  const query = shownText.slice(1);
  const listId = `slash-${block.id}`;
  const textBlock = isTextBlock(type);

  const relocate = (delta: number): void => {
    const siblings = blocksOf(block.fields.documentId);
    const position = siblings.findIndex((sibling) => sibling.id === block.id);
    const target = position + delta;
    if (target < 0 || target >= siblings.length) return;
    flushSync(() => moveBlock(block, target));
    focusPageBlock(block.id);
    announce(`Moved block to position ${target + 1}.`);
  };
  const removeAndFocusAbove = (): void => {
    if (!previous && !next) return;
    flushSync(() => deleteBlock(block));
    focusPageBlock((previous ?? next)?.id ?? "");
  };
  const choose = (chosen: BlockType): void => {
    setSlash(null);
    const paragraphId = flushSync(() => turnBlockInto(block, chosen));
    focusPageBlock(paragraphId ?? block.id);
  };
  const onSlashKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const options = matchingOptions(query);
    const count = options.length;
    if (event.key === "ArrowDown" && count) setSlash({ blockId: block.id, highlight: ((slash?.highlight ?? 0) + 1) % count });
    else if (event.key === "ArrowUp" && count) setSlash({ blockId: block.id, highlight: ((slash?.highlight ?? 0) - 1 + count) % count });
    else if (event.key === "Enter") {
      const option = options[slash?.highlight ?? 0];
      if (option) choose(option.type);
    } else if (event.key === "Escape") setSlash(null);
    else return false;
    event.preventDefault();
    return true;
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menuOpen && onSlashKey(event)) return;
    const wasLeaving = leaving.current;
    leaving.current = false;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      relocate(event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const id = flushSync(() => insertBlockAfter(block));
      focusPageBlock(id);
    } else if (event.key === "Backspace" && shownText === "") {
      event.preventDefault();
      removeAndFocusAbove();
    } else if (event.key === "/" && shownText === "" && !kept) {
      setSlash({ blockId: block.id, highlight: 0 });
    } else if (event.key === "Escape" && isListBlock(type)) {
      leaving.current = true;
    } else if (event.key === "Tab" && isListBlock(type) && !wasLeaving) {
      event.preventDefault();
      const nextIndent = event.shiftKey ? Math.max(indent - 1, 0) : indented(indent, previous?.fields);
      if (nextIndent === indent) return;
      setBlockIndent(block.id, nextIndent);
      announce(event.shiftKey ? "Outdented." : "Indented.");
    }
  };
  const onText = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const value = event.target.value;
    setBlockText(block.id, value.replaceAll("\n", " "));
    if (menuOpen) {
      if (value.startsWith("/")) setSlash({ blockId: block.id, highlight: 0 });
      else setSlash(null);
    }
  };
  const onGroupKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      relocate(event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      removeAndFocusAbove();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const id = flushSync(() => insertBlockAfter(block));
      focusPageBlock(id);
    }
  };

  const link = tableLink(block.fields.tableId);
  const style: CSSProperties = { "--indent": indent, ...(dragShift ? { transform: `translateY(${dragShift}px)` } : {}) } as CSSProperties;
  return (
    <div
      data-page-block={block.id}
      {...(ghost ? {} : { "data-block-id": block.id, "data-block-type": type, ...(isListBlock(type) ? { "data-indent": String(indent) } : {}) })}
      data-notched={hasNotch(block) || undefined}
      className={`block block-${type}${ghost ? " block-ghost" : ""}`}
      style={style}
    >
      <button ref={holdGripTouches} type="button" className="block-handle" aria-label="Move block" onPointerDown={(event) => onDragStart(block, event)} onFocus={() => onSelect(block.id)}>
        <GripVertical aria-hidden="true" />
      </button>
      {type === "bulleted" && <span className="marker" aria-hidden="true">•</span>}
      {type === "numbered" && <span className="marker" aria-hidden="true">{number}.</span>}
      {type === "todo" && (
        <label className="tick">
          <input type="checkbox" aria-label="Done" checked={checked} onChange={(event) => setBlockChecked(block.id, event.target.checked)} />
        </label>
      )}
      {textBlock ? (
        <div className="block-text">
          <textarea
            ref={setField}
            rows={1}
            aria-label={name}
            value={shownText}
            readOnly={Boolean(kept)}
            onChange={onText}
            onKeyDown={onKey}
            onFocus={() => onSelect(block.id)}
            onBlur={() => { if (menuOpen) setSlash(null); leaving.current = false; }}
            {...(menuOpen ? { "aria-controls": listId, "aria-activedescendant": `${listId}-${slash?.highlight ?? 0}` } : {})}
          />
          {menuOpen && <SlashList query={query} highlight={slash?.highlight ?? 0} listId={listId} />}
        </div>
      ) : (
        <div role="group" tabIndex={0} aria-label={name} className="block-object" onKeyDown={onGroupKey} onFocus={() => onSelect(block.id)}>
          {type === "divider" && <hr />}
          {(type === "image" || type === "file") && <FileBody block={block} />}
          {type === "table" && <TableSummary tableId={block.fields.tableId} />}
          {type === "table" && link && <Link href={link.href} className="text-link">{link.name}</Link>}
        </div>
      )}
      {kept && !ghost && (
        <BothKept
          kind="block"
          id={block.id}
          field="text"
          values={kept}
          text={String}
          sentence="Both kept. Two devices changed this block. Pick the one to keep."
          onChosen={() => focusPageBlock(block.id)}
        />
      )}
    </div>
  );
}

const SAME_ROW_PX = 2;

export function BlockList({ documentId, ghost = false, onSelect }: { documentId: string; ghost?: boolean; onSelect: (id: string) => void }) {
  const blocks = blocksOf(documentId);
  const [slash, setSlash] = useState<SlashMenu | null>(null);
  const [drag, setDrag] = useState<{ id: string; shift: number } | null>(null);
  const numbers = listNumbers(blocks);

  const startDrag = (block: WorkspaceRecord<"block">, event: ReactPointerEvent<HTMLButtonElement>): void => {
    const startY = event.clientY;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rows = blocks.map((candidate) => document.querySelector(`[data-page-block="${candidate.id}"]`)?.getBoundingClientRect());
    const move = (moved: PointerEvent): void => {
      if (Math.abs(moved.clientY - startY) > SAME_ROW_PX) setDrag({ id: block.id, shift: moved.clientY - startY });
    };
    const up = (ended: PointerEvent): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setDrag(null);
      const from = blocks.findIndex((candidate) => candidate.id === block.id);
      const over = rows.findIndex((rect) => rect && ended.clientY < rect.bottom);
      const target = over === -1 ? blocks.length - 1 : over;
      if (target !== from && Math.abs(ended.clientY - startY) > SAME_ROW_PX) {
        moveBlock(block, target);
        announce(`Moved block to position ${target + 1}.`);
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };

  return (
    <div className="blocks">
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          number={numbers.get(block.id)}
          ghost={ghost}
          slash={slash}
          setSlash={setSlash}
          onSelect={onSelect}
          previous={blocks[index - 1]}
          next={blocks[index + 1]}
          onDragStart={startDrag}
          dragShift={drag?.id === block.id ? drag.shift : 0}
        />
      ))}
    </div>
  );
}
