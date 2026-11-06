// The command palette: commands by the published fuzzy score and notes for the latest search.
import { useEffect, useRef, useState } from 'react';
import { api, get, NetworkError } from './api.ts';
import { Dialog } from './Dialog.tsx';
import { announce, plural } from './feedback.ts';
import { navigate, useLocation } from './router.ts';
import { applyTheme, useSession } from './session.ts';
import { paletteCommands, rankCommands, type SnippetSegment } from '../shared/search.ts';

interface NoteHit { object_id: string; title: string; type_name: string; score: number; snippet: SnippetSegment[] }
import { SEARCH_DELAY_MS } from '../shared/motion.ts';

export function Palette({ onNewType }: { onNewType: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  return open ? <PaletteDialog onClose={() => setOpen(false)} onNewType={onNewType} /> : null;
}

function PaletteDialog({ onClose, onNewType }: { onClose: () => void; onNewType: () => void }) {
  const { theme } = useSession();
  const { path } = useLocation();
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState<NoteHit[]>([]);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const latest = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commands = q.trim() === '' ? paletteCommands(theme) : rankCommands(paletteCommands(theme), q);
  const shownNotes = q.trim() === '' ? [] : notes;
  const total = commands.length + shownNotes.length;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const search = (text: string) => {
    latest.current = text;
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim() === '') {
      setNotes([]);
      setError('');
      return;
    }
    timer.current = setTimeout(() => {
      get<{ results: NoteHit[]; errors?: Record<string, string> }>(`/api/search?q=${encodeURIComponent(text)}`).then((r) => {
        if (latest.current !== text) return; // an earlier search answering late is thrown away
        setNotes(r.status === 200 ? r.data.results : []);
        setError(r.status === 200 ? '' : r.data.errors?.q ?? '');
        setActive(0);
      }, (e: unknown) => {
        if (e instanceof NetworkError && latest.current === text) setNotes([]);
      });
    }, SEARCH_DELAY_MS);
  };

  const perform = async (index: number) => {
    if (index < commands.length) {
      const command = commands[index];
      onClose();
      if (command === 'Go to Today') {
        if (path !== '/today') navigate('/today', { reveal: true });
      } else if (command === 'Open graph') navigate('/graph');
      else if (command === 'Open timeline') navigate('/timeline');
      else if (command === 'Open queries') navigate('/queries');
      else if (command === 'Open settings') navigate('/settings');
      else if (command === 'New type') onNewType();
      else {
        const next = command === 'Switch to Lamplight' ? 'lamplight' : 'paper';
        const r = await api<{ theme: 'paper' | 'lamplight' }>('PUT', '/api/settings', { theme: next });
        if (r.status === 200) {
          applyTheme(r.data.theme);
          announce(`Theme set to ${r.data.theme === 'paper' ? 'Paper' : 'Lamplight'}.`);
        }
      }
      return;
    }
    const note = shownNotes[index - commands.length];
    if (!note) return;
    onClose();
    navigate(`/o/${note.object_id}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && total) {
      e.preventDefault();
      setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp' && total) {
      e.preventDefault();
      setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter' && total) {
      e.preventDefault();
      void perform(active);
    }
  };

  return (
    <Dialog label="Command palette" onClose={onClose} className="palette" initialFocus={() => document.getElementById('palette-search')}>
      <input
        id="palette-search" role="combobox" aria-label="Search Quire" aria-expanded="true" aria-controls="palette-results" autoComplete="off"
        aria-activedescendant={total ? `palette-option-${active}` : undefined} aria-describedby={error ? 'palette-error' : undefined}
        placeholder="Search notes or type a command" value={q} onKeyDown={onKey}
        onChange={(e) => {
          setQ(e.target.value);
          search(e.target.value);
        }}
      />
      {error && <p id="palette-error" className="field-error">{error}</p>}
      <div id="palette-results" role="listbox" aria-label="Palette results" className="palette-results">
        <div role="group" aria-labelledby="palette-commands">
          <p id="palette-commands" className="palette-group small-caps muted" role="presentation">Commands</p>
          {commands.map((c, i) => (
            <div key={c} id={`palette-option-${i}`} role="option" aria-selected={i === active} className="option"
              onMouseDown={(e) => e.preventDefault()} onClick={() => void perform(i)}>{c}</div>
          ))}
        </div>
        <div role="group" aria-labelledby="palette-notes">
          <p id="palette-notes" className="palette-group small-caps muted" role="presentation">Notes</p>
          {shownNotes.map((n, j) => {
            const i = commands.length + j;
            return (
              <div key={n.object_id} id={`palette-option-${i}`} role="option" aria-selected={i === active} className="option"
                aria-label={`${n.title}, ${n.type_name}`} aria-describedby={`palette-snippet-${j}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => void perform(i)}>
                <span><span className="option-title-plain">{n.title}</span> <span className="small-caps muted">{n.type_name}</span></span>
                <span id={`palette-snippet-${j}`} className="snippet">
                  {n.snippet.map((s, k) => (s.match ? <mark key={k}>{s.text}</mark> : <span key={k}>{s.text}</span>))}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <p role="status" aria-label="Palette status" className="muted picker-status">{`${plural(commands.length, 'command')}, ${plural(shownNotes.length, 'note')}`}</p>
    </Dialog>
  );
}
