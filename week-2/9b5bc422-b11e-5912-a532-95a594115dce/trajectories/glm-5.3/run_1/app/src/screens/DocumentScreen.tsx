import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp, blockPayload, documentPayload } from '../lib/app';
import { announce, announceSaved } from '../lib/announce';
import * as db from '../lib/store';
import { Dialog } from '../components/ui';
import { PageBlocks } from './PageBlocks';
import { CanvasView } from './CanvasView';
import { useIsNarrow } from '../components/Shell';
import { uuid, isMac } from '../lib/util';
import type { Block, Note } from '../../shared/domain';
import { Share2, Trash2, Link2, Plus } from 'lucide-react';

export function DocumentScreen() {
  const { documentId } = useParams<{ documentId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNarrow = useIsNarrow();
  const documents = useApp((s) => s.documents);
  const blocks = useApp((s) => s.blocks);
  const notes = useApp((s) => s.notes);
  const connectors = useApp((s) => s.connectors);
  const bothKept = useApp((s) => s.bothKept);
  const outbox = useApp((s) => s.outbox);
  const syncingOn = useApp((s) => s.syncingOn);
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const documentState = useApp((s) => s.documentState);

  const doc = documents.find((d) => d.id === documentId);
  const docBlocks = useMemo(
    () => blocks.filter((b) => b.documentId === documentId).sort((a, b) => a.order - b.order),
    [blocks, documentId]
  );
  const docNotes = useMemo(() => notes.filter((n) => n.documentId === documentId), [notes, documentId]);
  const docConnectors = useMemo(() => connectors.filter((c) => c.documentId === documentId), [connectors, documentId]);

  const view = searchParams.get('view') === 'canvas' ? 'canvas' : 'page';
  const selectedBlockId = searchParams.get('block');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [viewState, setViewState] = useState<'page' | 'dealing' | 'canvas' | 'gathering' | null>(null);
  const [announcedView, setAnnouncedView] = useState<'page' | 'canvas' | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleValueRef = useRef('');

  // A new document opens with focus in the title.
  useEffect(() => {
    if (sessionStorage.getItem('oddment-focus-title') === '1') {
      sessionStorage.removeItem('oddment-focus-title');
      titleRef.current?.focus();
    }
  }, [documentId]);

  // The card slot rule: blocks with no stored position get slots in reading
  // order whenever the document opens in or switches to canvas view.
  useEffect(() => {
    if (view !== 'canvas' || !doc) return;
    const unpositioned = docBlocks.filter((b) => !b.card);
    if (unpositioned.length === 0) return;
    const positioned = docBlocks.filter((b) => b.card);
    const right = positioned.length > 0 ? Math.max(...positioned.map((b) => b.card!.x)) + 280 : 0;
    void (async () => {
      for (let i = 0; i < unpositioned.length; i++) {
        const col = Math.floor(i / 5);
        const row = i % 5;
        const card = { x: right + 280 * col, y: 200 * row };
        const updated = { ...unpositioned[i], card };
        await db.putBlock(updated);
        // A slot is a syncable change but not a content change.
        await markChange('block', updated.id, documentId!, false, blockPayload(updated));
      }
      await reload();
    })();
  }, [view, documentId, docBlocks.length, doc?.id]);

  // Announcement after a switch completes
  useEffect(() => {
    if (announcedView && (viewState === 'canvas' || viewState === 'page')) {
      if (announcedView === 'canvas') {
        const count = docBlocks.length + docNotes.length;
        announce(`Canvas view. ${count} cards.`);
      } else {
        announce(`Page view. ${docBlocks.length} blocks.`);
      }
      setAnnouncedView(null);
    }
  }, [viewState, announcedView, docBlocks.length, docNotes.length]);

  const switchView = () => {
    if (!doc) return;
    const target = view === 'page' ? 'canvas' : 'page';
    const focusId = selectedBlockId ?? docBlocks[0]?.id ?? null;
    const next = new URLSearchParams();
    next.set('view', target);
    if (focusId) next.set('block', focusId);
    setSearchParams(next);
    if (target === 'canvas') {
      setViewState('dealing');
      setAnnouncedView('canvas');
    } else {
      setViewState('gathering');
      setAnnouncedView('page');
    }
  };

  // After a switch to the page, focus goes to the selected block.
  const lastView = useRef(view);
  useEffect(() => {
    if (view === 'page' && lastView.current !== 'page') {
      const target = selectedBlockId ?? docBlocks[0]?.id ?? null;
      if (target) {
        const tryFocus = (attempt: number) => {
          const el = document.querySelector<HTMLElement>(`[data-block-id="${target}"] [data-block-input]`);
          if (el) {
            el.focus();
          } else if (attempt < 20) {
            requestAnimationFrame(() => tryFocus(attempt + 1));
          }
        };
        requestAnimationFrame(() => tryFocus(0));
      }
    }
    lastView.current = view;
  }, [view, selectedBlockId, docBlocks]);

  // The Deal finishes into canvas; the Gather finishes into page.
  useEffect(() => {
    if (viewState === 'dealing') {
      const t = setTimeout(() => setViewState('canvas'), 700);
      return () => clearTimeout(t);
    }
    if (viewState === 'gathering') {
      const t = setTimeout(() => setViewState('page'), 700);
      return () => clearTimeout(t);
    }
  }, [viewState]);

  // Mod+Shift+C switches views from any control in the document view.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        switchView();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (!doc || doc.trashed || doc.journal) {
    if (doc && doc.journal) {
      navigate(`/journal/${doc.id.replace('journal-', '')}`, { replace: true });
      return null;
    }
    return (
      <div className="empty-state paper" style={{ maxWidth: 480, margin: '48px auto' }}>
        <h1>We could not find that document.</h1>
        <p><a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>Back to documents</a></p>
      </div>
    );
  }

  const notSynced = (blockId: string) => syncingOn && outbox.some((e) => e.recordId === blockId);
  const kept = (blockId: string) => bothKept.get(blockId);

  // The title keeps its own draft so typing never races the store; it is
  // written durably within a second after typing stops.
  const updateTitle = (value: string) => {
    setTitleDraft(value);
    titleValueRef.current = value;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      titleTimer.current = null;
      const d = useApp.getState().documents.find((x) => x.id === documentId);
      if (!d) return;
      const updated = { ...d, title: titleValueRef.current, updatedAt: Date.now() };
      await db.putDocument(updated);
      await markChange('document', d.id, d.id, false, documentPayload(updated));
      await reload();
      setTitleDraft(null);
      announceSaved();
    }, 800);
  };

  const effectiveTitle = titleDraft ?? doc.title;

  const inspector = (
    <Inspector
      doc={doc}
      liveTitle={effectiveTitle}
      onClose={() => setInspectorOpen(false)}
      isNarrow={isNarrow}
      onShare={() => setShareOpen(true)}
    />
  );

  const showInspectorPage = view === 'page' && !isNarrow ? true : isNarrow ? inspectorOpen : true;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="heading-row">
          <button
            className="button"
            aria-pressed={view === 'canvas'}
            onClick={switchView}
            data-view-control="true"
          >
            Switch view
          </button>
          <span className="count-text" role="group" aria-label="Document state">
            {documentState(doc.id)}
          </span>
        </div>
        <div
          ref={tableRef}
          role="region"
          aria-label="Table"
          data-view-state={viewState ?? view}
          className="table-surface"
        >
          {view === 'page' ? (
            <div className="sheet">
              <textarea
                ref={titleRef}
                className="block-text heading1"
                aria-label="Document title"
                placeholder="Untitled"
                value={effectiveTitle}
                onChange={(e) => updateTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const first = docBlocks[0];
                    if (first) {
                      const el = document.querySelector<HTMLElement>(`[data-block-id="${first.id}"] [data-block-input]`);
                      el?.focus();
                    }
                  }
                }}
                rows={1}
                style={{ width: '100%', border: 'none', background: 'transparent', resize: 'none', fontWeight: 700 }}
              />
              {doc.title === '' && (
                <span className="visually-hidden">Untitled</span>
              )}
              <PageBlocks
                docId={doc.id}
                blocks={docBlocks}
                notSynced={notSynced}
                kept={kept}
                onFocusBlock={(blockId) => {
                  const next = new URLSearchParams();
                  next.set('view', 'page');
                  next.set('block', blockId);
                  setSearchParams(next, { replace: true });
                }}
              />
              <button
                className="button"
                style={{ marginTop: 8 }}
                onClick={() => addBlockAtEnd(doc.id, docBlocks, markChange, reload)}
              >
                <Plus size={18} aria-hidden /> Add block
              </button>
            </div>
          ) : (
            <CanvasView
              docId={doc.id}
              blocks={docBlocks}
              notes={docNotes}
              connectors={docConnectors}
              notSynced={notSynced}
              kept={kept}
              selectedId={selectedBlockId}
              onSelect={(id) => {
                const next = new URLSearchParams();
                next.set('view', 'canvas');
                if (id) next.set('block', id);
                setSearchParams(next);
              }}
              onConnect={(from, to) => void addConnector(doc.id, from, to, markChange, reload)}
              connectFrom={connectFrom}
              setConnectFrom={setConnectFrom}
              onNewNote={() => void addNote(doc.id, markChange, reload)}
              onDeleteNote={(id) => void deleteNote(id, markChange, reload)}
            />
          )}
        </div>
      </div>
      {view === 'page' && showInspectorPage && (
        isNarrow ? (
          inspectorOpen && (
            <div className="inspector-sheet">
              <div className="dialog-backdrop">
                <div className="dialog" role="dialog" aria-modal="true" aria-label="Inspector">
                  {inspector}
                </div>
              </div>
            </div>
          )
        ) : (
          <aside className="paper" style={{ width: 280, flex: '0 0 280px' }} role="complementary" aria-label="Inspector">
            {inspector}
          </aside>
        )
      )}
      {view === 'canvas' && (
        <button className="button" onClick={() => setInspectorOpen(true)}>
          Open inspector
        </button>
      )}
      {shareOpen && <ShareDialog doc={doc} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

async function addBlockAtEnd(
  documentId: string,
  blocks: Block[],
  markChange: (kind: string, id: string, doc: string | null, del: boolean, payload: unknown) => Promise<void>,
  reload: () => Promise<void>
): Promise<void> {
  const id = uuid();
  const order = blocks.length > 0 ? Math.max(...blocks.map((b) => b.order)) + 1 : 0;
  const block: Block = { id, documentId, type: 'paragraph', text: '', indent: 0, checked: false, order };
  await db.putBlock(block);
  await markChange('block', id, documentId, false, blockPayload(block));
  await reload();
  const doc2 = useApp.getState().documents.find((d) => d.id === documentId);
  if (doc2) {
    const updated = { ...doc2, updatedAt: Date.now() };
    await db.putDocument(updated);
    await markChange('document', documentId, documentId, false, documentPayload(updated));
    await reload();
  }
  setTimeout(() => {
    document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-block-input]`)?.focus();
  }, 50);
}

async function addConnector(
  documentId: string,
  from: string,
  to: string,
  markChange: (kind: string, id: string, doc: string | null, del: boolean, payload: unknown) => Promise<void>,
  reload: () => Promise<void>
): Promise<void> {
  // connecting a joined pair removes the connector
  const existing = useApp.getState().connectors.find(
    (c) => c.documentId === documentId && ((c.fromId === from && c.toId === to) || (c.fromId === to && c.toId === from))
  );
  if (existing) {
    await db.deleteConnector(existing.id);
    await markChange('connector', existing.id, documentId, true, null);
    announce('Connection removed.');
  } else {
    const id = uuid();
    const connector = { id, documentId, fromId: from, toId: to };
    await db.putConnector(connector);
    await markChange('connector', id, documentId, false, connector);
    announce('Connected.');
  }
  await reload();
}

async function addNote(
  documentId: string,
  markChange: (kind: string, id: string, doc: string | null, del: boolean, payload: unknown) => Promise<void>,
  reload: () => Promise<void>
): Promise<void> {
  const id = uuid();
  const note: Note = { id, documentId, text: '', card: { x: 40, y: 40 }, order: Date.now(), createdAt: Date.now() };
  await db.putNote(note);
  await markChange('note', id, documentId, false, note);
  await reload();
}

async function deleteNote(
  id: string,
  markChange: (kind: string, id: string, doc: string | null, del: boolean, payload: unknown) => Promise<void>,
  reload: () => Promise<void>
): Promise<void> {
  const note = useApp.getState().notes.find((n) => n.id === id);
  await db.deleteNote(id);
  await markChange('note', id, note?.documentId ?? null, true, null);
  await reload();
}

function newFolderName(existing: string[]): string {
  const names = new Set(existing);
  if (!names.has('New folder')) return 'New folder';
  let n = 2;
  while (names.has(`New folder ${n}`)) n += 1;
  return `New folder ${n}`;
}

function Inspector({
  doc,
  liveTitle,
  onClose,
  isNarrow,
  onShare,
}: {
  doc: import('../../shared/domain').DocumentMeta;
  liveTitle: string;
  onClose: () => void;
  isNarrow: boolean;
  onShare: () => void;
}) {
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const navigate = useNavigate();
  const documents = useApp((s) => s.documents);
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) if (d.folder) set.add(d.folder);
    return [...set].sort();
  }, [documents]);

  const update = async (patch: Partial<typeof doc>) => {
    const updated = { ...doc, ...patch, updatedAt: Date.now() };
    await db.putDocument(updated);
    await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    await reload();
  };

  const moveToTrash = async () => {
    const titled = { ...doc, title: liveTitle };
    const updated = { ...titled, trashed: true, updatedAt: Date.now() };
    await db.putDocument(updated);
    await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    await reload();
    announce(`Moved "${liveTitle || 'Untitled'}" to trash.`);
    navigate('/');
  };

  return (
    <div>
      {isNarrow && (
        <button className="button" onClick={onClose}>
          Close inspector
        </button>
      )}
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="doc-tags">Tags</label>
        <input
          id="doc-tags"
          value={doc.tags.join(', ')}
          onChange={(e) =>
            update({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
          }
        />
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="doc-folder">Folder</label>
        <select
          id="doc-folder"
          value={doc.folder ?? ''}
          onChange={(e) => update({ folder: e.target.value || null })}
        >
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>
      <button className="button" style={{ marginBottom: 8 }} onClick={() => update({ folder: newFolderName(folders) })}>
        New folder
      </button>
      <button className="button" style={{ marginRight: 8, marginBottom: 8 }} onClick={() => update({ starred: !doc.starred })}>
        Star this document
      </button>
      <button className="button" style={{ marginRight: 8, marginBottom: 8 }} onClick={onShare}>
        <Share2 size={18} aria-hidden /> Share
      </button>
      <button className="button" onClick={moveToTrash}>
        <Trash2 size={18} aria-hidden /> Move to trash
      </button>
    </div>
  );
}

function ShareDialog({ doc, onClose }: { doc: import('../../shared/domain').DocumentMeta; onClose: () => void }) {
  const signedIn = useApp((s) => s.signedIn);
  const syncingOn = useApp((s) => s.syncingOn);
  const [share, setShare] = useState<{ token: string; url: string; expiresAt: string } | null>(null);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (signedIn && syncingOn) {
      void fetch(`/api/documents/${doc.id}/share`)
        .then((r) => r.json())
        .then((b) => setShare(b.share))
        .catch(() => setError('We could not reach the server. Nothing has changed on this device.'));
    }
  }, [doc.id, signedIn, syncingOn]);

  const createLink = async (regen: boolean) => {
    setPending('Creating link...');
    try {
      const res = await fetch(`/api/documents/${doc.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (res.ok) {
        const body = await res.json();
        setShare(body);
        announce(regen ? 'New link created. The old link no longer works.' : 'Link created.');
      } else {
        const b = await res.json().catch(() => ({}));
        setError(b.errors?.form ?? 'We could not reach the server. Nothing has changed on this device.');
      }
    } catch {
      setError('We could not reach the server. Nothing has changed on this device.');
    } finally {
      setPending('');
    }
  };

  const revoke = async () => {
    setPending('Removing...');
    try {
      const res = await fetch(`/api/documents/${doc.id}/share`, { method: 'DELETE' });
      if (res.ok) {
        setShare(null);
        announce('Link revoked.');
      }
    } finally {
      setPending('');
    }
  };

  const copy = async () => {
    if (share) {
      await navigator.clipboard.writeText(share.url).catch(() => {});
      announce('Link copied.');
    }
  };

  const notOnAccount = signedIn && syncingOn && useApp.getState().outbox.some((e) => e.recordId === doc.id);

  return (
    <Dialog label="Share" onClose={onClose}>
      <h2>Share</h2>
      {!signedIn ? (
        <p>Sign in to share this document.</p>
      ) : notOnAccount ? (
        <p>Sync this document before sharing it.</p>
      ) : (
        <>
          {error && <p className="field-error">{error}</p>}
          {!share ? (
            <button className="button accent-button" disabled={!!pending} onClick={() => createLink(false)}>
              {pending === 'Creating link...' ? 'Creating link...' : 'Create link'}
            </button>
          ) : (
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="share-link">Share link</label>
              <input id="share-link" readOnly value={share.url} />
            </div>
          )}
          <div className="row">
            {share && (
              <>
                <button className="button" onClick={copy}>
                  <Link2 size={18} aria-hidden /> Copy link
                </button>
                <button className="button" disabled={!!pending} onClick={() => createLink(true)}>
                  New link
                </button>
                <button className="button" disabled={!!pending} onClick={revoke}>
                  {pending === 'Removing...' ? 'Removing...' : 'Revoke link'}
                </button>
              </>
            )}
            <button className="button" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Dialog>
  );
}
