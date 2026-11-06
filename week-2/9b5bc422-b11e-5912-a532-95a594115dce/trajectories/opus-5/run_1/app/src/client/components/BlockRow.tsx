import { useLayoutEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { isListBlock, isTextBlock, textOf } from '../../domain/blocks.ts';
import {
  BLOCK_TYPE_LABELS,
  INSERT_OPTIONS,
  attachmentText,
  bothKept as bothKeptCopy,
  columnTotalLine,
  announce as copy,
  empty,
  rowWord,
} from '../../domain/copy.ts';
import { isBothKept, tableRows } from '../../domain/materialise.ts';
import { columnTotal, firstNumberColumn } from '../../domain/records.ts';
import type { BlockRecord, BlockType, Indent } from '../../domain/types.ts';
import { nameOfBlock } from '../blockNaming.ts';
import { useStore } from '../hooks.ts';
import { navigate } from '../router.ts';
import { noticeSaved } from '../savedNotice.ts';
import { blocks as blockActions, tables } from '../store/actions.ts';
import { announce } from '../store/store.ts';
import { BothKept } from './BothKept.tsx';

export function focusBlock(blockId: string): void {
  const host = document.querySelector(`[data-block-id="${blockId}"]`);
  if (!host) return;
  if (host instanceof HTMLElement && (host.tabIndex >= 0 || host.getAttribute('role') === 'button')) {
    host.focus();
    return;
  }
  const control =
    host.querySelector<HTMLElement>('textarea') ??
    host.querySelector<HTMLElement>('[role="group"][tabindex]') ??
    host.querySelector<HTMLElement>('input[type="file"]');
  control?.focus();
}

function matchingOptions(query: string): BlockType[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...INSERT_OPTIONS];
  return INSERT_OPTIONS.filter((type) =>
    BLOCK_TYPE_LABELS[type]
      .toLowerCase()
      .split(' ')
      .some((word) => word.startsWith(needle)),
  );
}

export function RecordTableBlockBody(props: { tableId: string }) {
  const state = useStore();
  const table = state.workspace.tables.get(props.tableId);
  if (!table) return null;
  const rows = tableRows(state.workspace, table.id);
  const numberColumn = firstNumberColumn(table);
  return (
    <div className="table-block">
      <p className="table-block-name">{table.name}</p>
      <p>{rowWord(rows.length)}</p>
      {numberColumn && <p>{columnTotalLine(numberColumn.name, columnTotal(rows, numberColumn))}</p>}
      <a
        href={`/records/${table.id}`}
        onClick={(event) => {
          event.preventDefault();
          navigate(`/records/${table.id}?view=table`);
        }}
      >
        {`Open ${table.name}`}
      </a>
    </div>
  );
}

function AttachmentBody(props: { block: BlockRecord; documentId: string }) {
  const state = useStore();
  const file = props.block.attachmentId ? state.files.get(props.block.attachmentId) : undefined;
  const attachment = props.block.attachmentId ? state.workspace.attachments.get(props.block.attachmentId) : undefined;
  const text = file
    ? file.state === 'stored'
      ? attachmentText.stored
      : file.state === 'refused'
        ? file.refusal === 'account-full'
          ? attachmentText.refusedAccountFull
          : attachmentText.refusedTooLarge
        : attachmentText.waiting
    : attachment
      ? attachmentText.stored
      : '';

  return (
    <div className="attachment">
      {(file || attachment) && <p className="attachment-name">{file?.name ?? attachment?.name}</p>}
      {text && <p className="attachment-state">{text}</p>}
      <label className="field">
        <span>Attach a file</span>
        <input
          type="file"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void blockActions.attach(props.block.id, props.documentId, chosen);
          }}
        />
      </label>
    </div>
  );
}

export function BlockRow(props: {
  block: BlockRecord;
  documentId: string;
  ordered: BlockRecord[];
  onFocus: (blockId: string) => void;
}) {
  const state = useStore();
  const { block, ordered } = props;
  const index = ordered.findIndex((item) => item.id === block.id);
  const text = textOf(block.text);
  const marked = isBothKept(block.text);
  const name = nameOfBlock(state, block);
  const notch = name.includes(', not yet synced');
  const [slash, setSlash] = useState<{ query: string; highlight: number } | null>(null);
  const [escaped, setEscaped] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  const options = slash ? matchingOptions(slash.query) : [];

  const closeSlash = () => setSlash(null);

  const chooseOption = async (type: BlockType) => {
    closeSlash();
    await blockActions.setText(block.id, '');
    if (type === 'table') {
      const tableId = await tables.create();
      await blockActions.setType(block.id, 'table');
      await blockActions.bindTable(block.id, tableId);
      const nextId = await blockActions.insertAfter(props.documentId, block.id, 'paragraph');
      window.setTimeout(() => focusBlock(nextId), 0);
      return;
    }
    await blockActions.setType(block.id, type);
    if (type === 'divider') {
      const nextId = await blockActions.insertAfter(props.documentId, block.id, 'paragraph');
      window.setTimeout(() => focusBlock(nextId), 0);
      return;
    }
    if (type === 'image' || type === 'file') {
      window.setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>(`[data-block-id="${block.id}"] input[type="file"]`);
        input?.focus();
      }, 0);
      return;
    }
    window.setTimeout(() => focusBlock(block.id), 0);
  };

  const onTextKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slash) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlash({ ...slash, highlight: options.length ? (slash.highlight + 1) % options.length : 0 });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlash({
          ...slash,
          highlight: options.length ? (slash.highlight - 1 + options.length) % options.length : 0,
        });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = options[slash.highlight];
        if (chosen) await chooseOption(chosen);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSlash();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const listType = isListBlock(block.type) ? block.type : 'paragraph';
      const madeId = await blockActions.insertAfter(props.documentId, block.id, listType, {
        indent: isListBlock(block.type) ? block.indent : 0,
      });
      window.setTimeout(() => focusBlock(madeId), 0);
      return;
    }

    if (event.key === 'Backspace' && text === '' && ordered.length > 1) {
      event.preventDefault();
      const above = ordered[index - 1];
      await blockActions.remove(block.id);
      if (above) window.setTimeout(() => focusBlock(above.id), 0);
      return;
    }

    if (event.key === 'Escape' && isListBlock(block.type)) {
      setEscaped(true);
      return;
    }

    if (event.key === 'Tab' && isListBlock(block.type) && !escaped) {
      const above = ordered[index - 1];
      if (event.shiftKey) {
        event.preventDefault();
        if (block.indent === 0) return;
        await blockActions.setIndent(block.id, (block.indent - 1) as Indent);
        announce(copy.outdented);
        return;
      }
      event.preventDefault();
      if (!above || !isListBlock(above.type)) return;
      const limit = Math.min(2, above.indent + 1);
      if (block.indent >= limit) return;
      await blockActions.setIndent(block.id, (block.indent + 1) as Indent);
      announce(copy.indented);
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const position = await blockActions.move(block.id, event.key === 'ArrowUp' ? -1 : 1);
      announce(copy.blockMoved(position));
      window.setTimeout(() => focusBlock(block.id), 0);
    }
  };

  const onGroupKeyDown = async (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const above = ordered[index - 1];
      await blockActions.remove(block.id);
      if (above) window.setTimeout(() => focusBlock(above.id), 0);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const position = await blockActions.move(block.id, event.key === 'ArrowUp' ? -1 : 1);
      announce(copy.blockMoved(position));
      window.setTimeout(() => focusBlock(block.id), 0);
    }
  };

  const slashListId = `slash-${block.id}`;

  /** Dragging the handle reorders blocks on the page; it never moves a card. */
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const drop = (pointer: PointerEvent) => {
      const others = [...document.querySelectorAll<HTMLElement>('.blocks [data-block-id]')].filter(
        (element) => element.dataset.blockId !== block.id,
      );
      let before: number | null = null;
      let after: number | null = null;
      for (const element of others) {
        const box = element.getBoundingClientRect();
        const other = ordered.find((item) => item.id === element.dataset.blockId);
        if (!other) continue;
        if (pointer.clientY > box.top + box.height / 2) before = other.order;
        else if (after === null) after = other.order;
      }
      void blockActions.reorder(block.id, before, after);
    };
    const onUp = (pointer: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      drop(pointer);
    };
    window.addEventListener('pointerup', onUp);
  };

  const handle = (
    <button
      type="button"
      className="button icon-button move-block"
      aria-label="Move block"
      onPointerDown={startDrag}
      onKeyDown={async (event) => {
        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          const position = await blockActions.move(block.id, event.key === 'ArrowUp' ? -1 : 1);
          announce(copy.blockMoved(position));
        }
      }}
    >
      <GripVertical aria-hidden="true" size={16} />
    </button>
  );

  const body = () => {
    if (isTextBlock(block.type)) {
      return (
        <>
          {block.type === 'todo' && (
            <input
              type="checkbox"
              aria-label="Done"
              checked={block.checked}
              onChange={(event) => void blockActions.setChecked(block.id, event.target.checked)}
            />
          )}
          <textarea
            ref={area}
            rows={1}
            className={`block-text block-${block.type}`}
            aria-label={name}
            readOnly={marked}
            value={text}
            aria-controls={slash ? slashListId : undefined}
            aria-activedescendant={slash && options.length ? `${slashListId}-${slash.highlight}` : undefined}
            onFocus={() => props.onFocus(block.id)}
            onChange={(event) => {
              const value = event.target.value;
              if (!slash && value === '/' && text === '') setSlash({ query: '', highlight: 0 });
              else if (slash) {
                if (!value.startsWith('/')) closeSlash();
                else setSlash({ query: value.slice(1), highlight: 0 });
              }
              void blockActions.setText(block.id, value).then(noticeSaved);
            }}
            onKeyDown={(event) => void onTextKeyDown(event)}
          />
          {slash && (
            <div className="paper slash-menu">
              {options.length === 0 ? (
                <p className="empty">{empty.noSlashMatch}</p>
              ) : (
                <ul role="listbox" aria-label="Insert block" id={slashListId}>
                  {options.map((type, optionIndex) => (
                    <li
                      key={type}
                      role="option"
                      id={`${slashListId}-${optionIndex}`}
                      aria-selected={optionIndex === slash.highlight}
                      data-highlighted={optionIndex === slash.highlight ? 'true' : undefined}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void chooseOption(type);
                      }}
                    >
                      {BLOCK_TYPE_LABELS[type]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      );
    }

    if (block.type === 'divider') return <hr />;
    if (block.type === 'table' && block.tableId) return <RecordTableBlockBody tableId={block.tableId} />;
    if (block.type === 'image' || block.type === 'file') {
      return <AttachmentBody block={block} documentId={props.documentId} />;
    }
    return null;
  };

  const interactive = isTextBlock(block.type);

  return (
    <div
      className="block"
      data-block-id={block.id}
      data-block-type={block.type}
      data-indent={isListBlock(block.type) ? block.indent : undefined}
      data-unsynced={notch ? 'true' : undefined}
      data-both-kept={marked ? 'true' : undefined}
      {...(!interactive
        ? {
            role: 'group',
            'aria-label': name,
            tabIndex: 0,
            onFocus: () => props.onFocus(block.id),
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void onGroupKeyDown(event),
            'data-table-block': block.tableId ?? undefined,
          }
        : {})}
    >
      {handle}
      <div className="block-body">{body()}</div>
      {marked && (
        <BothKept
          entity="block"
          entityId={block.id}
          field="text"
          values={block.text}
          sentence={bothKeptCopy.block}
          afterChoice={() => window.setTimeout(() => focusBlock(block.id), 0)}
        />
      )}
    </div>
  );
}
