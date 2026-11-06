import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app';
import { announce } from '../lib/announce';
import * as db from '../lib/store';
import { documentPayload } from '../lib/app';
import { Dialog, focusables } from '../components/ui';
import { useIsNarrow, useIsPhone } from '../components/Shell';
import { Star, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { DocumentMeta } from '../../shared/domain';

export function DocumentList() {
  const documents = useApp((s) => s.documents);
  const blocks = useApp((s) => s.blocks);
  const density = useApp((s) => s.density);
  const setDensity = useApp((s) => s.setDensity);
  const savedFilters = useApp((s) => s.savedFilters);
  const saveFilter = useApp((s) => s.saveFilter);
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const newDocument = useApp((s) => s.newDocument);
  const navigate = useNavigate();
  const isNarrow = useIsNarrow();
  const isPhone = useIsPhone();

  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [savedFilterId, setSavedFilterId] = useState('all');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [filterName, setFilterName] = useState('');
  const [filterError, setFilterError] = useState('');
  const saveThisFilterRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const listDocuments = useMemo(
    () => documents.filter((d) => !d.trashed && !d.journal),
    [documents]
  );
  const total = listDocuments.length;

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const d of listDocuments) if (d.folder) set.add(d.folder);
    return [...set].sort();
  }, [listDocuments]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const d of listDocuments) for (const t of d.tags) set.add(t);
    return [...set].sort();
  }, [listDocuments]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listDocuments
      .filter((d) => {
        if (starredOnly && !d.starred) return false;
        if (folder && d.folder !== folder) return false;
        if (tag && !d.tags.includes(tag)) return false;
        if (q) {
          const docBlocks = blocks.filter((b) => b.documentId === d.id);
          const inTitle = d.title.toLowerCase().includes(q);
          const inTags = d.tags.some((t) => t.toLowerCase().includes(q));
          const inText = docBlocks.some((b) => b.text.toLowerCase().includes(q));
          if (!inTitle && !inTags && !inText) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.journal !== b.journal) return a.journal ? 1 : -1;
        // ties in seed order: seed documents come in their published order
        const seedOrder = (d: DocumentMeta) => {
          const idx = SEED_ORDER.indexOf(d.id);
          return idx === -1 ? 9999 : idx;
        };
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
        return seedOrder(a) - seedOrder(b);
      });
  }, [listDocuments, blocks, search, folder, tag, starredOnly]);

  // List count change announcement
  const lastCount = useRef(-1);
  useEffect(() => {
    if (lastCount.current >= 0 && lastCount.current !== shown.length) {
      announce(`Showing ${shown.length} of ${total} documents.`);
    }
    lastCount.current = shown.length;
  }, [shown.length, total]);

  const chooseSavedFilter = (id: string) => {
    setSavedFilterId(id);
    if (id === 'all') {
      setSearch('');
      setFolder(null);
      setTag(null);
      setStarredOnly(false);
      return;
    }
    const f = savedFilters.find((x) => x.id === id);
    if (f) {
      setSearch(f.search);
      setFolder(f.folder);
      setTag(f.tag);
      setStarredOnly(f.starredOnly);
    }
  };

  const doSaveFilter = async () => {
    const name = filterName.trim();
    if (!name) {
      setFilterError('Enter a filter name.');
      nameRef.current?.focus();
      announce('Enter a filter name.');
      return;
    }
    if (savedFilters.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      setFilterError('That filter name is already used.');
      nameRef.current?.focus();
      announce('That filter name is already used.');
      return;
    }
    await saveFilter(name, { search, folder, tag, starredOnly });
    setSavedFilterId(savedFilters[savedFilters.length - 1]?.id ?? 'all');
    setFilterError('');
    setFilterName('');
    setSaveDialogOpen(false);
    saveThisFilterRef.current?.focus();
  };

  const toggleStar = async (doc: DocumentMeta) => {
    const updated = { ...doc, starred: !doc.starred };
    await db.putDocument(updated);
    await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    await reload();
  };

  const moveToTrash = async (doc: DocumentMeta) => {
    const updated = { ...doc, trashed: true };
    await db.putDocument(updated);
    await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    await reload();
    announce(`Moved "${doc.title || 'Untitled'}" to trash.`);
  };

  const createDoc = async () => {
    const id = await newDocument();
    navigate(`/doc/${id}`);
  };

  return (
    <div>
      <div className="heading-row">
        <h1>Documents</h1>
        <button className="button accent-button" onClick={createDoc}>
          <Plus size={18} aria-hidden /> New document
        </button>
      </div>
      <div className="filter-bar" role="search">
        <Search size={18} aria-hidden style={{ alignSelf: 'center' }} />
        <input
          type="search"
          placeholder="Search documents"
          aria-label="Search documents"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Folder filter"
          value={folder ?? ''}
          onChange={(e) => setFolder(e.target.value || null)}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select aria-label="Tag filter" value={tag ?? ''} onChange={(e) => setTag(e.target.value || null)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select aria-label="Saved filter" value={savedFilterId} onChange={(e) => chooseSavedFilter(e.target.value)}>
          <option value="all">All documents</option>
          {savedFilters
            .filter((f) => f.id !== 'all')
            .map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
        </select>
        <button className="button" ref={saveThisFilterRef} onClick={() => setSaveDialogOpen(true)}>
          Save this filter
        </button>
      </div>
      <div className="filter-bar">
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend className="visually-hidden">List density</legend>
          <div role="radiogroup" aria-label="List density" style={{ display: 'flex', gap: 8 }}>
            {(['List', 'Card', 'Grid'] as const).map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={density === d}
                className="button"
                aria-pressed={undefined}
                style={density === d ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined}
                onClick={() => setDensity(d)}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="count-text" role="status" aria-label="Document count">
          {shown.length} of {total} documents
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state paper">
          {total === 0 ? 'No documents yet.' : 'No documents match.'}
        </div>
      ) : density === 'Grid' && !isNarrow ? (
        <div className="grid-density" role="list" aria-label="Documents">
          {shown.map((doc) => (
            <div key={doc.id} role="listitem" className="paper doc-card">
              <DocRow doc={doc} narrow={isPhone} onToggleStar={toggleStar} onTrash={moveToTrash} stacked />
            </div>
          ))}
        </div>
      ) : (
        <div className="paper" role="list" aria-label="Documents">
          {shown.map((doc) => (
            <div key={doc.id} role="listitem" className={density === 'Card' ? 'list-row' : 'list-row'}>
              <DocRow doc={doc} narrow={isPhone} onToggleStar={toggleStar} onTrash={moveToTrash} stacked={density === 'Card'} />
            </div>
          ))}
        </div>
      )}

      {saveDialogOpen && (
        <Dialog
          label="Save filter"
          onClose={() => setSaveDialogOpen(false)}
          initialFocusRef={nameRef}
        >
          <h2>Save filter</h2>
          <div className="field">
            <label htmlFor="filter-name">Filter name</label>
            <input
              id="filter-name"
              ref={nameRef}
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSaveFilter()}
            />
            {filterError && <p className="field-error" role="alert">{filterError}</p>}
          </div>
          <div className="row">
            <button className="button" onClick={() => setSaveDialogOpen(false)}>Close</button>
            <button className="button accent-button" onClick={doSaveFilter}>Save filter</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const SEED_ORDER = [
  'seed-welcome',
  'seed-lisbon',
  'seed-shelf',
  'seed-overview',
  'seed-note-05',
  'seed-note-06',
  'seed-note-07',
  'seed-note-08',
  'seed-note-09',
  'seed-note-10',
  'seed-note-11',
  'seed-note-12',
];

function DocRow({
  doc,
  narrow,
  stacked,
  onToggleStar,
  onTrash,
}: {
  doc: DocumentMeta;
  narrow: boolean;
  stacked?: boolean;
  onToggleStar: (d: DocumentMeta) => void;
  onTrash: (d: DocumentMeta) => void;
}) {
  const title = doc.title || 'Untitled';
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [highlight, setHighlight] = useState(0);

  const menuItems = ['Open', doc.starred ? 'Unstar' : 'Star', 'Move to trash'];

  useEffect(() => {
    if (menuOpen) {
      const el = menuRef.current;
      const first = focusables(el)[0];
      first?.focus();
      setHighlight(0);
    }
  }, [menuOpen]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      openerRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % menuItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + menuItems.length) % menuItems.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(menuItems.length - 1);
    }
  };

  const choose = (item: string) => {
    setMenuOpen(false);
    openerRef.current?.focus();
    if (item === 'Open') {
      navigate(`/doc/${doc.id}`);
    } else if (item === 'Star' || item === 'Unstar') {
      onToggleStar(doc);
    } else if (item === 'Move to trash') {
      onTrash(doc);
    }
  };

  return (
    <>
      <Link className="title-link" to={`/doc/${doc.id}`} style={stacked ? { display: 'block', marginBottom: 4 } : undefined}>
        {title}
      </Link>
      {!narrow && <span className="meta meta-optional">{doc.folder ?? ''}</span>}
      {!narrow && <span className="meta meta-optional">{doc.tags.join(', ')}</span>}
      <span className="meta">{new Date(doc.updatedAt).toLocaleDateString()}</span>
      <button
        className="button"
        aria-pressed={doc.starred}
        aria-label={`Star ${title}`}
        onClick={() => onToggleStar(doc)}
        style={{ padding: '6px 10px' }}
      >
        <Star size={18} aria-hidden fill={doc.starred ? 'currentColor' : 'none'} />
      </button>
      <div style={{ position: 'relative' }}>
        <button
          ref={openerRef}
          className="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Actions for ${title}`}
          onClick={() => setMenuOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
              // handled by click for Enter/Space; arrow opens too
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuOpen(true);
              }
            }
          }}
          style={{ padding: '6px 10px' }}
        >
          <MoreHorizontal size={18} aria-hidden />
        </button>
        {menuOpen && (
          <div className="menu" ref={menuRef} role="menu" aria-label={`Actions for ${title}`} onKeyDown={onMenuKeyDown}>
            {menuItems.map((item, i) => (
              <button
                key={item}
                role="menuitem"
                className={i === highlight ? 'highlighted' : ''}
                aria-selected={i === highlight}
                tabIndex={-1}
                onClick={() => choose(item)}
                onFocus={() => setHighlight(i)}
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
