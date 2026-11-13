// Handoff Cut: one state machine for pointer and keyboard. A cursor (the "Cut here" tab) hovers over the final row,
// pressing or Enter drops an anchor, the free edge then moves 15 minutes at a time, and releasing or Enter commits.
import { useState, useRef, useEffect } from '../../lib/html.js';
import { api, newKey } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { serverNow } from './serverclock.js';
import { STEP, iso, snapStep, floorStep, stepBy, clockIn, typed, lengthText } from './zonetime.js';
import { setMotion, clearMotionSoon, reducedMotion } from './motion.js';

const FORBIDDEN_TEXT = 'Only leads and admins can change overrides.';
const FAILED_TEXT = 'The override could not be saved.';

// refusalText is the sentence the server gave for a refused cut or preview, verbatim.
export function refusalText(res) {
  const data = res.data ?? {};
  if (data.message) return data.message;
  const sentences = data.errors ? Object.values(data.errors) : [];
  if (sentences.length) return sentences[0];
  return res.status === 403 ? FORBIDDEN_TEXT : FAILED_TEXT;
}

// splitBlocks cuts every block that meets [lo, hi) into the pieces before, under and after the cut. Each piece keeps its
// person; blocks the cut misses are returned untouched.
export function splitBlocks(blocks, lo, hi) {
  const out = [];
  for (const b of blocks) {
    if (b.endMs <= lo || b.startMs >= hi) {
      out.push(b);
      continue;
    }
    const cuts = [b.startMs, Math.max(b.startMs, lo), Math.min(b.endMs, hi), b.endMs];
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      out.push({ ...b, startMs: cuts[i], endMs: cuts[i + 1], preview: true, under: i === 1 });
    }
  }
  return out;
}

export function useCut(options) {
  const opt = useRef(options);
  opt.current = options;
  const trackRef = useRef(null);
  const cutRef = useRef(null);
  const cursorRef = useRef(null);
  const loop = useRef({ busy: false, again: false });
  const [cut, setCutState] = useState(null);
  const [cursor, setCursorState] = useState(null);
  const [preview, setPreview] = useState('');
  const [ghost, setGhost] = useState(null);

  const setCut = (value) => {
    cutRef.current = value;
    setCutState(value);
  };
  const setCursor = (value) => {
    cursorRef.current = value;
    setCursorState(value);
  };
  const clampEdge = (ms) => Math.min(Math.max(ms, opt.current.fromMs), opt.current.toMs);

  const timeAt = (clientX) => {
    const { fromMs, toMs, zone } = opt.current;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return clampEdge(snapStep(fromMs + fraction * (toMs - fromMs), zone));
  };

  // The keyboard cursor starts at the latest step at or before the server's present when that lies inside the range
  // (its end excluded), else at the range's start.
  const startCursor = () => {
    const { fromMs, toMs, zone } = opt.current;
    const present = floorStep(serverNow(), zone);
    return present >= fromMs && present < toMs ? present : fromMs;
  };
  const keyboardAt = () => (cursorRef.current?.via === 'keyboard' ? cursorRef.current.at : startCursor());

  const begin = (anchor, via) => {
    setPreview('');
    setCut({ anchor, edge: anchor, via, committing: false });
  };

  const moveEdge = (edge) => {
    const c = cutRef.current;
    if (!c || c.edge === edge) return;
    setMotion('step');
    setCut({ ...c, edge });
    clearMotionSoon();
  };

  const cancel = () => {
    const c = cutRef.current;
    if (!c || c.committing) return;
    setCut(null);
    setPreview('');
    setCursor({ at: c.edge, via: c.via });
  };

  const finish = (c, kind, text) => {
    if (!reducedMotion()) setGhost({ anchor: c.anchor, edge: c.edge, kind });
    setCut(null);
    setPreview(text);
    setCursor({ at: c.edge, via: c.via });
    clearMotionSoon();
  };

  const commit = async () => {
    const c = cutRef.current;
    const { scheduleId, scheduleZone, cutFor, cutForName, reload } = opt.current;
    setCut({ ...c, committing: true });
    const start = Math.min(c.anchor, c.edge);
    const end = Math.max(c.anchor, c.edge);
    const res = await api.post(`/api/schedules/${scheduleId}/overrides`,
      { person_id: cutFor || null, start: iso(start), end: iso(end) }, { idempotencyKey: newKey() });
    setMotion('settle');
    if (res.ok) {
      const saved = res.data.override ?? {};
      const who = typeof saved.person === 'string' ? saved.person : saved.person?.name ?? cutForName;
      live.announce(`Override saved: ${who} from ${fmtLocal(saved.start ?? iso(start), scheduleZone)} to ${fmtLocal(saved.end ?? iso(end), scheduleZone)}.`);
      await reload();
      finish(c, 'settled', '');
    } else {
      const text = refusalText(res);
      live.announce(text);
      finish(c, 'refused', text);
    }
  };

  const finishOrCancel = () => {
    const c = cutRef.current;
    if (c.edge === c.anchor) cancel();
    else commit();
  };

  const runPreview = async () => {
    const state = loop.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    state.busy = true;
    try {
      do {
        state.again = false;
        const c = cutRef.current;
        if (!c || c.committing || c.anchor === c.edge) break;
        const sentFor = opt.current.cutFor;
        const res = await api.post(`/api/schedules/${opt.current.scheduleId}/overrides/preview`,
          { person_id: sentFor || null, start: iso(Math.min(c.anchor, c.edge)), end: iso(Math.max(c.anchor, c.edge)) });
        const now = cutRef.current;
        if (!now || now.committing) break;
        if (now.anchor === c.anchor && now.edge === c.edge && opt.current.cutFor === sentFor) {
          setPreview(res.ok ? res.data.summary : refusalText(res));
        } else {
          state.again = true;
        }
      } while (state.again);
    } finally {
      state.busy = false;
    }
  };

  useEffect(() => {
    if (!cut || cut.committing) return undefined;
    if (cut.anchor === cut.edge) {
      setPreview('');
      return undefined;
    }
    const timer = setTimeout(runPreview, 60);
    return () => clearTimeout(timer);
  }, [cut?.anchor, cut?.edge, options.cutFor]);

  // Escape cancels a cut however it was started.
  useEffect(() => {
    if (!cut) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [cut === null]);

  // A new range or zone abandons whatever was in progress.
  useEffect(() => {
    setCut(null);
    setCursor(null);
    setPreview('');
  }, [options.fromMs, options.toMs, options.zone, options.scheduleId]);

  const handlers = {
    onPointerMove(event) {
      if (event.pointerType === 'touch') return;
      const at = timeAt(event.clientX);
      const c = cutRef.current;
      if (c) {
        if (c.via === 'pointer' && !c.committing) moveEdge(at);
        return;
      }
      if (cursorRef.current?.at !== at || cursorRef.current?.via !== 'pointer') setCursor({ at, via: 'pointer' });
    },
    onPointerDown(event) {
      if (event.pointerType === 'touch' || event.button !== 0 || cutRef.current) return;
      trackRef.current.setPointerCapture(event.pointerId);
      begin(timeAt(event.clientX), 'pointer');
    },
    onPointerUp() {
      const c = cutRef.current;
      if (c && c.via === 'pointer' && !c.committing) finishOrCancel();
    },
    onPointerCancel() {
      const c = cutRef.current;
      if (c && c.via === 'pointer') cancel();
    },
    onPointerLeave() {
      if (!cutRef.current && cursorRef.current?.via === 'pointer') setCursor(null);
    },
    onFocus(event) {
      if (event.target !== event.currentTarget || cursorRef.current) return;
      if (event.target.matches(':focus-visible')) setCursor({ at: startCursor(), via: 'keyboard' });
    },
    onBlur() {
      const c = cutRef.current;
      if (c && c.via === 'keyboard') cancel();
      if (cursorRef.current?.via === 'keyboard') setCursor(null);
    },
    onKeyDown(event) {
      const c = cutRef.current;
      if (c?.committing) return;
      const { fromMs, toMs, zone } = opt.current;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        if (c) {
          if (c.via === 'keyboard') moveEdge(clampEdge(stepBy(c.edge, direction, zone)));
          return;
        }
        const next = Math.min(Math.max(stepBy(keyboardAt(), direction, zone), fromMs), toMs - STEP);
        setCursor({ at: next, via: 'keyboard' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!c) begin(keyboardAt(), 'keyboard');
        else if (c.via === 'keyboard') finishOrCancel();
      }
    },
  };

  const zone = options.zone;
  let tab = null;
  if (cut) tab = { at: cut.edge, riding: true, text: `Ends ${clockIn(cut.edge, zone)}, ${lengthText(Math.abs(cut.edge - cut.anchor))}` };
  else if (cursor) tab = { at: cursor.at, riding: false, text: 'Cut here' };

  let spoken = '';
  if (cut?.via === 'keyboard') spoken = `Cut edge at ${typed(cut.edge, zone)}`;
  else if (cursor?.via === 'keyboard') spoken = `Cursor at ${typed(cursor.at, zone)}`;

  return {
    trackRef, handlers, cut, tab, preview, ghost, spoken,
    clearGhost: () => setGhost(null),
    active: cut && cut.anchor !== cut.edge ? { lo: Math.min(cut.anchor, cut.edge), hi: Math.max(cut.anchor, cut.edge) } : null,
  };
}
