// The file list (brief: Interactions, File list): a multi-select listbox with one Tab stop and roving focus,
// anchor-based range selection, typeahead, touch selection mode and pointer drag onto folders.
import { useRef } from "react";
import { Icon } from "../icons";
import { filesWord, formatSize, grantDaysLeft, phoenixMinute } from "../format";
import { BlueprintThumb, EmptyDrawing, FolderThumb, SheetThumb } from "../drawings";
import type { DriveFile, Folder, Role } from "../../shared/api";
import type { View } from "../router";

const TYPEAHEAD_MS = 500;
const LONG_PRESS_MS = 500;
const DRAG_START_PX = 5;

interface ShareInfo {
  role: Role;
  endDate: string;
  daysLeft: number;
}

export type Entry =
  | { kind: "folder"; id: string; name: string; folder: Folder; share?: ShareInfo }
  | { kind: "file"; id: string; name: string; file: DriveFile; share?: ShareInfo };

export interface Selection {
  ids: Set<string>;
  anchor: string | null;
}

interface Props {
  entries: Entry[];
  view: View;
  selection: Selection;
  focusId: string | null;
  onFocusId: (id: string) => void;
  onSelect: (next: Selection) => void;
  /** Enter, double-click or a tap outside selection mode. */
  onOpen: (entry: Entry) => void;
  pending: Set<string>;
  stayed: Set<string>;
  cutIds: Set<string>;
  showLocation?: boolean;
  phone: boolean;
  selectionMode: boolean;
  onLongPress: (entry: Entry) => void;
  onDrag: (ids: string[], at: { x: number; y: number } | null, drop: boolean) => void;
  empty: string | null;
  busy: boolean;
}

export const optionId = (id: string) => `entry-${id}`;

function range(entries: Entry[], from: string | null, to: string): Set<string> {
  const a = entries.findIndex((e) => e.id === from), b = entries.findIndex((e) => e.id === to);
  if (a < 0) return new Set([to]);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return new Set(entries.slice(lo, hi + 1).map((e) => e.id));
}

function columns(list: HTMLElement | null): number {
  const items = [...(list?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
  const top = items[0]?.offsetTop;
  return Math.max(1, items.filter((i) => i.offsetTop === top).length);
}

function Thumb({ entry }: { entry: Entry }) {
  if (entry.kind === "folder") return <FolderThumb />;
  return entry.file.contentType.startsWith("image/") ? <BlueprintThumb /> : <SheetThumb name={entry.file.name} />;
}

function iconFor(entry: Entry) {
  if (entry.kind === "folder") return <Icon name="folder" />;
  return <Icon name={entry.file.contentType.startsWith("image/") ? "image" : "fileText"} />;
}

export function FileList(props: Props) {
  const { entries, view, selection, focusId, onFocusId, onSelect, onOpen, pending, stayed, cutIds, phone, selectionMode } = props;
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: "" });
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean; x: number; y: number }>({ fired: false, x: 0, y: 0 });
  const drag = useRef<{ ids: string[]; x: number; y: number; active: boolean } | null>(null);
  const swallowClick = useRef(false);
  const roving = entries.some((e) => e.id === focusId) ? focusId : entries[0]?.id ?? null;

  const focusEntry = (id: string) => {
    onFocusId(id);
    document.getElementById(optionId(id))?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const at = entries.findIndex((e) => e.id === roving);
    const current = entries[at];
    if (!current) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const step = (delta: number) => {
      const target = entries[Math.max(0, Math.min(entries.length - 1, at + delta))];
      if (!target) return;
      focusEntry(target.id);
      if (event.shiftKey) onSelect({ ids: range(entries, selection.anchor ?? current.id, target.id), anchor: selection.anchor ?? current.id });
      else if (!ctrl) onSelect({ ids: new Set([target.id]), anchor: target.id });
    };
    const grid = view === "grid";
    switch (event.key) {
      case "ArrowDown":
        step(grid ? columns(list.current) : 1);
        break;
      case "ArrowUp":
        step(grid ? -columns(list.current) : -1);
        break;
      case "ArrowRight":
        if (!grid) return;
        step(1);
        break;
      case "ArrowLeft":
        if (!grid) return;
        step(-1);
        break;
      case "Home":
        if (entries[0]) focusEntry(entries[0].id);
        break;
      case "End": {
        const last = entries[entries.length - 1];
        if (last) focusEntry(last.id);
        break;
      }
      case " ":
        if (ctrl) {
          const ids = new Set(selection.ids);
          if (ids.has(current.id)) ids.delete(current.id);
          else ids.add(current.id);
          onSelect({ ids, anchor: current.id });
        } else {
          onSelect({ ids: new Set([current.id]), anchor: current.id });
        }
        break;
      case "Enter":
        onOpen(current);
        break;
      default:
        if (ctrl && event.key.toLowerCase() === "a") {
          onSelect({ ids: new Set(entries.map((e) => e.id)), anchor: selection.anchor ?? current.id });
          break;
        }
        if (ctrl || event.altKey || event.key.length !== 1) return;
        clearTimeout(typed.current.timer);
        typed.current.text += event.key.toLowerCase();
        typed.current.timer = setTimeout(() => (typed.current.text = ""), TYPEAHEAD_MS);
        {
          const text = typed.current.text;
          const start = text.length > 1 ? at : at + 1;
          for (let i = 0; i < entries.length; i++) {
            const candidate = entries[(start + i) % entries.length];
            if (candidate?.name.toLowerCase().startsWith(text)) {
              focusEntry(candidate.id);
              break;
            }
          }
        }
    }
    event.preventDefault();
  };

  const onClick = (event: React.MouseEvent, entry: Entry) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (phone) {
      if (selectionMode) {
        const ids = new Set(selection.ids);
        if (ids.has(entry.id)) ids.delete(entry.id);
        else ids.add(entry.id);
        onSelect({ ids, anchor: entry.id });
      } else {
        onOpen(entry);
      }
      return;
    }
    onFocusId(entry.id);
    if (event.shiftKey) onSelect({ ids: range(entries, selection.anchor, entry.id), anchor: selection.anchor ?? entry.id });
    else if (event.ctrlKey || event.metaKey) {
      const ids = new Set(selection.ids);
      if (ids.has(entry.id)) ids.delete(entry.id);
      else ids.add(entry.id);
      onSelect({ ids, anchor: entry.id });
    } else onSelect({ ids: new Set([entry.id]), anchor: entry.id });
  };

  const startPress = (event: React.TouchEvent, entry: Entry) => {
    swallowClick.current = false;
    if (!phone) return;
    const touch = event.touches[0];
    press.current = { fired: false, x: touch?.clientX ?? 0, y: touch?.clientY ?? 0 };
    press.current.timer = setTimeout(() => {
      press.current.fired = true;
      swallowClick.current = true;
      props.onLongPress(entry);
    }, LONG_PRESS_MS);
  };

  const endPress = () => clearTimeout(press.current.timer);

  const onPointerDown = (event: React.PointerEvent, entry: Entry) => {
    if (event.pointerType === "mouse") swallowClick.current = false;
    if (event.pointerType !== "mouse" || event.button !== 0 || phone || entry.kind !== "file") return;
    const ids = selection.ids.has(entry.id) ? entries.filter((e) => selection.ids.has(e.id) && e.kind === "file").map((e) => e.id) : [entry.id];
    drag.current = { ids, x: event.clientX, y: event.clientY, active: false };
    const move = (e: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      if (!state.active && Math.hypot(e.clientX - state.x, e.clientY - state.y) < DRAG_START_PX) return;
      state.active = true;
      props.onDrag(state.ids, { x: e.clientX, y: e.clientY }, false);
    };
    const up = (e: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      const state = drag.current;
      drag.current = null;
      if (!state?.active) return;
      swallowClick.current = true;
      props.onDrag(state.ids, { x: e.clientX, y: e.clientY }, true);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  return (
    <>
    <div ref={list} role="listbox" aria-label="Files" aria-multiselectable="true" aria-busy={props.busy || undefined}
      data-shortcuts="" className={`files files-${view}${props.showLocation ? " with-location" : ""}`} onKeyDown={onKeyDown}>
      {entries.map((entry) => {
        const selected = selection.ids.has(entry.id);
        const file = entry.kind === "file" ? entry.file : null;
        const meta = `${entry.id}-meta`;
        return (
          <div key={entry.id} id={optionId(entry.id)} role="option" aria-selected={selected}
            aria-describedby={meta} aria-busy={pending.has(entry.id) || undefined} tabIndex={entry.id === roving ? 0 : -1}
            data-entry-id={entry.id} data-from-folder={file?.folderId ?? undefined}
            data-drop-folder={entry.kind === "folder" ? entry.id : undefined}
            className={`row${selected ? " is-selected" : ""}${pending.has(entry.id) ? " is-pending" : ""}`}
            onFocus={() => onFocusId(entry.id)}
            onClick={(e) => onClick(e, entry)}
            onDoubleClick={() => !phone && onOpen(entry)}
            onContextMenu={(e) => phone && e.preventDefault()}
            onPointerDown={(e) => onPointerDown(e, entry)}
            onTouchStart={(e) => startPress(e, entry)}
            onTouchEnd={endPress}
            onTouchMove={(e) => {
              const t = e.touches[0];
              if (t && Math.hypot(t.clientX - press.current.x, t.clientY - press.current.y) > 10) endPress();
            }}>
            {view === "grid" ? <span className="row-thumb" aria-hidden="true"><Thumb entry={entry} /></span> : <span className="row-icon" aria-hidden="true">{iconFor(entry)}</span>}
            <span id={`${entry.id}-name`} className="row-name" title={entry.name}>{entry.name}</span>
            <span id={meta} className="row-meta" role="group" aria-hidden="true">
              {file?.locked && <span className="badge badge-lock"><Icon name="lock" size={11} />Locked</span>}
              {stayed.has(entry.id) && <span className="badge badge-stayed">Stayed</span>}
              {cutIds.has(entry.id) && <span className="badge badge-cut"><Icon name="scissors" size={11} />Cut</span>}
              {entry.share && (
                <span className="row-share">
                  <span className="role">{entry.share.role === "editor" ? "Editor" : "Viewer"}</span>{" "}
                  <span className={entry.share.daysLeft === 0 ? "ends warn" : "ends"}>Ends <span className="num">{entry.share.endDate}</span> · <span className="num">{grantDaysLeft(entry.share.daysLeft)}</span></span>
                </span>
              )}
              {props.showLocation && file && <span className="row-location">{file.folderName}</span>}
              {file && <span className="row-size num">{formatSize(file.size)}</span>}
              {file && <span className="row-time num">{phoenixMinute(file.modifiedAt)}</span>}
              {entry.kind === "folder" && <span className="row-time num">{filesWord(entry.folder.fileCount)}</span>}
            </span>
            {pending.has(entry.id) && <span className="pending-dot" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
    {props.empty && (
      <div className="empty">
        <EmptyDrawing />
        <p>{props.empty}</p>
      </div>
    )}
    </>
  );
}
