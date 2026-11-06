import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp, ensureJournalNote, blockPayload } from '../lib/app';
import { announce, announceSaved } from '../lib/announce';
import * as db from '../lib/store';
import { longDate, isoDate, parseIsoDate } from '../lib/util';
import type { Block } from '../../shared/domain';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function JournalScreen() {
  const { date } = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const documents = useApp((s) => s.documents);
  const blocks = useApp((s) => s.blocks);
  const reload = useApp((s) => s.reload);
  const ready = useApp((s) => s.ready);
  const today = isoDate(new Date());
  const current = date ?? today;

  // Opening a day with no note creates it from the Daily note template; moving
  // the calendar highlight does not.
  useEffect(() => {
    if (!ready) return;
    const exists = documents.some((d) => d.id === `journal-${current}`);
    if (!exists && parseIsoDate(current)) {
      void ensureJournalNote(current).then(() => reload());
    }
  }, [ready, current, documents, reload]);

  const noteId = `journal-${current}`;
  const noteBlocks = useMemo(
    () => blocks.filter((b) => b.documentId === noteId).sort((a, b) => a.order - b.order),
    [blocks, noteId]
  );
  const [month, setMonth] = useState(() => {
    const d = parseIsoDate(current) ?? new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  const monthDate = new Date(month.y, month.m, 1);
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const firstWeekday = monthDate.getDay();
  const noteDates = new Set(documents.filter((d) => d.journal).map((d) => d.id.replace('journal-', '')));

  const calendarCells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) calendarCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarCells.push(isoDate(new Date(month.y, month.m, d)));

  const gridRef = useRef<HTMLTableElement>(null);

  const focusDay = (iso: string) => {
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${iso}"]`)?.focus();
  };

  const moveDay = (delta: number) => {
    const d = parseIsoDate(current) ?? new Date();
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta);
    const iso = isoDate(next);
    setMonth({ y: next.getFullYear(), m: next.getMonth() });
    navigate(`/journal/${iso}`);
  };

  const changeMonth = (delta: number) => {
    const next = new Date(month.y, month.m + delta, 1);
    setMonth({ y: next.getFullYear(), m: next.getMonth() });
  };

  const title = parseIsoDate(current) ? longDate(parseIsoDate(current)!) : longDate(new Date());

  return (
    <div className="journal-layout">
      <div className="journal-note" role="region" aria-label="Journal note">
        <div className="sheet">
          <h1 style={{ fontSize: '1.7rem', marginBottom: 12 }}>{title}</h1>
          {noteBlocks.map((block) => (
            <JournalBlock key={block.id} block={block} noteId={noteId} />
          ))}
        </div>
      </div>
      <div className="calendar paper">
        <div className="heading-row">
          <button className="button" aria-label="Previous month" onClick={() => { changeMonth(-1); announce(''); }}>
            <ChevronLeft size={18} aria-hidden />
          </button>
          <strong>
            {monthDate.toLocaleString('en', { month: 'long' })} {month.y}
          </strong>
          <button className="button" aria-label="Next month" onClick={() => { changeMonth(1); announce(''); }}>
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
        <table
          ref={gridRef}
          role="grid"
          aria-label="Calendar"
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter'].includes(e.key)) {
              e.preventDefault();
              if (e.key === 'ArrowLeft') moveDay(-1);
              else if (e.key === 'ArrowRight') moveDay(1);
              else if (e.key === 'ArrowUp') moveDay(-7);
              else if (e.key === 'ArrowDown') moveDay(7);
              else if (e.key === 'PageUp') changeMonth(-1);
              else if (e.key === 'PageDown') changeMonth(1);
              else if (e.key === 'Enter') focusDay(current);
            }
          }}
        >
          <thead>
            <tr>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <th key={i} scope="col" aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]} style={{ fontWeight: 400, fontSize: '0.85rem' }}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.ceil(calendarCells.length / 7) }, (_, r) => (
              <tr key={r} role="row">
                {calendarCells.slice(r * 7, r * 7 + 7).map((iso, c) => (
                  <td key={c} role="gridcell">
                    {iso && (
                      <button
                        data-day={iso}
                        className={`day ${iso === current ? 'today' : ''}`}
                        aria-pressed={iso === current}
                        aria-label={longDate(parseIsoDate(iso)!) + (noteDates.has(iso) ? ', has a note' : '')}
                        onClick={() => navigate(`/journal/${iso}`)}
                        onFocus={() => {
                          // no navigation on focus: moving the highlight does not create
                        }}
                      >
                        {Number(iso.slice(-2))}
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function JournalBlock({ block, noteId }: { block: Block; noteId: string }) {
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const bothKept = useApp((s) => s.bothKept);
  const resolveBothKept = useApp((s) => s.resolveBothKept);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(block.text);
  const keptValues = bothKept.get(block.id);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(block.text);
  }, [block.text]);
  // When the Both kept marker goes, the chosen value replaces any stale draft.
  useEffect(() => {
    if (!keptValues) setDraft(block.text);
  }, [keptValues, block.text]);
  const keptSorted = keptValues
    ? [...keptValues].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0))
    : undefined;

  const update = async (text: string) => {
    const updated = { ...block, text };
    await db.putBlock(updated);
    await markChange('block', block.id, noteId, false, blockPayload(updated));
    const doc = useApp.getState().documents.find((d) => d.id === noteId);
    if (doc) {
      const docUpdated = { ...doc, updatedAt: Date.now() };
      await db.putDocument(docUpdated);
      await useApp.getState().markChange('document', doc.id, doc.id, false, {
        id: doc.id,
        title: doc.title,
        folder: doc.folder,
        tags: doc.tags,
        starred: doc.starred,
        trashed: doc.trashed,
        createdAt: doc.createdAt,
        updatedAt: docUpdated.updatedAt,
        journal: true,
      });
    }
    await reload();
    announceSaved();
  };

  const isTodo = block.type === 'todo';
  const headingLevel = block.type === 'heading2' ? 2 : block.type === 'heading3' ? 3 : undefined;

  return (
    <div
      className={`block-row ${useApp.getState().syncingOn && useApp.getState().outbox.some((e) => e.recordId === block.id) ? 'notched' : ''}`}
      data-block-id={block.id}
      data-block-type={block.type}
      data-indent={block.indent}
    >
      <div className="block-content">
        {isTodo ? (
          <div className="todo-line">
            <input
              type="checkbox"
              aria-label="Done"
              checked={block.checked}
              onChange={() => {
                const updated = { ...block, checked: !block.checked };
                void db.putBlock(updated);
                void markChange('block', block.id, noteId, false, blockPayload(updated));
                void reload();
              }}
            />
            <textarea
              ref={inputRef}
              className="block-text todo"
              data-block-input
              role="textbox"
              aria-label={`To-do: ${block.text.slice(0, 40)}`}
              value={keptSorted ? keptSorted[0] : draft}
              readOnly={!!keptSorted}
              rows={1}
              onChange={(e) => {
                setDraft(e.target.value);
                update(e.target.value);
              }}
            />
          </div>
        ) : headingLevel ? (
          <textarea
            ref={inputRef}
            className={`block-text ${block.type}`}
            data-block-input
            role="textbox"
            aria-label={`Heading: ${block.text.slice(0, 40)}`}
            value={keptSorted ? keptSorted[0] : draft}
            readOnly={!!keptSorted}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value);
              update(e.target.value);
            }}
          />
        ) : (
          <textarea
            ref={inputRef}
            className={`block-text ${block.type}`}
            data-block-input
            role="textbox"
            aria-label={`Paragraph: ${block.text.slice(0, 40)}`}
            value={keptSorted ? keptSorted[0] : draft}
            readOnly={!!keptSorted}
            rows={1}
            onChange={(e) => {
              setDraft(e.target.value);
              update(e.target.value);
            }}
          />
        )}
        {keptSorted && (
          <div className="both-kept" role="group" aria-label="Both kept">
            <p>Both kept. Two devices changed this block. Pick the one to keep.</p>
            <div className="keep-buttons">
              {keptSorted.map((v) => (
                <button key={v} className="button" onClick={() => resolveBothKept(block.id, v)}>
                  Keep {v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
