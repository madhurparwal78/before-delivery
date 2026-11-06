import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { TYPE_CODES, TYPE_LABELS, queueHref } from '../lib/queue-query.jsx';

export function FilterSheet({ viewer, queue, onClose }) {
  const q = queue?.parsedQuery || {};
  const navigate = useNavigate();
  const dialogRef = useRef(null);
  const [type, setType] = useState(q.type || '');
  const [person, setPerson] = useState(q.person || '');
  const [month, setMonth] = useState(q.month || '');

  useEffect(() => {
    const first = dialogRef.current?.querySelector('select, input, button');
    first?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function trapFocus(e) {
    const sheet = dialogRef.current;
    if (!sheet) return;
    const focusables = sheet.querySelectorAll('select, input, button, a[href]');
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function apply() {
    navigate(queueHref({
      state: q.state || 'all',
      type: type || undefined,
      person: person || undefined,
      month: month || undefined,
      q: q.q,
      sort: q.sort,
      page: 1,
    }), { replace: true });
    onClose();
  }

  function clear() {
    setType('');
    setPerson('');
    setMonth('');
    navigate(queueHref({ state: q.state || 'all', page: 1 }), { replace: true });
    onClose();
  }

  const canFilterPerson = viewer.role !== 'employee';
  const people = queue?.scopePeople || [];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-heading"
      className="filter-sheet"
      onKeyDown={trapFocus}
    >
      <h2 id="sheet-heading">Narrow the queue</h2>
      <div className="field">
        <label htmlFor="filter-type">Correction</label>
        <select id="filter-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Any correction</option>
          {TYPE_CODES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      {canFilterPerson && (
        <div className="field">
          <label htmlFor="filter-person">Person</label>
          <select id="filter-person" value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Anyone in scope</option>
            {people.map((p) => (
              <option key={p.id} value={p.work_address}>{p.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="filter-month">Month</label>
        <input
          id="filter-month"
          type="text"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          aria-describedby="filter-month-help"
        />
        <p className="help" id="filter-month-help">Year and month, for example 2026-10</p>
      </div>
      <div className="sheet-actions">
        <button type="button" className="secondary" onClick={apply}>Apply filters</button>
        <button type="button" className="secondary" onClick={clear}>Clear filters</button>
        <button type="button" className="secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
