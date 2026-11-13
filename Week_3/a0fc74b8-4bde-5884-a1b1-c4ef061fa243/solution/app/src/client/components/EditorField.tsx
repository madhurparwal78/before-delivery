import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { BIG_STEP, STEP, moveBox, resizeBox } from "../../shared/geometry";
import type { Box, FieldJson } from "../../shared/types";

interface EditorFieldProps {
  field: FieldJson;
  recipientName: string;
  box: Box;
  selected: boolean;
  editable: boolean;
  select: (id: string) => void;
  preview: (id: string, box: Box | null) => void;
  commit: (field: FieldJson, patch: Partial<Box> & { page?: number }, announce: boolean) => void;
  keyboard: (field: FieldJson, event: KeyboardEvent<HTMLButtonElement>) => void;
}

interface Grab {
  pointerId: number;
  x: number;
  y: number;
  box: Box;
  moved: boolean;
}

function sheetAt(page: number): DOMRect | null {
  return document.getElementById(`page-${page}`)?.getBoundingClientRect() ?? null;
}

function sheetUnder(x: number, y: number): number | null {
  for (const el of document.querySelectorAll<HTMLElement>(".sheet")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return Number(el.id.replace("page-", ""));
  }
  return null;
}

const percent = (value: number) => `${value * 100}%`;

export function EditorField({ field, recipientName, box, selected, editable, select, preview, commit, keyboard }: EditorFieldProps) {
  const grab = useRef<Grab | null>(null);
  const resize = useRef<Grab | null>(null);

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (!editable || event.button !== 0) return;
    select(field.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    grab.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, box: { x: field.x, y: field.y, w: field.w, h: field.h }, moved: false };
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    const rect = sheetAt(field.page);
    if (!g || !rect || g.pointerId !== event.pointerId) return;
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    preview(field.id, moveBox(g.box, dx / rect.width, dy / rect.height));
  };

  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const g = grab.current;
    grab.current = null;
    if (!g?.moved) return;
    const target = sheetUnder(event.clientX, event.clientY);
    const rect = sheetAt(target ?? field.page);
    if (!rect) return;
    preview(field.id, null);
    if (target !== null && target !== field.page) {
      const landed = moveBox({ ...g.box, x: 0, y: 0 }, (event.clientX - rect.left) / rect.width - g.box.w / 2, (event.clientY - rect.top) / rect.height - g.box.h / 2);
      commit(field, { ...landed, page: target }, false);
    } else {
      const landed = moveBox(g.box, (event.clientX - g.x) / rect.width, (event.clientY - g.y) / rect.height);
      commit(field, landed, false);
    }
  };

  const resizeDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, box: { x: field.x, y: field.y, w: field.w, h: field.h }, moved: false };
  };

  const resizeMove = (event: PointerEvent<HTMLButtonElement>) => {
    const g = resize.current;
    const rect = sheetAt(field.page);
    if (!g || !rect) return;
    g.moved = true;
    preview(field.id, resizeBox(g.box, (event.clientX - g.x) / rect.width, (event.clientY - g.y) / rect.height));
  };

  const resizeUp = (event: PointerEvent<HTMLButtonElement>) => {
    const g = resize.current;
    resize.current = null;
    const rect = sheetAt(field.page);
    if (!g?.moved || !rect) return;
    preview(field.id, null);
    commit(field, resizeBox(g.box, (event.clientX - g.x) / rect.width, (event.clientY - g.y) / rect.height), false);
  };

  return (
    <div className="field-wrap" style={{ left: percent(box.x), top: percent(box.y), width: percent(box.w), height: percent(box.h) }}>
      <button
        id={`field-${field.id}`}
        type="button"
        className={`field kind-${field.kind}${selected ? " active" : ""}`}
        aria-pressed={selected}
        disabled={!editable}
        onFocus={() => editable && select(field.id)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          grab.current = null;
          preview(field.id, null);
        }}
        onKeyDown={(event) => keyboard(field, event)}
      >
        <span className="field-label">{field.label}</span> <span className="field-for">for {recipientName}</span>
      </button>
      {selected && editable ? (
        <button
          type="button"
          className="resize"
          tabIndex={-1}
          aria-label={`Resize ${field.label}`}
          onPointerDown={resizeDown}
          onPointerMove={resizeMove}
          onPointerUp={resizeUp}
        />
      ) : null}
    </div>
  );
}

export function keyedMove(event: KeyboardEvent<HTMLButtonElement>, box: Box): Box | null {
  const step = event.shiftKey ? BIG_STEP : STEP;
  const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const d = delta[event.key];
  if (!d) return null;
  return event.altKey ? resizeBox(box, d[0], d[1]) : moveBox(box, d[0], d[1]);
}
