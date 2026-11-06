import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, blockPayload } from '../lib/app';
import { announce } from '../lib/announce';
import * as db from '../lib/store';
import { TYPE_LABELS, firstChars } from '../lib/util';
import { blockLabel } from './PageBlocks';
import type { Block, Connector, Note } from '../../shared/domain';
import { Plus, Minus, Maximize2, StickyNote } from 'lucide-react';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const CARD_WIDTH = 240;

export function CanvasView({
  docId,
  blocks,
  notes,
  connectors,
  notSynced,
  kept,
  selectedId,
  onSelect,
  onConnect,
  connectFrom,
  setConnectFrom,
  onNewNote,
  onDeleteNote,
}: {
  docId: string;
  blocks: Block[];
  notes: Note[];
  connectors: Connector[];
  notSynced: (id: string) => boolean;
  kept: (id: string) => string[] | undefined;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onConnect: (from: string, to: string) => void;
  connectFrom: string | null;
  setConnectFrom: (id: string | null) => void;
  onNewNote: () => void;
  onDeleteNote: (id: string) => void;
}) {
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const resolveBothKept = useApp((s) => s.resolveBothKept);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; kind: 'block' | 'note'; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchState = useRef<{ dist: number; zoom: number; cx: number; cy: number } | null>(null);

  const readingOrder = useMemo(
    () => [
      ...blocks.map((b) => ({ id: b.id, kind: 'block' as const })),
      ...[...notes].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)).map((n) => ({ id: n.id, kind: 'note' as const })),
    ],
    [blocks, notes]
  );

  // Focus follows the selected block into the view; cards may appear a beat
  // after the switch, when slots have been given, so the focus waits for them.
  const renderedCards = blocks.filter((b) => b.card).length + notes.length;
  useEffect(() => {
    const el = regionRef.current;
    if (!el) return;
    const target = selectedId ?? readingOrder[0]?.id ?? null;
    if (target) {
      const tryFocus = (attempt: number) => {
        const card = el.querySelector<HTMLElement>(`[data-card-id="${target}"]`);
        if (card) {
          card.focus();
        } else if (attempt < 20) {
          requestAnimationFrame(() => tryFocus(attempt + 1));
        }
      };
      requestAnimationFrame(() => tryFocus(0));
    }
  }, [selectedId, renderedCards, readingOrder.length]);

  const moveCard = async (id: string, kind: 'block' | 'note', dx: number, dy: number) => {
    if (kind === 'block') {
      const block = blocks.find((b) => b.id === id);
      if (!block?.card) return;
      const card = { x: block.card.x + dx, y: block.card.y + dy };
      const updated = { ...block, card };
      await db.putBlock(updated);
      await markChange('block', id, docId, false, blockPayload(updated));
      await reload();
      announce(`Moved ${firstChars(block.text, 40) || TYPE_LABELS[block.type]} to ${card.x}, ${card.y}.`);
    } else {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      const card = { x: note.card.x + dx, y: note.card.y + dy };
      const updated = { ...note, card };
      await db.putNote(updated);
      await markChange('note', id, docId, false, updated);
      await reload();
      announce(`Moved ${firstChars(note.text, 40) || 'Note'} to ${card.x}, ${card.y}.`);
    }
  };

  const zoomBy = (factor: number, cx?: number, cy?: number) => {
    const el = regionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    setZoom((z) => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
      setPan((p) => {
        const wx = (px - p.x) / z;
        const wy = (py - p.y) / z;
        return { x: px - wx * next, y: py - wy * next };
      });
      return next;
    });
  };

  const fitToView = () => {
    const el = regionRef.current;
    if (!el) return;
    const items = [...blocks.filter((b) => b.card).map((b) => b.card!), ...notes.map((n) => n.card)];
    if (items.length === 0) return;
    const minX = Math.min(...items.map((c) => c.x));
    const minY = Math.min(...items.map((c) => c.y));
    const maxX = Math.max(...items.map((c) => c.x)) + CARD_WIDTH;
    const maxY = Math.max(...items.map((c) => c.y)) + 120;
    const rect = el.getBoundingClientRect();
    const spare = 40;
    const zx = (rect.width - spare * 2) / (maxX - minX);
    const zy = (rect.height - spare * 2) / (maxY - minY);
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(zx, zy)));
    setZoom(z);
    setPan({ x: spare - minX * z, y: spare - minY * z });
    announce('Fit to view.');
  };

  const onWheel = (e: React.WheelEvent) => {
    const el = regionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, cx, cy);
    } else {
      e.preventDefault();
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const el = regionRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchState.current = {
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom,
        cx: (a.clientX + b.clientX) / 2 - r.left,
        cy: (a.clientY + b.clientY) / 2 - r.top,
      };
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      panState.current = { x: t.clientX, y: t.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const el = regionRef.current;
    if (!el) return;
    if (e.touches.length === 2 && pinchState.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const start = pinchState.current;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (start.zoom * dist) / start.dist));
      const wx = (start.cx - pan.x) / zoom;
      const wy = (start.cy - pan.y) / zoom;
      setZoom(next);
      setPan({ x: start.cx - wx * next, y: start.cy - wy * next });
    } else if (e.touches.length === 1 && panState.current) {
      const t = e.touches[0];
      const start = panState.current;
      setPan({ x: start.panX + (t.clientX - start.x), y: start.panY + (t.clientY - start.y) });
    }
  };

  const onTouchEnd = () => {
    pinchState.current = null;
    panState.current = null;
  };

  const cardPos = (card: { x: number; y: number }) => ({
    left: card.x * zoom + pan.x,
    top: card.y * zoom + pan.y,
  });

  return (
    <div
      ref={regionRef}
      className="canvas-region"
      role="region"
      aria-label="Canvas"
      data-zoom={zoom}
      data-pan-x={pan.x}
      data-pan-y={pan.y}
      tabIndex={0}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onSelect(null);
          setConnectFrom(null);
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          zoomBy(1.25);
        } else if (e.key === '-') {
          e.preventDefault();
          zoomBy(1 / 1.25);
        } else if (e.key === '0') {
          e.preventDefault();
          setZoom(1);
        } else if (e.key === '!' || (e.shiftKey && e.key === '1')) {
          e.preventDefault();
          fitToView();
        } else if (e.key.toLowerCase() === 'n') {
          onNewNote();
        } else if (e.key.startsWith('Arrow') && e.altKey) {
          e.preventDefault();
          const dx = e.key.endsWith('Right') ? 50 : e.key.endsWith('Left') ? -50 : 0;
          const dy = e.key.endsWith('Down') ? 50 : e.key.endsWith('Up') ? -50 : 0;
          setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        }
      }}
    >
      {connectors.map((c) => {
        const from = blocks.find((b) => b.id === c.fromId)?.card;
        const to = blocks.find((b) => b.id === c.toId)?.card;
        if (!from || !to) return null;
        const x1 = from.x * zoom + pan.x + (CARD_WIDTH * zoom) / 2;
        const y1 = from.y * zoom + pan.y + 40;
        const x2 = to.x * zoom + pan.x + (CARD_WIDTH * zoom) / 2;
        const y2 = to.y * zoom + pan.y + 40;
        return (
          <svg
            key={c.id}
            data-connector-id={c.id}
            data-from={c.fromId}
            data-to={c.toId}
            className="connector-line"
            style={{ left: 0, top: 0, width: '100%', height: '100%' }}
          >
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={2} />
          </svg>
        );
      })}
      {blocks
        .filter((b) => b.card)
        .map((b) => {
          const ns = notSynced(b.id);
          const keptValues = kept(b.id);
          const label = firstChars(b.text, 40);
          const name = blockLabel(b, label, ns, !!keptValues);
          const pos = cardPos(b.card!);
          return (
            <button
              key={b.id}
              data-card-id={b.id}
              data-block-id={b.id}
              data-block-type={b.type}
              data-world-x={b.card!.x}
              data-world-y={b.card!.y}
              className={`card ${ns ? 'notched' : ''} ${selectedId === b.id ? 'selected' : ''}`}
              style={{ ...pos, width: CARD_WIDTH * zoom, transformOrigin: 'top left', fontSize: zoom < 0.6 ? '0.8em' : undefined }}
              aria-label={name}
              onClick={() => {
                onSelect(b.id);
                if (connectFrom && connectFrom !== b.id) {
                  onConnect(connectFrom, b.id);
                  setConnectFrom(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (connectFrom && connectFrom !== b.id) {
                    onConnect(connectFrom, b.id);
                    setConnectFrom(null);
                  }
                } else if (e.key === 'Escape') {
                  setConnectFrom(null);
                } else if (e.key === 'c' || e.key === 'C') {
                  setConnectFrom(b.id);
                } else if (e.key.startsWith('Arrow')) {
                  e.preventDefault();
                  const step = e.shiftKey ? 50 : 10;
                  const dx = e.key.endsWith('Right') ? step : e.key.endsWith('Left') ? -step : 0;
                  const dy = e.key.endsWith('Down') ? step : e.key.endsWith('Up') ? -step : 0;
                  void moveCard(b.id, 'block', dx, dy);
                }
              }}
            >
              <strong>{TYPE_LABELS[b.type]}</strong>
              <div>{keptValues ? keptValues.sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))[0] : b.text}</div>
              {keptValues && (
                <div className="both-kept" role="group" aria-label="Both kept" onKeyDown={(e) => e.stopPropagation()}>
                  <p>Both kept. Two devices changed this block. Pick the one to keep.</p>
                  <div className="keep-buttons">
                    {keptValues.map((v) => (
                      <span key={v} role="button" tabIndex={0} onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          resolveBothKept(b.id, v);
                        }
                      }} onClick={() => resolveBothKept(b.id, v)} style={{ cursor: 'pointer' }}>
                        Keep {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          );
        })}
      {notes.map((n) => {
        const pos = cardPos(n.card);
        return (
          <div
            key={n.id}
            data-card-id={n.id}
            data-block-id={n.id}
            data-block-type="note"
            data-world-x={n.card.x}
            data-world-y={n.card.y}
            className={`card note-card ${selectedId === n.id ? 'selected' : ''}`}
            style={pos}
            tabIndex={0}
            role="button"
            aria-label={`Note: ${firstChars(n.text, 40) || 'Note'}`}
            onClick={() => {
              onSelect(n.id);
              if (connectFrom && connectFrom !== n.id) {
                onConnect(connectFrom, n.id);
                setConnectFrom(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !editingNote) {
                e.preventDefault();
                setEditingNote(n.id);
                setTimeout(() => {
                  regionRef.current?.querySelector<HTMLTextAreaElement>(`[data-note-edit="${n.id}"]`)?.focus();
                }, 30);
              } else if (e.key === 'Delete') {
                onDeleteNote(n.id);
              } else if (e.key === 'c' || e.key === 'C') {
                setConnectFrom(n.id);
              } else if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                const step = e.shiftKey ? 50 : 10;
                const dx = e.key.endsWith('Right') ? step : e.key.endsWith('Left') ? -step : 0;
                const dy = e.key.endsWith('Down') ? step : e.key.endsWith('Up') ? -step : 0;
                void moveCard(n.id, 'note', dx, dy);
              }
            }}
            onMouseDown={(e) => {
              dragState.current = { id: n.id, kind: 'note', startX: e.clientX, startY: e.clientY, origX: n.card.x, origY: n.card.y };
            }}
            onMouseUp={(e) => {
              const st = dragState.current;
              if (st && st.id === n.id) {
                const dx = (e.clientX - st.startX) / zoom;
                const dy = (e.clientY - st.startY) / zoom;
                if (dx !== 0 || dy !== 0) void moveCard(n.id, 'note', dx, dy);
              }
              dragState.current = null;
            }}
          >
            {editingNote === n.id ? (
              <textarea
                data-note-edit={n.id}
                value={n.text}
                onChange={(e) => {
                  const t = e.target.value;
                  const updated = { ...n, text: t };
                  void db.putNote(updated);
                  void markChange('note', n.id, docId, false, updated);
                  void reload();
                }}
                onBlur={() => setEditingNote(null)}
                style={{ width: '100%', border: 'none', background: 'transparent', resize: 'vertical', minHeight: 60 }}
                aria-label={`Note: ${firstChars(n.text, 40) || 'Note'}`}
              />
            ) : (
              n.text || <span style={{ color: 'var(--text-muted)' }}>Note</span>
            )}
          </div>
        );
      })}
      <div className="canvas-controls">
        <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus size={18} aria-hidden /></button>
        <span role="status" aria-label="Zoom level">{Math.round(zoom * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={18} aria-hidden /></button>
        <button aria-label="Fit to view" onClick={fitToView}><Maximize2 size={18} aria-hidden /> Fit to view</button>
        <button aria-label="New note" onClick={onNewNote}><StickyNote size={18} aria-hidden /> New note</button>
        {selectedId && (
          <button
            aria-label={`Connect ${firstChars(blocks.find((b) => b.id === selectedId)?.text ?? '', 40) || 'card'}`}
            onClick={() => setConnectFrom(selectedId)}
          >
            Connect
          </button>
        )}
      </div>
    </div>
  );
}
