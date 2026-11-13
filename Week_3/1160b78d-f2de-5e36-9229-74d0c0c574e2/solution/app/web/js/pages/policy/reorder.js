// Moving a level: one handle for the pointer and the keyboard. Both change the same array; nothing is stored here.
import { useState, useRef, useLayoutEffect } from '../../lib/html.js';
import { live } from '../../lib/live.js';

function moveItem(list, from, to) {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// useReorder watches `items` (each with a stable `cid`) and calls `setItems` with the new order.
// `listRef` is the element whose children are the rows, in order.
export function useReorder(items, setItems, listRef) {
  const [lifted, setLifted] = useState(null); // {cid, original}: a level held with the keyboard
  const [drag, setDrag] = useState(null); // {cid, over}: a level held with the pointer
  const latest = useRef(items);
  const dragging = useRef(null);
  const refocus = useRef(null);
  const handles = useRef(new Map());
  latest.current = items;

  // A reordered row is moved in the document, which can drop focus: put it back on the moved level's handle.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    const handle = handles.current.get(refocus.current);
    refocus.current = null;
    if (handle && document.activeElement !== handle) handle.focus();
  });

  const place = (next, cid) => {
    latest.current = next;
    refocus.current = cid;
    setItems(next);
    live.announce(`Level moved to position ${next.findIndex((item) => item.cid === cid) + 1}.`);
  };

  const moveTo = (cid, to) => {
    const from = latest.current.findIndex((item) => item.cid === cid);
    if (from === to || to < 0 || to >= latest.current.length) return;
    place(moveItem(latest.current, from, to), cid);
  };

  const rowAt = (clientY) => {
    const rows = [...listRef.current.children];
    const index = rows.findIndex((row) => clientY <= row.getBoundingClientRect().bottom);
    return index === -1 ? rows.length - 1 : index;
  };

  const handleProps = (cid) => ({
    ref: (el) => {
      if (el) handles.current.set(cid, el);
      else handles.current.delete(cid);
    },
    'aria-pressed': lifted?.cid === cid ? 'true' : 'false',
    onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = { cid, over: latest.current.findIndex((item) => item.cid === cid) };
      setDrag(dragging.current);
    },
    onPointerMove(event) {
      if (!dragging.current) return;
      const over = rowAt(event.clientY);
      if (over !== dragging.current.over) {
        dragging.current = { cid, over };
        setDrag(dragging.current);
      }
    },
    onPointerUp(event) {
      if (!dragging.current) return;
      const to = rowAt(event.clientY);
      dragging.current = null;
      setDrag(null);
      moveTo(cid, to);
    },
    onPointerCancel() {
      dragging.current = null;
      setDrag(null);
    },
    onKeyDown(event) {
      const index = latest.current.findIndex((item) => item.cid === cid);
      if (event.key === ' ') {
        event.preventDefault();
        setLifted(lifted?.cid === cid ? null : { cid, original: latest.current });
      } else if (lifted?.cid === cid && event.key === 'ArrowUp') {
        event.preventDefault();
        moveTo(cid, index - 1);
      } else if (lifted?.cid === cid && event.key === 'ArrowDown') {
        event.preventDefault();
        moveTo(cid, index + 1);
      } else if (lifted?.cid === cid && event.key === 'Escape') {
        event.preventDefault();
        setLifted(null);
        if (lifted.original !== latest.current) place(lifted.original, cid);
      }
    },
    onKeyUp(event) {
      if (event.key === ' ') event.preventDefault();
    },
    onBlur() {
      if (refocus.current !== cid) setLifted(null);
    },
  });

  return { handleProps, liftedCid: lifted?.cid ?? null, drag };
}
