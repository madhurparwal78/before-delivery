import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp, blockPayload, documentPayload } from '../lib/app';
import { announce, announceSaved } from '../lib/announce';
import * as db from '../lib/store';
import { TYPE_LABELS, firstChars, uuid } from '../lib/util';
import { SLASH_OPTIONS, BLOCK_TYPE_LABELS } from '../../shared/domain';
import type { Block, BlockType } from '../../shared/domain';
import { GripVertical } from 'lucide-react';

const DEPTH_MAX = 2;

export function PageBlocks({
  docId,
  blocks,
  notSynced,
  kept,
  onFocusBlock,
}: {
  docId: string;
  blocks: Block[];
  notSynced: (id: string) => boolean;
  kept: (id: string) => string[] | undefined;
  onFocusBlock?: (blockId: string) => void;
}) {
  const markChange = useApp((s) => s.markChange);
  const reload = useApp((s) => s.reload);
  const attachments = useApp((s) => s.attachments);
  const tables = useApp((s) => s.tables);
  const [slashFor, setSlashFor] = useState<string | null>(null);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [dragId, setDragId] = useState<string | null>(null);

  const filteredOptions = SLASH_OPTIONS.filter((opt) =>
    slashFilter === ''
      ? true
      : BLOCK_TYPE_LABELS[opt].toLowerCase().split(' ').some((w) => w.startsWith(slashFilter.toLowerCase()))
  );

  const persist = async (block: Block) => {
    await db.putBlock(block);
    await markChange('block', block.id, docId, false, blockPayload(block));
    const doc = useApp.getState().documents.find((d) => d.id === docId);
    if (doc) {
      const updated = { ...doc, updatedAt: Date.now() };
      await db.putDocument(updated);
      await markChange('document', doc.id, doc.id, false, documentPayload(updated));
    }
    await reload();
  };

  const focusBlock = (id: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-block-input]`)?.focus();
    });
  };

  const updateText = async (block: Block, text: string) => {
    await persist({ ...block, text });
    announceSaved();
  };

  const changeType = async (block: Block, type: BlockType) => {
    await persist({ ...block, type, text: '' });
    if (type === 'divider' || type === 'table') {
      const newId = uuid();
      let newBlock: Block;
      if (type === 'table') {
        const tableId = await createTable(markChange, reload);
        newBlock = { id: newId, documentId: docId, type: 'paragraph', text: '', indent: 0, checked: false, order: block.order + 0.5, tableId };
      } else {
        newBlock = { id: newId, documentId: docId, type: 'paragraph', text: '', indent: 0, checked: false, order: block.order + 0.5 };
      }
      await db.putBlock(newBlock);
      await markChange('block', newId, docId, false, blockPayload(newBlock));
      await reload();
      focusBlock(newId);
    } else if (type === 'image' || type === 'file') {
      await reload();
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-block-id="${block.id}"] input[type="file"]`)?.focus();
      });
    } else {
      await reload();
      focusBlock(block.id);
    }
  };

  const insertAfter = async (block: Block, type: BlockType = 'paragraph', indent: 0 | 1 | 2 = 0) => {
    const id = uuid();
    const after = blocks.filter((b) => b.order > block.order);
    const nextOrder = after.length > 0 ? (Math.min(...after.map((b) => b.order)) + block.order) / 2 : block.order + 1;
    const newBlock: Block = { id, documentId: docId, type, text: '', indent, checked: false, order: nextOrder };
    await db.putBlock(newBlock);
    await markChange('block', id, docId, false, blockPayload(newBlock));
    await reload();
    focusBlock(id);
    return id;
  };

  const deleteBlock = async (block: Block) => {
    const above = blocks.filter((b) => b.order < block.order).sort((a, b) => b.order - a.order)[0];
    await db.deleteBlock(block.id);
    await markChange('block', block.id, docId, true, null);
    await reload();
    if (above) focusBlock(above.id);
  };

  const indent = async (block: Block, dir: 1 | -1) => {
    const isList = block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo';
    if (!isList) return;
    const current = block.indent;
    if (dir === 1) {
      const isFirst = blocks.filter((b) => b.type === block.type).every((b) => b.order >= block.order);
      if (isFirst || current >= DEPTH_MAX) return;
      await persist({ ...block, indent: (current + 1) as 0 | 1 | 2 });
      announce('Indented.');
    } else {
      if (current === 0) return;
      await persist({ ...block, indent: (current - 1) as 0 | 1 | 2 });
      announce('Outdented.');
    }
  };

  const moveBlock = async (block: Block, dir: -1 | 1) => {
    const sorted = [...blocks].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((b) => b.id === block.id);
    const target = sorted[idx + dir];
    if (!target) return;
    const blockOrder = block.order;
    await persist({ ...block, order: target.order });
    await persist({ ...target, order: blockOrder });
    await reload();
    focusBlock(block.id);
    const newPosition = sorted.findIndex((b) => b.id === block.id) + 1;
    announce(`Moved block to position ${dir === 1 ? newPosition : idx + 1}.`);
  };

  const reorder = async (dragId: string, targetId: string) => {
    const dragged = blocks.find((b) => b.id === dragId);
    const target = blocks.find((b) => b.id === targetId);
    if (!dragged || !target || dragged.id === target.id) return;
    const sorted = [...blocks].sort((a, b) => a.order - b.order);
    const targetIdx = sorted.findIndex((b) => b.id === targetId);
    const newOrder = targetIdx === sorted.length - 1 ? target.order + 1 : (target.order + sorted[targetIdx + 1].order) / 2;
    await persist({ ...dragged, order: newOrder });
    await reload();
    const newPosition = [...blocks]
      .filter((b) => b.id !== dragId)
      .concat({ ...dragged, order: newOrder })
      .sort((a, b) => a.order - b.order)
      .findIndex((b) => b.id === dragId) + 1;
    announce(`Moved block to position ${newPosition}.`);
  };

  return (
    <div>
      {blocks.map((block) => {
        const label = firstChars(block.text, 40) || (block.type === 'table' ? tables.find((t) => t.id === block.tableId)?.name ?? '' : '') || (block.attachmentId ? attachments.find((a) => a.id === block.attachmentId)?.name ?? '' : '');
        const ns = notSynced(block.id);
        const keptValues = kept(block.id);
        const name = blockLabel(block, label, ns, !!keptValues);
        return (
          <div
            key={block.id}
            className={`block-row ${ns ? 'notched' : ''}`}
            data-block-id={block.id}
            data-block-type={block.type}
            data-indent={block.indent}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={(e) => {
              if (dragId) {
                e.preventDefault();
                void reorder(dragId, block.id);
                setDragId(null);
              }
            }}
          >
            <button
              className="block-handle"
              aria-label={`Move block`}
              draggable
              onDragStart={() => setDragId(block.id)}
              onClick={() => {}}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp') {
                  e.preventDefault();
                  void moveBlock(block, -1);
                }
                if (e.altKey && e.key === 'ArrowDown') {
                  e.preventDefault();
                  void moveBlock(block, 1);
                }
              }}
            >
              <GripVertical size={16} aria-hidden />
            </button>
            <div className="block-content">
              {block.type === 'divider' ? (
                <div role="group" aria-label={name} className="divider-rule" tabIndex={0} onKeyDown={(e) => {
                  if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.preventDefault();
                    void deleteBlock(block);
                  }
                }} />
              ) : block.type === 'image' || block.type === 'file' ? (
                <AttachmentBlock block={block} name={name} />
              ) : block.type === 'table' ? (
                <TableBlock block={block} name={name} />
              ) : (
                <TextBlock
                  block={block}
                  name={name}
                  keptValues={keptValues}
                  onFocus={() => onFocusBlock?.(block.id)}
                  onText={(t) => updateText(block, t)}
                  onEnter={() => {
                    if (block.type === 'bulleted' || block.type === 'numbered' || block.type === 'todo') {
                      void insertAfter(block, block.type, block.indent);
                    } else {
                      void insertAfter(block, 'paragraph', 0);
                    }
                  }}
                  onBackspaceEmpty={() => void deleteBlock(block)}
                  onSlash={(open, filter) => {
                    setSlashFor(open ? block.id : null);
                    setSlashFilter(filter);
                    setSlashHighlight(0);
                  }}
                  slashOpen={slashFor === block.id}
                  slashOptions={filteredOptions}
                  slashHighlight={slashHighlight}
                  setSlashHighlight={setSlashHighlight}
                  onChoose={(type) => {
                    setSlashFor(null);
                    void changeType(block, type);
                  }}
                  onIndent={(dir) => indent(block, dir)}
                  onMove={(dir) => moveBlock(block, dir)}
                />
              )}
            </div>
          </div>
        );
      })}
      {slashFor && (
        <div className="menu" role="listbox" aria-label="Insert block" style={{ position: 'fixed', bottom: 20, left: 20 }}>
          {filteredOptions.length === 0 ? (
            <p style={{ padding: '8px 12px', margin: 0 }}>No blocks match.</p>
          ) : (
            filteredOptions.map((opt, i) => (
              <div
                key={opt}
                role="option"
                aria-selected={i === slashHighlight}
                className={i === slashHighlight ? 'highlighted' : ''}
                style={{ padding: '8px 12px', cursor: 'pointer' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSlashFor(null);
                  const block = blocks.find((b) => b.id === slashFor);
                  if (block) void changeType(block, opt);
                }}
                onMouseEnter={() => setSlashHighlight(i)}
              >
                {BLOCK_TYPE_LABELS[opt]}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function blockLabel(block: Block, label: string, notSynced: boolean, bothKept: boolean): string {
  const typeLabel = TYPE_LABELS[block.type];
  let name = label ? `${typeLabel}: ${label}` : typeLabel;
  if (notSynced) name += ', not yet synced';
  if (bothKept) name += ', Both kept';
  return name;
}

async function createTable(
  markChange: (kind: string, id: string, doc: string | null, del: boolean, payload: unknown) => Promise<void>,
  reload: () => Promise<void>
): Promise<string> {
  const id = uuid();
  const now = Date.now();
  const name = uniqueTableName('Untitled table');
  await db.putTable({ id, name, createdAt: now, updatedAt: now });
  await markChange('table', id, null, false, { id, name, createdAt: now, updatedAt: now });
  const cols: { key: string; name: string; type: 'text' | 'number' }[] = [
    { key: 'name', name: 'Name', type: 'text' },
    { key: 'amount', name: 'Amount', type: 'number' },
  ];
  for (let i = 0; i < cols.length; i++) {
    const col = { id: `${id}-${cols[i].key}`, tableId: id, name: cols[i].name, type: cols[i].type, options: [], order: i };
    await db.putColumn(col);
    await markChange('column', col.id, id, false, col);
  }
  await reload();
  return id;
}

function uniqueTableName(base: string): string {
  const tables = useApp.getState().tables;
  const names = new Set(tables.map((t) => t.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function TextBlock({
  block,
  name,
  keptValues,
  onText,
  onEnter,
  onBackspaceEmpty,
  onSlash,
  slashOpen,
  slashOptions,
  slashHighlight,
  setSlashHighlight,
  onChoose,
  onIndent,
  onMove,
  onFocus,
}: {
  block: Block;
  name: string;
  keptValues: string[] | undefined;
  onFocus?: () => void;
  onText: (t: string) => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onSlash: (open: boolean, filter: string) => void;
  slashOpen: boolean;
  slashOptions: BlockType[];
  slashHighlight: number;
  setSlashHighlight: (n: number) => void;
  onChoose: (type: BlockType) => void;
  onIndent: (dir: 1 | -1) => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const resolveBothKept = useApp((s) => s.resolveBothKept);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const leftListRef = useRef(false);
  const keptSorted = keptValues
    ? [...keptValues].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || (a < b ? -1 : a > b ? 1 : 0))
    : undefined;
  // The draft is optimistic so typing never races the store reloads; it
  // re-syncs from the block when the person is not writing.
  const [draft, setDraft] = useState(block.text);
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(block.text);
  }, [block.text]);
  // When the Both kept marker goes, the chosen value replaces any stale draft.
  useEffect(() => {
    if (!keptValues) setDraft(block.text);
  }, [keptValues, block.text]);
  const display = keptSorted ? keptSorted[0] : draft;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight((slashHighlight + 1) % slashOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight((slashHighlight - 1 + slashOptions.length) % slashOptions.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (slashOptions.length > 0) onChoose(slashOptions[slashHighlight]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onSlash(false, '');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onEnter();
      return;
    }
    if (e.key === 'Backspace' && block.text === '') {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if (e.key === '/' && block.text === '') {
      onSlash(true, '');
      return;
    }
    if (keptSorted) {
      // A marked block is read-only; Tab reaches its Keep buttons.
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      onIndent(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      // Escape, then Tab: leave the list so Tab moves to the next control
      leftListRef.current = true;
      return;
    }
    if (e.key === 'Tab' && leftListRef.current) {
      leftListRef.current = false;
      return; // default Tab moves focus out of the editor
    }
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      onMove(-1);
    }
    if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      onMove(1);
    }
  };

  return (
    <div className="todo-line" style={{ display: 'block' }}>
      {block.type === 'todo' && (
        <input
          type="checkbox"
          aria-label="Done"
          checked={block.checked}
          onChange={() => {
            // handled by parent via onText; simpler here:
            const b = block;
            void useApp.getState().markChange('block', b.id, b.documentId, false, blockPayload({ ...b, checked: !b.checked }));
            void db.putBlock({ ...b, checked: !b.checked });
            void useApp.getState().reload();
          }}
        />
      )}
      <textarea
        ref={inputRef}
        data-block-input
        className={`block-text ${block.type}`}
        role="textbox"
        aria-label={name}
        data-indent={block.indent}
        value={display}
        readOnly={!!keptSorted}
        onFocus={() => onFocus?.()}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          onText(t);
          if (slashOpen) {
            const filter = t.startsWith('/') ? t.slice(1) : t;
            onSlash(true, filter);
          }
        }}
        onKeyDown={onKeyDown}
        rows={1}
      />
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
  );
}

function AttachmentBlock({ block, name }: { block: Block; name: string }) {
  const attachments = useApp((s) => s.attachments);
  const attachment = attachments.find((a) => a.id === block.attachmentId);
  const reload = useApp((s) => s.reload);
  const markChange = useApp((s) => s.markChange);

  const stateText = attachment
    ? attachment.state === 'stored'
      ? 'Stored.'
      : attachment.state === 'refused'
        ? attachment.size > 5_000_000
          ? 'Refused. This file is larger than 5,000,000 bytes.'
          : 'Refused. Your account storage is full.'
        : 'Waiting. This file is only on this device.'
    : 'Waiting. This file is only on this device.';

  const onFile = async (file: File) => {
    const id = block.attachmentId ?? uuid();
    if (file.size > 5_000_000) {
      await db.putAttachment({
        id,
        documentId: block.documentId,
        blockId: block.id,
        name: file.name,
        size: file.size,
        contentType: file.type || 'application/octet-stream',
        state: 'refused',
        bytes: undefined,
      });
      const updatedBlock = { ...block, attachmentId: id };
      await db.putBlock(updatedBlock);
      await markChange('block', block.id, block.documentId, false, blockPayload(updatedBlock));
      await reload();
      announce(`Refused ${file.name}.`);
      return;
    }
    await db.putAttachment({
      id,
      documentId: block.documentId,
      blockId: block.id,
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      state: 'waiting',
      bytes: file,
    });
    const updatedBlock = { ...block, attachmentId: id };
    await db.putBlock(updatedBlock);
    await markChange('block', block.id, block.documentId, false, blockPayload(updatedBlock));
    await reload();
    announce(`${file.name} is waiting on this device.`);
  };

  return (
    <div role="group" aria-label={name} tabIndex={0} onKeyDown={(e) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && e.target === e.currentTarget) {
        const blocks = useApp.getState().blocks;
        const above = blocks
          .filter((b) => b.documentId === block.documentId && b.order < block.order)
          .sort((a, b) => b.order - a.order)[0];
        void db.deleteBlock(block.id);
        void useApp.getState().markChange('block', block.id, block.documentId, true, null);
        void useApp.getState().reload();
        if (above) {
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block-id="${above.id}"] [data-block-input]`)?.focus());
        }
      }
    }}>
      <p style={{ margin: '4px 0' }}>{stateText}</p>
      <label className="button" style={{ display: 'inline-flex' }}>
        Attach a file
        <input
          type="file"
          style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0 }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </label>
    </div>
  );
}

function TableBlock({ block, name }: { block: Block; name: string }) {
  const tables = useApp((s) => s.tables);
  const rows = useApp((s) => s.rows);
  const columns = useApp((s) => s.columns);
  const navigate = useNavigate();
  const table = tables.find((t) => t.id === block.tableId);
  if (!table) return null;
  const tableRows = rows.filter((r) => r.tableId === table.id);
  const tableColumns = columns.filter((c) => c.tableId === table.id).sort((a, b) => a.order - b.order);
  const firstNumber = tableColumns.find((c) => c.type === 'number');
  const total = firstNumber
    ? tableRows.reduce((sum, r) => sum + (Number(r.values[firstNumber.id] ?? 0) || 0), 0)
    : null;
  return (
    <div role="group" aria-label={name} tabIndex={0} onKeyDown={(e) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && e.target === e.currentTarget) {
        const blocks = useApp.getState().blocks;
        const above = blocks
          .filter((b) => b.documentId === block.documentId && b.order < block.order)
          .sort((a, b) => b.order - a.order)[0];
        void db.deleteBlock(block.id);
        void useApp.getState().markChange('block', block.id, block.documentId, true, null);
        void useApp.getState().reload();
        if (above) {
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-block-id="${above.id}"] [data-block-input]`)?.focus());
        }
      }
    }}>
      <p style={{ margin: '4px 0' }}>{table.name}</p>
      <p className="meta" style={{ margin: '4px 0' }}>
        {tableRows.length === 1 ? '1 row' : `${tableRows.length} rows`}
      </p>
      {firstNumber && total !== null && (
        <p className="meta" style={{ margin: '4px 0' }}>
          {firstNumber.name} total: {total.toFixed(2)}
        </p>
      )}
      <button className="button" onClick={() => navigate(`/records/${table.id}`)}>
        Open {table.name}
      </button>
    </div>
  );
}
