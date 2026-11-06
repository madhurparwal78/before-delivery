import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { textOf } from '../../domain/blocks.ts';
import { announce as copy, empty, filterFields } from '../../domain/copy.ts';
import { documentBlocks } from '../../domain/materialise.ts';
import type { DocumentRecord } from '../../domain/types.ts';
import { Dialog } from '../components/Dialog.tsx';
import { Menu } from '../components/Menu.tsx';
import { useStore, useViewport } from '../hooks.ts';
import { focusWhenReady } from '../focus.ts';
import { navigate } from '../router.ts';
import { documents } from '../store/actions.ts';
import { ALL_DOCUMENTS, ALL_FOLDERS, ALL_TAGS, type Density, type SavedFilter } from '../store/prefs.ts';
import { announce, setPrefs, snapshot } from '../store/store.ts';

export type ListFilters = { search: string; folder: string; tag: string; starred: boolean };

function listableDocuments(state: ReturnType<typeof snapshot>): DocumentRecord[] {
  const documentsList = [...state.workspace.documents.values()].filter(
    (document) => document.kind === 'document' && !document.trashed,
  );
  documentsList.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.seedOrder - b.seedOrder;
  });
  return documentsList;
}

function searchText(state: ReturnType<typeof snapshot>, document: DocumentRecord): string {
  const blocks = documentBlocks(state.workspace, document.id).map((block) => textOf(block.text));
  return [textOf(document.title), ...document.tags, ...blocks].join(' ').toLowerCase();
}

function updatedDate(iso: string): string {
  return iso.slice(0, 10);
}

export function DocumentList() {
  const state = useStore();
  const viewport = useViewport();
  const [filters, setFilters] = useState<ListFilters>({
    search: '',
    folder: ALL_FOLDERS,
    tag: ALL_TAGS,
    starred: false,
  });
  const [savedChoice, setSavedChoice] = useState(ALL_DOCUMENTS);
  const [saveOpen, setSaveOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement | null>(null);

  const all = listableDocuments(state);
  const folders = state.prefs.folders;
  const tags = [...new Set(all.flatMap((document) => document.tags))].sort();

  const shownDocuments = all.filter((document) => {
    const needle = filters.search.trim().toLowerCase();
    if (needle && !searchText(state, document).includes(needle)) return false;
    if (filters.folder !== ALL_FOLDERS && document.folder !== filters.folder) return false;
    if (filters.tag !== ALL_TAGS && !document.tags.includes(filters.tag)) return false;
    if (filters.starred && !document.starred) return false;
    return true;
  });

  const spoken = useRef('');
  useEffect(() => {
    const sentence = copy.documentCount(shownDocuments.length, all.length);
    if (spoken.current && spoken.current !== sentence) announce(sentence);
    spoken.current = sentence;
  }, [shownDocuments.length, all.length]);

  const chooseSaved = (name: string) => {
    setSavedChoice(name);
    if (name === ALL_DOCUMENTS) {
      setFilters({ search: '', folder: ALL_FOLDERS, tag: ALL_TAGS, starred: false });
      return;
    }
    const saved = state.prefs.savedFilters.find((filter) => filter.name === name);
    if (saved) {
      setFilters({ search: saved.search, folder: saved.folder, tag: saved.tag, starred: saved.starred });
    }
  };

  const openDocument = (documentId: string) => navigate(`/doc/${documentId}?view=page`);

  return (
    <div className="screen">
      <div className="list-controls">
        <button type="button" className="button" onClick={() => void createDocument()}>
          New document
        </button>
        <input
          type="search"
          aria-label="Search documents"
          value={filters.search}
          onChange={(event) => setFilters({ ...filters, search: event.target.value })}
        />
        <label className="inline-field">
          <span className="visually-hidden">Folder filter</span>
          <select
            aria-label="Folder filter"
            value={filters.folder}
            onChange={(event) => setFilters({ ...filters, folder: event.target.value })}
          >
            <option value={ALL_FOLDERS}>{ALL_FOLDERS}</option>
            {folders.map((folder) => (
              <option key={folder} value={folder}>
                {folder}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span className="visually-hidden">Tag filter</span>
          <select
            aria-label="Tag filter"
            value={filters.tag}
            onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
          >
            <option value={ALL_TAGS}>{ALL_TAGS}</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span className="visually-hidden">Saved filter</span>
          <select
            aria-label="Saved filter"
            value={savedChoice}
            onChange={(event) => chooseSaved(event.target.value)}
          >
            <option value={ALL_DOCUMENTS}>{ALL_DOCUMENTS}</option>
            {state.prefs.savedFilters.map((filter) => (
              <option key={filter.name} value={filter.name}>
                {filter.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button" ref={saveButton} onClick={() => setSaveOpen(true)}>
          Save this filter
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="List density"
        className="density"
        onKeyDown={(event) => {
          const order: Density[] = ['List', 'Card', 'Grid'];
          const index = order.indexOf(state.prefs.density);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            setPrefs({ density: order[(index + 1) % order.length] });
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            event.preventDefault();
            setPrefs({ density: order[(index + order.length - 1) % order.length] });
          }
        }}
      >
        {(['List', 'Card', 'Grid'] as Density[]).map((density) => (
          <button
            key={density}
            type="button"
            role="radio"
            aria-checked={state.prefs.density === density}
            tabIndex={state.prefs.density === density ? 0 : -1}
            className="button"
            onClick={() => setPrefs({ density })}
          >
            {density}
          </button>
        ))}
      </div>

      <p role="status" aria-label="Document count" className="count">
        {`${shownDocuments.length} of ${all.length} documents`}
      </p>

      {all.length === 0 && <p className="empty">{empty.noDocuments}</p>}
      {all.length > 0 && shownDocuments.length === 0 && <p className="empty">{empty.noDocumentMatch}</p>}

      <ul aria-label="Documents" className={`documents density-${state.prefs.density.toLowerCase()}`}>
        {shownDocuments.map((document) => {
          const title = textOf(document.title) || 'Untitled';
          const firstLine = textOf(documentBlocks(state.workspace, document.id)[0]?.text ?? { values: [] });
          return (
            <li key={document.id} className="document-row paper">
              <a
                href={`/doc/${document.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  openDocument(document.id);
                }}
              >
                {title}
              </a>
              {state.prefs.density !== 'List' && <span className="row-first-line">{firstLine}</span>}
              {viewport !== 'phone' && (
                <>
                  <span className="row-folder">{document.folder ?? ''}</span>
                  <span className="row-tags">{document.tags.join(', ')}</span>
                </>
              )}
              <span className="row-updated">{updatedDate(document.updatedAt)}</span>
              <button
                type="button"
                className="button icon-button"
                aria-label={`Star ${title}`}
                aria-pressed={document.starred}
                onClick={() => void documents.setStarred(document.id, !document.starred)}
              >
                <Star aria-hidden="true" size={18} />
              </button>
              <span className="row-actions">
                <button
                  type="button"
                  className="button"
                  aria-label={`Actions for ${title}`}
                  aria-haspopup="menu"
                  onClick={() => setMenuFor(menuFor === document.id ? null : document.id)}
                >
                  Actions
                </button>
                {menuFor === document.id && (
                  <Menu
                    name={`Actions for ${title}`}
                    onClose={() => setMenuFor(null)}
                    items={[
                      { label: 'Open', onChoose: () => openDocument(document.id), navigates: true },
                      {
                        label: document.starred ? 'Unstar' : 'Star',
                        onChoose: () => void documents.setStarred(document.id, !document.starred),
                      },
                      {
                        label: 'Move to trash',
                        onChoose: () => {
                          void documents.setTrashed(document.id, true);
                          announce(copy.movedToTrash(title));
                        },
                      },
                    ]}
                  />
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {saveOpen && (
        <SaveFilterDialog
          filters={filters}
          onClose={() => setSaveOpen(false)}
          onSaved={(name) => {
            setSaveOpen(false);
            setSavedChoice(name);
            window.setTimeout(() => saveButton.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}

export async function createDocument(): Promise<void> {
  const made = await documents.create();
  navigate(`/doc/${made.documentId}?view=page&block=${made.blockId}`);
  focusWhenReady('[aria-label="Document title"]');
}

function SaveFilterDialog(props: { filters: ListFilters; onClose: () => void; onSaved: (name: string) => void }) {
  const state = useStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(filterFields.emptyName);
      announce(filterFields.emptyName);
      return;
    }
    if (state.prefs.savedFilters.some((filter) => filter.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(filterFields.nameInUse);
      announce(filterFields.nameInUse);
      return;
    }
    const saved: SavedFilter = { name: trimmed, ...props.filters };
    setPrefs({ savedFilters: [...state.prefs.savedFilters, saved] });
    announce(copy.filterSaved(trimmed));
    props.onSaved(trimmed);
  };

  return (
    <Dialog name="Save filter" onClose={props.onClose}>
      <h2 className="display">Save filter</h2>
      <label className="field">
        <span>Filter name</span>
        <input
          type="text"
          value={name}
          data-autofocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
      </label>
      {error && <p className="field-error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={save}>
          Save filter
        </button>
      </div>
    </Dialog>
  );
}
