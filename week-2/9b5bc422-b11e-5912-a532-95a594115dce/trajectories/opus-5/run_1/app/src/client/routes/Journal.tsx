import { useEffect, useState } from 'react';
import { addDays, addMonths, longDate, monthTitle, todayOnDevice } from '../../domain/format.ts';
import { documentBlocks } from '../../domain/materialise.ts';
import { journalDocumentId } from '../../domain/seed.ts';
import { BlockRow } from '../components/BlockRow.tsx';
import { useStore } from '../hooks.ts';
import { navigate } from '../router.ts';
import { journal } from '../store/actions.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function monthGrid(date: string): string[][] {
  const [year, month] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = addDays(
    `${year}-${String(month).padStart(2, '0')}-01`,
    -first.getUTCDay(),
  );
  const weeks: string[][] = [];
  let cursor = start;
  for (let week = 0; week < 6; week += 1) {
    const days: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(days);
  }
  return weeks;
}

export function Journal(props: { date: string }) {
  const state = useStore();
  const [highlight, setHighlight] = useState(props.date);

  useEffect(() => {
    setHighlight(props.date);
    void journal.open(props.date);
  }, [props.date]);

  const documentId = journalDocumentId(props.date);
  const note = state.workspace.documents.get(documentId);
  const blocks = note ? documentBlocks(state.workspace, documentId) : [];
  const weeks = monthGrid(highlight);
  const [year, month] = highlight.split('-').map(Number);

  const focusDay = (date: string) => {
    setHighlight(date);
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-day="${date}"]`)?.focus();
    }, 0);
  };

  const openDay = (date: string) => {
    void journal.open(date).then(() => {
      navigate(`/journal/${date}`);
      focusDay(date);
    });
  };

  return (
    <div className="screen journal-screen">
      <div role="region" aria-label="Journal note" className="paper sheet journal-note">
        <h1 className="display">{longDate(props.date)}</h1>
        <div className="blocks">
          {blocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              documentId={documentId}
              ordered={blocks}
              onFocus={() => undefined}
            />
          ))}
        </div>
      </div>

      <div className="paper calendar">
        <div className="calendar-head">
          <button type="button" className="button" onClick={() => focusDay(addMonths(highlight, -1))}>
            Previous month
          </button>
          <p className="display">{monthTitle(year, month)}</p>
          <button type="button" className="button" onClick={() => focusDay(addMonths(highlight, 1))}>
            Next month
          </button>
        </div>
        <table role="grid" aria-label="Calendar">
          <thead>
            <tr>
              {WEEKDAYS.map((day) => (
                <th key={day} scope="col" abbr={day}>
                  {day.slice(0, 2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => {
                  const hasNote = state.workspace.documents.has(journalDocumentId(day));
                  const label = `${longDate(day)}${hasNote ? ', has a note' : ''}`;
                  return (
                    <td
                      key={day}
                      role="gridcell"
                      aria-label={label}
                      data-day={day}
                      data-today={day === todayOnDevice() ? 'true' : undefined}
                      data-open={day === props.date ? 'true' : undefined}
                      tabIndex={day === highlight ? 0 : -1}
                      onClick={() => openDay(day)}
                      onKeyDown={(event) => {
                        const keys: Record<string, number> = {
                          ArrowLeft: -1,
                          ArrowRight: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        };
                        if (keys[event.key] !== undefined) {
                          event.preventDefault();
                          focusDay(addDays(day, keys[event.key]));
                          return;
                        }
                        if (event.key === 'PageUp') {
                          event.preventDefault();
                          focusDay(addMonths(day, -1));
                          return;
                        }
                        if (event.key === 'PageDown') {
                          event.preventDefault();
                          focusDay(addMonths(day, 1));
                          return;
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          openDay(day);
                        }
                      }}
                    >
                      {Number(day.slice(8))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
