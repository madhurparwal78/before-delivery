// The object page (and today's daily note): blocks that merge live edits, quotes with the Margin
// Tether, properties and backlinks in the margin, history, attachments and undo.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, get, NetworkError, type ApiResult } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { announce, clearAlert, COPY, plural, setSaveStatus, showAlert, useFeedback } from '../feedback.ts';
import { Margin, useFrame } from '../Frame.tsx';
import { useLibrary } from '../library.ts';
import { flip, measure, QUIRE_CURVE_CSS, reducedMotion } from '../motion.ts';
import { linkHandler, navigate, takeTransition } from '../router.ts';
import { useSession } from '../session.ts';
import { useSync } from '../sync.ts';
import type { BacklinkJson, BlockJson, BlockSavedEvent, ObjectJson, PresenceEvent } from '../types.ts';
import { BlockDoc } from '../editor/blockDoc.ts';
import { caretRect } from '../editor/dom.ts';
import { TextBlock, type TextBlockHandle } from '../editor/TextBlock.tsx';
import { connectUndo, endTyping, recordAction, recordTyping, redo, remoteTyping, stepCommitted, undo, type Outcome } from '../editor/undo.ts';
import { HistoryDialog } from './HistoryDialog.tsx';
import { Numeral } from './Numeral.tsx';
import { PickerDialog, type PickedBlock } from './PickerDialog.tsx';
import { Properties } from './Properties.tsx';
import { collapseBlock, drawTether, morphCard, retractTether, tetherDrawing, type Morph } from './tether.ts';
import { ARRIVAL_MARK_MS, FADE_MS, GAP_MS, NUMERAL_MS, TETHER_MS, TITLE_MS } from '../../shared/motion.ts';
import { transformOffset, type Op } from '../../shared/ot.ts';
import { editText, plainText } from '../../shared/richtext.ts';
import { dateHeading } from '../../shared/time.ts';
import { storedFilename } from '../../shared/upload.ts';
import '../styles/object.css';

const SAVE_DELAY_MS = 500;
const SAVE_RETRY_MS = 2000;
const PRESENCE_EVERY_MS = 100;
const PICKER_TRIGGER = '((';

const editKeyOf = (b: BlockJson): string => (b.kind === 'quote' && b.origin ? b.origin.block_id : b.id);
const newKey = (): string => `k-${crypto.randomUUID()}`;

interface Presence { label: string; anchor: number; head: number }
interface ConflictState { theirs: string; version: number }
type QuotePhase = { morph: Morph | null; removing: boolean };

/** Today's daily note on the home clock, created if needed. */
export function TodayPage() {
  const [note, setNote] = useState<{ id: string; date: string } | null>(null);
  useEffect(() => {
    void api<{ date: string; object: ObjectJson }>('POST', '/api/daily/today').then((r) => {
      if (r.status === 200 || r.status === 201) setNote({ id: r.data.object.id, date: r.data.date });
    });
  }, []);
  if (!note) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  return <ObjectPage key={note.id} objectId={note.id} todayDate={note.date} />;
}

export function ObjectPage({ objectId, todayDate }: { objectId: string; todayDate?: string }) {
  const frame = useFrame();
  const library = useLibrary();
  const { session } = useSession();
  const feedback = useFeedback();
  const [object, setObject] = useState<ObjectJson | null>(null);
  const [missing, setMissing] = useState(false);
  const [blocks, setBlocks] = useState<BlockJson[]>([]);
  const [backlinks, setBacklinks] = useState<BacklinkJson[]>([]);
  const [tick, setTick] = useState(0);
  const [picker, setPicker] = useState<{ hostId: string; hostKey: string; caret: number } | null>(null);
  const [history, setHistory] = useState<{ key: string; opener: HTMLElement | null } | null>(null);
  const [conflicts, setConflicts] = useState<Map<string, ConflictState>>(new Map());
  const [presence, setPresence] = useState<Map<string, Map<string, Presence>>>(new Map());
  const [shown, setShown] = useState<Map<string, { value: number; roll: boolean; delay: number }>>(new Map());
  const [renaming, setRenaming] = useState(false);
  const [dialog, setDialog] = useState<'delete' | 'collections' | null>(null);
  const [arrivals, setArrivals] = useState<Set<string>>(new Set());
  const [layoutTick, setLayoutTick] = useState(0);

  const docs = useRef(new Map<string, BlockDoc>());
  const handles = useRef(new Map<string, TextBlockHandle>());
  const wrappers = useRef(new Map<string, HTMLElement>());
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const quotes = useRef(new Map<string, QuotePhase>());
  const heldCounts = useRef(new Set<string>());
  const pendingFlip = useRef<Map<string, DOMRect> | null>(null);
  const pendingFocus = useRef<{ id: string; at: number | 'end' } | null>(null);
  const pickerCaret = useRef<{ key: string; at: number } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const blocksRef = useRef<HTMLDivElement>(null);
  const marginLayer = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const transition = useRef(takeTransition());
  const presenceSent = useRef(0);
  const blocksNow = useRef<BlockJson[]>([]);
  blocksNow.current = blocks;
  const isToday = todayDate !== undefined;

  const docFor = useCallback((b: BlockJson): BlockDoc | null => {
    if (b.kind === 'attachment') return null;
    const key = editKeyOf(b);
    let doc = docs.current.get(key);
    if (!doc) {
      doc = new BlockDoc(b.body ?? '', b.version ?? 1);
      docs.current.set(key, doc);
    }
    return doc;
  }, []);

  // --- Loading -------------------------------------------------------------------------------

  const loadBacklinks = useCallback(async () => {
    const r = await get<{ count: number; backlinks: BacklinkJson[] }>(`/api/objects/${objectId}/backlinks`);
    if (r.status === 200) setBacklinks(r.data.backlinks);
  }, [objectId]);

  const load = useCallback(async (initial: boolean) => {
    const r = await get<ObjectJson>(`/api/objects/${objectId}`);
    if (r.status === 404) {
      setMissing(true);
      return;
    }
    if (r.status !== 200) return;
    const fresh = r.data.blocks ?? [];
    for (const b of fresh) {
      const doc = docFor(b);
      if (doc && !doc.dirty && !doc.conflict && (b.version ?? 0) > doc.version) {
        doc.resolve(b.body ?? '', b.version ?? 1);
        handles.current.get(b.id)?.show(doc.body);
      }
    }
    setObject(r.data);
    setBlocks(fresh);
    if (initial) frame.setTopTitle(r.data.daily_date ? dateHeading(r.data.daily_date) : r.data.title);
  }, [objectId, docFor, frame]);

  useEffect(() => {
    void load(true);
    void loadBacklinks();
  }, [load, loadBacklinks]);

  useEffect(() => {
    if (object) frame.setTopTitle(object.daily_date ? dateHeading(object.daily_date) : object.title);
  }, [object, frame]);

  // The daily note reveal or the card-title transition, once the page has its heading.
  const played = useRef(false);
  useLayoutEffect(() => {
    if (played.current || !object || !heading.current) return;
    played.current = true;
    const t = transition.current;
    // The frame already plays the reveal; focus moves to the heading as the note arrives.
    if (t?.reveal) {
      heading.current.focus();
    } else if (t?.titleFrom) {
      const h = heading.current;
      if (reducedMotion()) h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'linear' });
      else {
        const to = h.getBoundingClientRect();
        const scale = t.titleFrom.width / Math.max(1, to.width);
        h.animate([
          { transformOrigin: 'top left', transform: `translate(${t.titleFrom.left - to.left}px, ${t.titleFrom.top - to.top}px) scale(${scale})` },
          { transformOrigin: 'top left', transform: 'none' },
        ], { duration: TITLE_MS, easing: QUIRE_CURVE_CSS });
      }
    }
  }, [object]);

  // --- Saving typing -----------------------------------------------------------------------------

  const sendSave = useCallback(async (key: string): Promise<void> => {
    const doc = docs.current.get(key);
    if (!doc || doc.conflict) return;
    const save = doc.takeSave();
    if (!save) return;
    setSaveStatus(COPY.saving);
    let r: ApiResult<BlockJson & { current?: BlockJson; errors?: Record<string, string> }>;
    try {
      r = await api('PATCH', `/api/blocks/${key}`, save.body !== undefined
        ? { body: save.body, base_version: save.base, edit_id: save.editId }
        : { ops: save.ops, base_version: save.base, edit_id: save.editId });
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      doc.requeue();
      setSaveStatus(COPY.notSaved);
      saveTimers.current.set(key, setTimeout(() => void sendSave(key), SAVE_RETRY_MS));
      return;
    }
    if (r.status === 200) {
      const step = doc.acknowledge(save.editId, r.data.version ?? doc.version, r.data.body ?? '');
      if (step !== null) stepCommitted(step, r.data.version ?? 0);
      if (doc.unsent.length) await sendSave(key);
      else if (!doc.inflight) setSaveStatus(COPY.saved);
    } else if (r.status === 409 && r.data.current) {
      doc.refuse({ body: r.data.current.body ?? '', version: r.data.current.version ?? doc.version });
      setConflicts((m) => new Map(m).set(key, { theirs: r.data.current?.body ?? '', version: r.data.current?.version ?? doc.version }));
      setSaveStatus('');
    } else {
      doc.requeue();
      doc.unsent = [];
      setSaveStatus(COPY.notSaved);
      if (r.data.errors) showAlert(Object.values(r.data.errors)[0] ?? COPY.notSaved);
    }
  }, []);

  const scheduleSave = useCallback((key: string, now = false) => {
    const t = saveTimers.current.get(key);
    if (t) clearTimeout(t);
    if (now) void sendSave(key);
    else saveTimers.current.set(key, setTimeout(() => void sendSave(key), SAVE_DELAY_MS));
  }, [sendSave]);

  /** Sends every unsent edit at once and waits for the saves in flight. */
  const flushAll = useCallback(async () => {
    for (const key of docs.current.keys()) {
      const t = saveTimers.current.get(key);
      if (t) clearTimeout(t);
      await sendSave(key);
    }
  }, [sendSave]);

  // Undo and redo of typing go through the server with the version the step produced.
  useEffect(() => {
    connectUndo(async (blockKey, ops, baseVersion) => {
      try {
        const r = await api<BlockJson>('PATCH', `/api/blocks/${blockKey}`, { ops, base_version: baseVersion });
        if (r.status === 200) {
          const doc = docs.current.get(blockKey);
          if (doc && !doc.dirty && (r.data.version ?? 0) > doc.version) {
            doc.resolve(r.data.body ?? '', r.data.version ?? doc.version);
            const b = blocksNow.current.find((x) => editKeyOf(x) === blockKey);
            if (b) handles.current.get(b.id)?.show(doc.body);
          }
          return { outcome: 'done', version: r.data.version ?? undefined, text: editText(r.data.body ?? '') };
        }
        return { outcome: r.status === 404 ? 'gone' : 'conflict' };
      } catch {
        return { outcome: 'conflict' };
      }
    }, flushAll, (blockKey) => docs.current.get(blockKey)?.text ?? null);
  }, [flushAll]);

  const onTyped = (b: BlockJson) => (ops: Op[], before: string, caretBefore: number, caretAfter: number): string => {
    const doc = docFor(b);
    if (!doc) return '';
    const key = editKeyOf(b);
    const step = recordTyping(key, ops, before, caretBefore, caretAfter, performance.now());
    doc.local(ops, step);
    // Remote carets in this block move through this tab's own typing too.
    setPresence((m) => {
      const inBlock = m.get(key);
      if (!inBlock) return m;
      const next = new Map(m);
      next.set(key, new Map([...inBlock].map(([sid, p]) => [sid, { ...p, anchor: transformOffset(p.anchor, ops), head: transformOffset(p.head, ops) }])));
      return next;
    });
    scheduleSave(key);
    const text = doc.text;
    if (ops.some((o) => 'insert' in o && o.insert.endsWith('(')) && text.slice(Math.max(0, caretAfter - 2), caretAfter) === PICKER_TRIGGER) {
      endTyping();
      setPicker({ hostId: b.id, hostKey: key, caret: caretAfter });
    }
    return doc.body;
  };

  // --- Live sync -----------------------------------------------------------------------------------

  const applyIncoming = useCallback((e: BlockSavedEvent) => {
    const b = e.block;
    const key = editKeyOf(b);
    const doc = docs.current.get(key);
    if (!doc || b.kind === 'attachment') return;
    const handle = handles.current.get(b.id);
    const sel = handle?.selection() ?? null;
    const result = doc.incoming(e.ops, e.base_version, e.edit_id, { body: b.body ?? '', version: b.version ?? doc.version });
    if (result.kind === 'applied') {
      remoteTyping(key, result.ops);
      handle?.show(doc.body, sel ? { anchor: transformOffset(sel.anchor, result.ops), head: transformOffset(sel.head, result.ops) } : null);
      setPresence((m) => {
        const inBlock = m.get(key);
        if (!inBlock) return m;
        const next = new Map(m);
        next.set(key, new Map([...inBlock].map(([sid, p]) => [sid, { ...p, anchor: transformOffset(p.anchor, result.ops), head: transformOffset(p.head, result.ops) }])));
        return next;
      });
    } else if (result.kind === 'replaced') {
      handle?.show(doc.body, sel);
    } else if (result.kind === 'kept') {
      if (doc.conflict) setConflicts((m) => (m.has(key) ? new Map(m).set(key, { theirs: doc.conflict?.body ?? '', version: doc.conflict?.version ?? 0 }) : m));
      // A conflict case: typing not yet sent goes at once with the kept base and meets the 409.
      else if (doc.unsent.length) scheduleSave(key, true);
    } else if (result.kind === 'confirmed') {
      if (result.step !== null) stepCommitted(result.step, b.version ?? 0);
      if (!doc.inflight && !doc.unsent.length) setSaveStatus(COPY.saved);
    } else if (result.kind === 'stale') void load(false);
    setTick((t) => t + 1);
  }, [load, scheduleSave]);

  useSync((event, data) => {
    if (event === 'block.saved') {
      const e = data as BlockSavedEvent;
      const known = blocksNow.current.find((x) => x.id === e.block.id);
      if (known) {
        setBlocks((list) => list.map((x) => (x.id === e.block.id ? { ...e.block } : x)));
        applyIncoming(e);
      } else if (e.object_id === objectId) {
        pendingFlip.current = measure(wrappers.current);
        docFor(e.block);
        setBlocks((list) => (list.some((x) => x.id === e.block.id) ? list : insertAt(list, e.block)));
        setArrivals((s) => new Set(s).add(e.block.id));
        setTimeout(() => setArrivals((s) => {
          const next = new Set(s);
          next.delete(e.block.id);
          return next;
        }), ARRIVAL_MARK_MS);
      }
    } else if (event === 'block.removed') {
      const e = data as { object_id: string; block_id: string };
      if (e.object_id !== objectId || quotes.current.get(e.block_id)?.removing) return;
      if (!blocksNow.current.some((x) => x.id === e.block_id)) return;
      pendingFlip.current = measure(wrappers.current);
      setBlocks((list) => renumber(list.filter((x) => x.id !== e.block_id)));
    } else if (event === 'backlinks.changed') {
      const e = data as { object_id: string; backlinks: number };
      if (e.object_id === objectId) {
        setObject((o) => (o ? { ...o, backlinks: e.backlinks } : o));
        void loadBacklinks();
      }
      if (!heldCounts.current.has(e.object_id)) {
        setBlocks((list) => list.map((x) => (x.origin?.object_id === e.object_id ? { ...x, origin: { ...x.origin, backlinks: e.backlinks } } : x)));
        setShown((m) => (m.has(e.object_id) ? new Map(m).set(e.object_id, { value: e.backlinks, roll: true, delay: 0 }) : m));
      }
    } else if (event === 'object.saved') {
      const e = data as { object_id: string };
      if (e.object_id === objectId || blocksNow.current.some((x) => x.origin?.object_id === e.object_id) || backlinks.some((x) => x.from_object_id === e.object_id)) {
        void load(false);
        void loadBacklinks();
      }
    } else if (event === 'object.removed') {
      const e = data as { object_id: string };
      if (e.object_id === objectId) setMissing(true);
    } else if (event === 'presence.changed') {
      const e = data as PresenceEvent;
      if (e.session_id === session?.session_id) return;
      setPresence((m) => {
        const next = new Map(m);
        const inBlock = new Map(next.get(e.block_id) ?? []);
        if (e.anchor === null || e.head === null) inBlock.delete(e.session_id);
        else inBlock.set(e.session_id, { label: e.label, anchor: e.anchor, head: e.head });
        next.set(e.block_id, inBlock);
        return next;
      });
    } else if (event === 'sync.reset') {
      void load(false);
      void loadBacklinks();
    }
  });

  // Report this tab's caret in the focused block, at most every 100 ms.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const report = () => {
      const active = document.activeElement;
      const b = blocksNow.current.find((x) => handles.current.get(x.id)?.element === active);
      if (!b) return;
      const doc = docs.current.get(editKeyOf(b));
      const sel = handles.current.get(b.id)?.selection();
      if (!doc || !sel || doc.dirty) return;
      presenceSent.current = performance.now();
      void api('POST', `/api/blocks/${editKeyOf(b)}/presence`, { anchor: sel.anchor, head: sel.head, version: doc.version }).catch(() => undefined);
    };
    const onSelection = () => {
      if (timer) return;
      const wait = Math.max(0, PRESENCE_EVERY_MS - (performance.now() - presenceSent.current));
      timer = setTimeout(() => {
        timer = null;
        report();
      }, wait);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // --- Layout: FLIP slides, focus requests, margin chips and tethers ----------------------------------

  useLayoutEffect(() => {
    if (pendingFlip.current) {
      flip(wrappers.current, pendingFlip.current, GAP_MS);
      pendingFlip.current = null;
    }
    if (pendingFocus.current) {
      const { id, at } = pendingFocus.current;
      const h = handles.current.get(id);
      if (h) {
        pendingFocus.current = null;
        h.focusAt(at);
      }
    }
    if (pickerCaret.current && !picker) {
      const { key, at } = pickerCaret.current;
      pickerCaret.current = null;
      const b = blocksNow.current.find((x) => editKeyOf(x) === key);
      if (b) handles.current.get(b.id)?.focusAt(at);
    }
  });

  useEffect(() => {
    const bump = () => setLayoutTick((t) => t + 1);
    const ro = new ResizeObserver(bump);
    if (blocksRef.current) ro.observe(blocksRef.current);
    window.addEventListener('resize', bump);
    void document.fonts.ready.then(bump);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, [object]);

  // --- Block actions -------------------------------------------------------------------------------

  const createBlock = useCallback(async (afterId: string | null, body = ''): Promise<BlockJson | null> => {
    const key = newKey();
    const send = async (): Promise<ApiResult<{ block?: BlockJson; date?: string; object_id?: string } & BlockJson>> => (isToday
      ? api('POST', '/api/daily/today/blocks', { body, after_block_id: afterId }, { headers: { 'Idempotency-Key': key } })
      : api('POST', `/api/objects/${objectId}/blocks`, { body, after_block_id: afterId }));
    let r;
    try {
      r = await send();
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      try {
        r = await send(); // the same key, so the block shows only once
      } catch {
        setSaveStatus(COPY.notSaved);
        return null;
      }
    }
    if (r.status !== 201) {
      setSaveStatus(COPY.notSaved);
      return null;
    }
    const block = isToday ? (r.data.block as BlockJson) : (r.data as BlockJson);
    if (isToday && r.data.object_id && r.data.object_id !== objectId && r.data.date) {
      announce(`Saved to ${dateHeading(r.data.date)}, the new day on your home clock.`);
      navigate(`/o/${r.data.object_id}`, { reveal: true });
      return null;
    }
    docFor(block);
    setBlocks((list) => (list.some((x) => x.id === block.id) ? list : insertAt(list, block)));
    return block;
  }, [isToday, objectId, docFor]);

  const deleteBlockRequest = async (b: BlockJson): Promise<Outcome> => {
    const r = await api<{ quoted_in?: number }>('DELETE', `/api/blocks/${b.id}`);
    if (r.status === 204 || r.status === 200) return 'done';
    if (r.status === 409 && r.data.quoted_in) showAlert(`This block is quoted in ${plural(r.data.quoted_in, 'place')}. Remove those quotes first.`);
    return r.status === 404 ? 'gone' : 'conflict';
  };

  const onEnter = (b: BlockJson) => async () => {
    endTyping();
    await flushAll();
    const created = await createBlock(b.id);
    if (!created) return;
    pendingFocus.current = { id: created.id, at: 0 };
    setTick((t) => t + 1);
    let current = created;
    recordAction({
      name: 'new block',
      undo: async () => {
        const outcome = await deleteBlockRequest(current);
        if (outcome === 'done') removeLocally(current.id);
        return outcome;
      },
      redo: async () => {
        const again = await createBlock(b.id);
        if (!again) return 'conflict';
        current = again;
        return 'done';
      },
    });
  };

  const removeLocally = (id: string) => {
    pendingFlip.current = measure(wrappers.current);
    setBlocks((list) => renumber(list.filter((x) => x.id !== id)));
  };

  const onBackspaceEmpty = (b: BlockJson) => async () => {
    if (b.kind !== 'text') return;
    const index = blocksNow.current.findIndex((x) => x.id === b.id);
    const above = blocksNow.current[index - 1];
    const outcome = await deleteBlockRequest(b);
    if (outcome !== 'done') return;
    removeLocally(b.id);
    if (above && above.kind !== 'attachment') pendingFocus.current = { id: above.id, at: 'end' };
    else addButton.current?.focus();
    endTyping();
    const body = docs.current.get(b.id)?.body ?? '';
    let current: BlockJson | null = null;
    recordAction({
      name: 'block deletion',
      undo: async () => {
        current = await createBlock(above?.id ?? null, body);
        return current ? 'done' : 'conflict';
      },
      redo: async () => {
        if (!current) return 'gone';
        const o = await deleteBlockRequest(current);
        if (o === 'done') removeLocally(current.id);
        return o;
      },
    });
  };

  const addBlock = async () => {
    const last = blocksNow.current[blocksNow.current.length - 1];
    const created = await createBlock(last?.id ?? null);
    if (created) {
      pendingFocus.current = { id: created.id, at: 0 };
      setTick((t) => t + 1);
    }
  };

  // --- Quoting (Margin Tether) ---------------------------------------------------------------------

  const countOf = (originObjectId: string, fallback: number): number => shown.get(originObjectId)?.value ?? fallback;

  /** After the server confirmed a quote: the morph lands, then the tether draws, then the numeral rolls. */
  const playQuoted = (q: BlockJson, morph: Morph | null) => {
    const origin = q.origin;
    if (!origin) return;
    const wait = morph ? morph.remaining() : 0;
    morph?.land();
    const tethered = frame.layout !== 'phone';
    // The margin layer starts the tether once its line is drawn in place.
    if (tethered) pendingTethers.current.set(q.id, wait);
    heldCounts.current.delete(origin.object_id);
    setShown((m) => new Map(m).set(origin.object_id, { value: origin.backlinks, roll: true, delay: wait + (tethered && !reducedMotion() ? TETHER_MS : 0) }));
  };
  const pendingPlays = useRef<Array<{ q: BlockJson; morph: Morph | null }>>([]);
  const pendingTethers = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const plays = pendingPlays.current;
    pendingPlays.current = [];
    for (const p of plays) playQuoted(p.q, p.morph);
  });

  const startQuote = (q: BlockJson, morph: Morph | null, before: number) => {
    const origin = q.origin;
    if (!origin) return;
    heldCounts.current.add(origin.object_id);
    setShown((m) => new Map(m).set(origin.object_id, { value: before, roll: false, delay: 0 }));
    pendingPlays.current.push({ q, morph });
  };

  const quote = async (picked: PickedBlock, row: DOMRect) => {
    const host = picker;
    if (!host) return;
    setPicker(null);
    const hostEl = handles.current.get(host.hostId)?.element ?? null;
    const box = hostEl?.getBoundingClientRect();
    const morph = box && !reducedMotion()
      ? morphCard(row, new DOMRect(box.left, box.bottom + 12, box.width, Math.max(56, row.height)), `${picked.object_title}: ${picked.excerpt}`)
      : null;
    const key = newKey();
    const send = () => api<{ block: BlockJson; origin_backlinks: number }>('POST', `/api/objects/${objectId}/quotes`,
      { origin_block_id: picked.block_id, after_block_id: host.hostId }, { headers: { 'Idempotency-Key': key } });
    let r: ApiResult<{ block: BlockJson; origin_backlinks: number }> | null = null;
    try {
      r = await send();
    } catch {
      try {
        r = await send();
      } catch {
        r = null;
      }
    }
    if (!r || r.status !== 201) {
      await morph?.shrink();
      showAlert(COPY.quoteRefused);
      pickerCaret.current = { key: host.hostKey, at: host.caret };
      setTick((t) => t + 1);
      return;
    }
    const q: BlockJson = { ...r.data.block, origin: r.data.block.origin ? { ...r.data.block.origin, backlinks: r.data.origin_backlinks } : null };
    const origin = q.origin;
    if (!origin) return;
    // The two parentheses leave the host block.
    const hostDoc = docs.current.get(host.hostKey);
    if (hostDoc) {
      const text = hostDoc.text;
      const at = text.slice(host.caret - 2, host.caret) === PICKER_TRIGGER ? host.caret : text.lastIndexOf(PICKER_TRIGGER) + 2;
      if (at >= 2) {
        const ops: Op[] = [...(at - 2 ? [{ retain: at - 2 }] : []), { delete: 2 }, ...(text.length - at ? [{ retain: text.length - at }] : [])];
        hostDoc.local(ops, 0);
        handles.current.get(host.hostId)?.show(hostDoc.body, null);
        scheduleSave(host.hostKey);
      }
    }
    const before = blocksNow.current.some((x) => x.origin?.object_id === origin.object_id)
      ? countOf(origin.object_id, origin.backlinks - 1)
      : origin.backlinks - 1;
    docFor(q);
    startQuote(q, morph, before);
    setBlocks((list) => insertAt(list.filter((x) => x.id !== q.id), q));
    pendingFocus.current = { id: q.id, at: 'end' };
    announce(`Quoted from ${origin.object_title}. ${plural(origin.backlinks, 'backlink')}.`);
    endTyping();
    let current = q;
    recordAction({
      name: 'quote',
      undo: async () => removeQuote(current, true),
      redo: async () => {
        const again = await requote(picked.block_id, host.hostId);
        if (again === 'gone' || again === 'conflict') return again;
        current = again;
        return 'done';
      },
    });
  };

  const requote = async (originBlockId: string, afterId: string | null): Promise<BlockJson | 'gone' | 'conflict'> => {
    const r = await api<{ block: BlockJson; origin_backlinks: number }>('POST', `/api/objects/${objectId}/quotes`,
      { origin_block_id: originBlockId, after_block_id: afterId }, { headers: { 'Idempotency-Key': newKey() } });
    if (r.status !== 201) return r.status === 422 ? 'gone' : 'conflict';
    const q: BlockJson = { ...r.data.block, origin: r.data.block.origin ? { ...r.data.block.origin, backlinks: r.data.origin_backlinks } : null };
    docFor(q);
    if (q.origin) {
      startQuote(q, null, q.origin.backlinks - 1);
      announce(`Quoted from ${q.origin.object_title}. ${plural(q.origin.backlinks, 'backlink')}.`);
    }
    setBlocks((list) => insertAt(list.filter((x) => x.id !== q.id), q));
    return q;
  };

  /** Removes a quote through the server, then plays the Margin Tether in reverse. */
  const removeQuote = async (q: BlockJson, fromUndo = false): Promise<Outcome> => {
    const origin = q.origin;
    if (!origin) return 'gone';
    const index = blocksNow.current.findIndex((x) => x.id === q.id);
    const above = blocksNow.current[index - 1];
    // Marked before the request, so its own live `block.removed` never cuts the reverse motion short.
    const phase = quotes.current.get(q.id) ?? { morph: null, removing: false };
    phase.removing = true;
    quotes.current.set(q.id, phase);
    // A tether still drawing holds where it is until the server answers, so it never runs on past the press.
    const drawing = document.querySelector<SVGElement>(`[data-tether="${q.id}"]`)?.getAnimations().filter((a) => a.playState === 'running') ?? [];
    for (const a of drawing) {
      // Pausing settles at the next frame; setting the time holds it exactly where it is now.
      const at = a.currentTime;
      a.pause();
      a.currentTime = at;
    }
    const refused = (outcome: Outcome): Outcome => {
      phase.removing = false;
      for (const a of drawing) a.play();
      return outcome;
    };
    let r: ApiResult<{ origin_object_id: string; origin_backlinks: number }>;
    try {
      r = await api<{ origin_object_id: string; origin_backlinks: number }>('DELETE', `/api/blocks/${q.id}`);
    } catch {
      return refused('conflict');
    }
    if (r.status !== 200) return refused(r.status === 404 ? 'gone' : 'conflict');
    const count = r.data.origin_backlinks;
    const line = document.querySelector<SVGElement>(`[data-tether="${q.id}"]`);
    heldCounts.current.delete(origin.object_id);
    // Steps not yet started are skipped: a tether still drawing reverses at once, and a numeral that
    // has not rolled yet just shows the server's count.
    if (!tetherDrawing(line) && !reducedMotion()) {
      setShown((m) => new Map(m).set(origin.object_id, { value: count, roll: true, delay: 0 }));
      await new Promise((resolve) => setTimeout(resolve, NUMERAL_MS));
    } else {
      setShown((m) => new Map(m).set(origin.object_id, { value: count, roll: false, delay: 0 }));
    }
    if (line) await retractTether(line);
    const figure = wrappers.current.get(q.id);
    if (figure) await collapseBlock(figure);
    quotes.current.delete(q.id);
    setBlocks((list) => renumber(list.filter((x) => x.id !== q.id)));
    setBlocks((list) => list.map((x) => (x.origin?.object_id === origin.object_id ? { ...x, origin: { ...x.origin, backlinks: count } } : x)));
    announce(`Quote removed. ${origin.object_title} has ${plural(count, 'backlink')}.`);
    if (above && above.kind !== 'attachment') pendingFocus.current = { id: above.id, at: 'end' };
    else addButton.current?.focus();
    if (!fromUndo) {
      endTyping();
      let current: BlockJson = q;
      recordAction({
        name: 'quote removal',
        undo: async () => {
          const again = await requote(origin.block_id, above?.id ?? null);
          if (again === 'gone' || again === 'conflict') return again;
          current = again;
          return 'done';
        },
        redo: async () => removeQuote(current, true),
      });
    }
    return 'done';
  };

  // --- Conflict, restore, rename, properties, sharing, deletion, attachments ------------------------

  const resolveConflict = async (key: string, mine: boolean) => {
    const doc = docs.current.get(key);
    const c = conflicts.get(key);
    const b = blocksNow.current.find((x) => editKeyOf(x) === key);
    if (!doc || !c || !b) return;
    if (mine) {
      const draft = doc.body;
      const r = await api<BlockJson>('PATCH', `/api/blocks/${key}`, { body: draft, base_version: doc.conflict?.version ?? c.version });
      if (r.status === 200) doc.resolve(r.data.body ?? draft, r.data.version ?? c.version);
      else return;
    } else {
      doc.resolve(doc.conflict?.body ?? c.theirs, doc.conflict?.version ?? c.version);
    }
    setConflicts((m) => {
      const next = new Map(m);
      next.delete(key);
      return next;
    });
    handles.current.get(b.id)?.show(doc.body, null);
    pendingFocus.current = { id: b.id, at: 'end' };
    setTick((t) => t + 1);
  };

  const onRestored = (key: string) => (restored: number, block: BlockJson, previous: number) => {
    if (restored < 0) {
      showAlert('This block changed since you opened its history.');
      return;
    }
    const doc = docs.current.get(key);
    if (doc && (block.version ?? 0) > doc.version) {
      doc.resolve(block.body ?? '', block.version ?? doc.version);
      const b = blocksNow.current.find((x) => editKeyOf(x) === key);
      if (b) handles.current.get(b.id)?.show(doc.body, null);
    }
    announce(`Restored version ${restored}. Saved as version ${block.version ?? ''}.`);
    endTyping();
    const restoreTo = async (version: number): Promise<Outcome> => {
      const d = docs.current.get(key);
      const r = await api<BlockJson>('POST', `/api/blocks/${key}/restore`, { version, base_version: d?.version ?? 0 });
      if (r.status !== 200) return r.status === 404 ? 'gone' : 'conflict';
      if (d) {
        d.resolve(r.data.body ?? '', r.data.version ?? d.version);
        const b = blocksNow.current.find((x) => editKeyOf(x) === key);
        if (b) handles.current.get(b.id)?.show(d.body, null);
      }
      return 'done';
    };
    recordAction({ name: 'restore', undo: () => restoreTo(previous), redo: () => restoreTo(restored) });
  };

  const patchObject = async (body: Record<string, unknown>): Promise<ApiResult<ObjectJson & { errors?: Record<string, string> }>> => {
    setSaveStatus(COPY.saving);
    try {
      const r = await api<ObjectJson & { errors?: Record<string, string> }>('PATCH', `/api/objects/${objectId}`, body);
      setSaveStatus(r.status === 200 ? COPY.saved : '');
      if (r.status === 200) setObject((o) => (o ? { ...r.data, blocks: o.blocks } : r.data));
      return r;
    } catch (e) {
      setSaveStatus(COPY.notSaved);
      throw e;
    }
  };

  const upload = async (file: File) => {
    const name = storedFilename(file.name);
    clearAlert();
    setSaveStatus(`Uploading ${name}`);
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const r = await api<BlockJson>('POST', `/api/objects/${objectId}/attachments`, undefined, { form });
      if (r.status === 201) {
        setBlocks((list) => (list.some((x) => x.id === r.data.id) ? list : insertAt(list, r.data)));
        setSaveStatus(`${r.data.attachment?.filename ?? name} saved.`);
        announce(`${r.data.attachment?.filename ?? name} attached to ${object?.title ?? ''}.`);
      } else if (r.status === 503) {
        setSaveStatus(COPY.notSaved);
        showAlert('Storage is unavailable, so this file was not attached.');
        frame.storageFailed();
      } else if (r.status === 413) {
        setSaveStatus('');
        showAlert('That file is too large to attach.');
      } else if (r.status === 415) {
        setSaveStatus('');
        showAlert('Attach an image (PNG, JPEG, GIF, WebP) or a PDF.');
      } else setSaveStatus(COPY.notSaved);
    } catch {
      setSaveStatus(COPY.notSaved);
    }
  };

  // --- Keyboard: undo/redo and the backlink shortcut, anywhere in the text column -----------------

  const focusBacklinks = async () => {
    if (frame.layout === 'phone') await frame.openMargin();
    document.querySelector<HTMLElement>('[aria-label="Backlinks list"] a')?.focus();
  };

  const onColumnKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      void (e.shiftKey ? redo() : undo());
    } else if (e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      void redo();
    } else if (e.altKey && !mod && e.code === 'KeyB') {
      e.preventDefault();
      void focusBacklinks();
    }
  };

  // --- Rendering -------------------------------------------------------------------------------------

  const quoteBlocks = useMemo(() => blocks.filter((b) => b.kind === 'quote' && b.origin), [blocks]);

  if (missing) return <div className="not-found"><h1 tabIndex={-1}>{COPY.notFound}</h1></div>;
  if (!object) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;

  const titleText = object.daily_date ? dateHeading(object.daily_date) : object.title;
  const fields = library.types.find((t) => t.id === object.type_id)?.fields ?? [];
  const quoteCount = backlinks.filter((x) => x.kind === 'quote' && x.from_object_id !== objectId).length;
  const phone = frame.layout === 'phone';

  const chip = (b: BlockJson, inside: boolean) => {
    const origin = b.origin;
    if (!origin) return null;
    const value = countOf(origin.object_id, origin.backlinks);
    return (
      <a
        href={`/o/${origin.object_id}`} className={`origin-chip${inside ? ' inside' : ''}`} data-quote-chip={b.id}
        aria-label={`Quoted from ${origin.object_title}, ${plural(value, 'backlink')}`} onClick={linkHandler(`/o/${origin.object_id}`)}
      >
        <span className="small-caps chip-title">{origin.object_title}</span>
        <Numeral value={value} roll={shown.get(origin.object_id)?.roll ?? true} delay={shown.get(origin.object_id)?.delay ?? 0} />
      </a>
    );
  };

  return (
    <div className="object-page" onKeyDownCapture={onColumnKey}>
      <div className="reading-progress" data-reading-progress="" aria-hidden="true" />
      <header className="object-head">
        <p className="kicker small-caps muted">{object.type_name}</p>
        {renaming ? (
          <RenameBox title={object.title} onDone={async (value) => {
            setRenaming(false);
            if (value !== null && value.trim() && value !== object.title) await patchObject({ title: value });
          }} />
        ) : (
          <h1 ref={heading} tabIndex={-1}>{titleText}</h1>
        )}
        <div className="object-actions">
          {!object.daily_date && !renaming && <button type="button" className="quiet" onClick={() => setRenaming(true)}>Rename</button>}
          <label className="inline-select">
            <span className="small-caps">Sharing</span>
            <select aria-label="Sharing" key={object.share_visibility} defaultValue={object.share_visibility} onChange={(e) => void patchObject({ share_visibility: e.target.value })}>
              <option value="follow">Follow collections</option>
              <option value="never">Never share</option>
            </select>
          </label>
          <button type="button" className="quiet" onClick={() => setDialog('collections')}>Add to collection</button>
          <button type="button" className="quiet" onClick={() => setDialog('delete')}>Delete note</button>
        </div>
      </header>

      <div className="blocks" ref={blocksRef}>
        {object.daily_date && blocks.length === 0 && (
          <div className="empty-day">
            <svg viewBox="0 0 120 28" aria-hidden="true" className="ornament"><path d="M4 22h46M70 22h46M60 24c-6-8-4-16 6-20-3 6-3 12-6 20z" /></svg>
            <p>{COPY.emptyDay}</p>
          </div>
        )}
        {blocks.map((b, i) => {
          const n = i + 1;
          const doc = docFor(b);
          const conflict = conflicts.get(editKeyOf(b));
          const ref = (h: TextBlockHandle | null) => {
            if (h) handles.current.set(b.id, h);
            else handles.current.delete(b.id);
          };
          const wrap = (el: HTMLElement | null) => {
            if (el) wrappers.current.set(b.id, el);
            else wrappers.current.delete(b.id);
          };
          const carets = presence.get(editKeyOf(b));
          const editor = doc && (
            <TextBlock
              ref={ref} label={`Block ${n}`} body={doc.body} onTyped={onTyped(b)} onEnter={() => void onEnter(b)()}
              onPasted={(body) => {
                endTyping();
                doc.replaceLocal(body);
                scheduleSave(editKeyOf(b), true);
              }}
              onBackspaceEmpty={() => void onBackspaceEmpty(b)()} onFocus={() => undefined}
              onBlur={() => scheduleSave(editKeyOf(b), true)}
            />
          );
          const conflictPanel = conflict && doc && (
            <section role="region" aria-label="Edit conflict" className="conflict">
              <p className="conflict-copy">{COPY.conflict}</p>
              <div className="conflict-texts">
                <div><p className="small-caps muted">Other device</p><p>{plainText(doc.conflict?.body ?? conflict.theirs)}</p></div>
                <div><p className="small-caps muted">Your draft</p><p>{plainText(doc.body)}</p></div>
              </div>
              <div className="dialog-actions">
                <button type="button" onClick={() => void resolveConflict(editKeyOf(b), true)}>Keep mine</button>
                <button type="button" onClick={() => void resolveConflict(editKeyOf(b), false)}>Keep theirs</button>
              </div>
            </section>
          );
          const historyButton = (
            <button type="button" className="quiet history-button" aria-label={`History of block ${n}`}
              onClick={(e) => setHistory({ key: editKeyOf(b), opener: e.currentTarget })}>History</button>
          );
          const caretLayer = carets && carets.size > 0 && (
            <RemoteCarets carets={carets} handle={handles.current.get(b.id)} tick={tick + layoutTick} />
          );
          if (b.kind === 'quote' && b.origin) {
            return (
              <div key={b.id} className={`block-wrap${arrivals.has(b.id) ? ' arrived' : ''}`} ref={wrap}>
                {conflictPanel}
                <figure aria-label={`Quote from ${b.origin.object_title}`} className="quote-block">
                  {phone && chip(b, true)}
                  {editor}
                  {caretLayer}
                  <div className="block-tools">
                    {historyButton}
                    <button type="button" className="quiet" onClick={() => void removeQuote(b)}>Remove quote</button>
                  </div>
                </figure>
              </div>
            );
          }
          if (b.kind === 'attachment' && b.attachment) {
            return (
              <div key={b.id} className="block-wrap" ref={wrap}>
                <Attachment block={b} outage={feedback.storage === 'unavailable'} onFailed={frame.storageFailed} />
              </div>
            );
          }
          return (
            <div key={b.id} className={`block-wrap${arrivals.has(b.id) ? ' arrived' : ''}`} ref={wrap}>
              {conflictPanel}
              <div className="text-block">
                {editor}
                {caretLayer}
                <div className="block-tools">{historyButton}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="block-actions">
        <button type="button" ref={addButton} onClick={() => void addBlock()}>Add block</button>
        <button type="button" onClick={() => fileInput.current?.click()}>Attach file</button>
        <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }} />
      </div>

      <Margin>
        <section role="region" aria-label="Properties" className="margin-section">
          <h2 className="margin-head small-caps">Properties</h2>
          <Properties objectId={objectId} fields={fields} values={object.properties} onSave={patchObject} />
        </section>
        <section role="region" aria-label="Backlinks" className="margin-section">
          <h2 className="margin-head small-caps">Backlinks <span className="mono">{object.backlinks}</span></h2>
          <BacklinkList items={backlinks} />
        </section>
        {!phone && (
          <MarginChips quotes={quoteBlocks} wrappers={wrappers.current} tick={layoutTick + tick} layer={marginLayer} chip={(b) => chip(b, false)} pending={pendingTethers.current} />
        )}
      </Margin>

      {picker && (
        <PickerDialog objectId={objectId} onPick={(p, row) => void quote(p, row)} onClose={() => {
          pickerCaret.current = { key: picker.hostKey, at: picker.caret };
          setPicker(null);
        }} />
      )}
      {history && (
        <HistoryDialog
          blockId={history.key} currentVersion={() => docs.current.get(history.key)?.version ?? 1}
          onRestore={onRestored(history.key)} onClose={() => setHistory(null)} returnFocus={() => history.opener}
        />
      )}
      {dialog === 'delete' && (
        <Dialog label="Delete this note?" role="alertdialog" onClose={() => setDialog(null)} describedBy="delete-copy">
          <h2>Delete this note?</h2>
          <p id="delete-copy">{`Deleting removes ${plural(quoteCount, 'quote')} of its blocks from other notes.`}</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setDialog(null)}>Cancel</button>
            <button type="button" className="primary" onClick={async () => {
              const r = await api('DELETE', `/api/objects/${objectId}`);
              if (r.status === 204) navigate('/today');
            }}>Delete</button>
          </div>
        </Dialog>
      )}
      {dialog === 'collections' && (
        <Dialog label="Add to collection" onClose={() => setDialog(null)}>
          <h2>Add to collection</h2>
          <fieldset className="collection-checks">
            {library.collections.map((c) => {
              const member = object.collection_ids.includes(c.id);
              return (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={member} onChange={async () => {
                    const r = member
                      ? await api('DELETE', `/api/collections/${c.id}/objects/${objectId}`)
                      : await api('POST', `/api/collections/${c.id}/objects`, { object_id: objectId });
                    if (r.status === 204) setObject((o) => (o ? { ...o, collection_ids: member ? o.collection_ids.filter((x) => x !== c.id) : [...o.collection_ids, c.id] } : o));
                  }} />
                  {c.name}
                </label>
              );
            })}
          </fieldset>
          <div className="dialog-actions"><button type="button" className="primary" onClick={() => setDialog(null)}>Done</button></div>
        </Dialog>
      )}
      <ProgressRule />
    </div>
  );
}

function insertAt(list: BlockJson[], block: BlockJson): BlockJson[] {
  const next = [...list.filter((x) => x.id !== block.id)];
  next.splice(Math.max(0, Math.min(next.length, block.position - 1)), 0, block);
  return renumber(next);
}

function renumber(list: BlockJson[]): BlockJson[] {
  return list.map((b, i) => (b.position === i + 1 ? b : { ...b, position: i + 1 }));
}

function RenameBox({ title, onDone }: { title: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  return (
    <input ref={input} className="rename" aria-label="Title" value={value} onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          onDone(null);
        }
      }} />
  );
}

function BacklinkList({ items }: { items: BacklinkJson[] }) {
  const onKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('a')];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i === -1) return;
    e.preventDefault();
    links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  if (!items.length) return <p className="muted margin-empty">No backlinks yet.</p>;
  return (
    <ul aria-label="Backlinks list" className="backlinks" onKeyDown={onKey}>
      {items.map((b) => (
        <li key={b.edge_id}>
          <a href={`/o/${b.from_object_id}`} onClick={linkHandler(`/o/${b.from_object_id}`)}>{b.from_title}</a>
          <span className="backlink-kind small-caps muted">{b.kind === 'quote' ? 'quoted' : b.field_name}</span>
        </li>
      ))}
    </ul>
  );
}

/** Origin chips level with their quoted blocks, joined to them by tethers. */
function MarginChips({ quotes, wrappers, tick, layer, chip, pending }: {
  quotes: BlockJson[]; wrappers: Map<string, HTMLElement>; tick: number;
  layer: React.RefObject<HTMLDivElement | null>; chip: (b: BlockJson) => React.ReactNode;
  /** quotes whose tether should draw once its line is in place, with the delay before it starts */
  pending: Map<string, number>;
}) {
  const [pos, setPos] = useState<Map<string, { top: number; x1: number; x2: number }>>(new Map());
  useLayoutEffect(() => {
    const host = layer.current?.parentElement;
    if (!host) return;
    const base = host.getBoundingClientRect();
    const next = new Map<string, { top: number; x1: number; x2: number }>();
    for (const q of quotes) {
      const fig = wrappers.get(q.id)?.querySelector('figure');
      if (!fig) continue;
      const r = fig.getBoundingClientRect();
      next.set(q.id, { top: r.top - base.top, x1: r.left - base.left, x2: parseFloat(getComputedStyle(host).paddingLeft) || 0 });
    }
    const same = next.size === pos.size && [...next].every(([k, v]) => {
      const o = pos.get(k);
      return o && Math.abs(o.top - v.top) < 0.25 && Math.abs(o.x1 - v.x1) < 0.25 && o.x2 === v.x2;
    });
    if (!same) setPos(next);
    for (const [id, delay] of [...pending]) {
      const line = layer.current?.querySelector<SVGElement>(`[data-tether="${id}"]`);
      if (!line) continue;
      pending.delete(id);
      drawTether(line, delay);
    }
  });
  void tick;
  return (
    <div className="chip-layer" ref={layer}>
      <svg className="tethers" aria-hidden="true" focusable="false">
        {quotes.map((q) => {
          const p = pos.get(q.id);
          if (!p) return null;
          const y = Math.round(p.top) + 0.5; // a 1 px line centred on a pixel row stays crisp
          return <line key={q.id} data-tether={q.id} x1={p.x1} y1={y} x2={p.x2} y2={y} pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 0 }} />;
        })}
      </svg>
      {quotes.map((q) => {
        const p = pos.get(q.id);
        return <div key={q.id} className="chip-slot" style={{ top: p ? `${p.top}px` : '0', visibility: p ? 'visible' : 'hidden' }}>{chip(q)}</div>;
      })}
    </div>
  );
}

function RemoteCarets({ carets, handle, tick }: { carets: Map<string, Presence>; handle: TextBlockHandle | undefined; tick: number }) {
  const [spots, setSpots] = useState<Array<{ sid: string; label: string; left: number; top: number; height: number }>>([]);
  useLayoutEffect(() => {
    const el = handle?.element;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const base = parent.getBoundingClientRect();
    const next = [...carets].flatMap(([sid, p]) => {
      const r = caretRect(el, p.head);
      return r ? [{ sid, label: p.label, left: r.left - base.left, top: r.top - base.top, height: r.height }] : [];
    });
    if (JSON.stringify(next) !== JSON.stringify(spots)) setSpots(next);
  });
  void tick;
  return (
    <>
      {spots.map((s) => (
        <span key={s.sid} className="remote-caret" data-remote-caret={s.sid} aria-hidden="true" style={{ left: `${s.left}px`, top: `${s.top}px`, height: `${s.height}px` }}>
          <span className="remote-caret-chip">{s.label}</span>
        </span>
      ))}
    </>
  );
}

function Attachment({ block, outage, onFailed }: { block: BlockJson; outage: boolean; onFailed: () => void }) {
  const a = block.attachment;
  if (!a) return null;
  const isImage = a.content_type.startsWith('image/');
  return (
    <figure aria-label={a.filename} className="attachment">
      {outage ? (
        <p className="attachment-outage">{COPY.attachmentOutage}</p>
      ) : isImage ? (
        <img src={`/api/attachments/${a.id}`} alt={a.filename} onError={onFailed} />
      ) : (
        <a href={`/api/attachments/${a.id}`}>{a.filename}</a>
      )}
      <figcaption className="mono muted">{a.filename}</figcaption>
    </figure>
  );
}

/** The 2-pixel reading-progress rule, scaled by the page scroll in the same frame as the scroll. */
function ProgressRule() {
  useEffect(() => {
    const rule = document.querySelector<HTMLElement>('[data-reading-progress]');
    if (!rule) return;
    let last = '';
    let frame = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      const next = `scaleX(${p})`;
      if (next !== last) rule.style.transform = last = next;
    };
    // Each frame reads the scroll before painting; it writes only when the scroll or the page changed.
    const tick = () => {
      update();
      frame = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);
  return null;
}
