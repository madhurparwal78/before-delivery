import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Cell } from '../../shared/types.js';
import { tableOfContents } from '../../shared/toc.js';
import { useApp } from '../app.js';
import { CellView } from '../components/CellView.js';
import { CheckpointPanel } from '../components/CheckpointPanel.js';
import { CommandPalette, type PaletteCommand } from '../components/CommandPalette.js';
import { Dialog } from '../components/Dialog.js';
import { WorkspaceHeader } from '../components/Header.js';
import { useIsPhoneLayout } from '../components/hooks.js';
import { Menu } from '../components/Menu.js';
import { ShareDialog } from '../components/ShareDialog.js';
import { useNotebook } from '../notebook/useNotebook.js';

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'restart' }
  | { kind: 'share' }
  | { kind: 'palette' }
  | { kind: 'contents' }
  | { kind: 'cell-actions'; cellId: string };

const KERNEL_WORDS: Record<string, string> = {
  starting: 'Kernel starting',
  idle: 'Kernel idle',
  busy: 'Kernel busy',
  interrupted: 'Kernel interrupted',
  restarting: 'Kernel restarting',
};

export function NotebookScreen({ notebookId }: { notebookId: string }): JSX.Element {
  const app = useApp();
  const phone = useIsPhoneLayout();
  const control = useNotebook(notebookId, app.limits);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const [panelOpen, setPanelOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [drag, setDrag] = useState<{ cellId: string; gap: number } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const pressRef = useRef<{ key: string; at: number } | null>(null);
  const cellsRef = useRef<HTMLDivElement>(null);

  const { cells, mode, selection, canEdit } = control;
  const selectedCell: Cell | undefined = cells[selection.index];

  useEffect(() => {
    if (mode === 'edit') editorRef.current?.focus();
  }, [mode, selection.index]);

  const focusCell = useCallback((cellId: string) => {
    const article = cellsRef.current?.querySelector<HTMLElement>(`[data-cell-id="${cellId}"]`);
    article?.focus();
    article?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, []);

  /* Leaving edit mode moves focus from the editor back to the cell. */
  const previousMode = useRef(mode);
  useEffect(() => {
    const wasEditing = previousMode.current === 'edit';
    previousMode.current = mode;
    if (!wasEditing || mode !== 'command') return;
    const cell = cells[selection.index];
    if (cell) focusCell(cell.id);
  }, [mode, selection.index, cells, focusCell]);

  const headings = useMemo(
    () =>
      tableOfContents(
        cells.map((cell) => ({ ...cell, source: control.drafts[cell.id]?.text ?? cell.source })),
      ),
    [cells, control.drafts],
  );

  const doublePress = (key: string): boolean => {
    const now = Date.now();
    const last = pressRef.current;
    if (last !== null && last.key === key && now - last.at <= app.limits.double_press_ms) {
      pressRef.current = null;
      return true;
    }
    pressRef.current = { key, at: now };
    return false;
  };

  const openPalette = (): void => setDialog({ kind: 'palette' });

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const viewerCommands: PaletteCommand[] = [
      { label: 'Export notebook', run: () => void control.exportNotebook() },
      { label: 'Show table of contents', run: () => setDialog({ kind: 'contents' }) },
    ];
    if (!canEdit) return viewerCommands;
    return [
      { label: 'Run all cells', run: () => void control.runAll() },
      { label: 'Run selected cell', run: () => void control.runCells('in-place') },
      { label: 'Interrupt kernel', run: () => control.interrupt() },
      { label: 'Restart kernel', run: () => setDialog({ kind: 'restart' }) },
      { label: 'Save checkpoint', run: () => void control.saveCheckpoint() },
      { label: 'Insert code cell below', run: () => void control.insertCell('below', 'code') },
      { label: 'Insert markdown cell below', run: () => void control.insertCell('below', 'markdown') },
      ...viewerCommands,
    ];
  }, [canEdit, control]);

  const splitAtCursor = (): void => {
    const editor = editorRef.current;
    if (!editor) return;
    const before = editor.value.slice(0, editor.selectionStart);
    const line = before.split('\n').length;
    void control.splitCell(line);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('[role="dialog"]') !== null || target.closest('[role="menu"]') !== null) return;
    const isCellEditor = target.classList.contains('cell-editor');
    const inEditor = isCellEditor && mode === 'edit';
    const inPlainField =
      !isCellEditor &&
      (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key;

    if (!inPlainField) {
      if (key === 'Enter' && event.shiftKey) {
        event.preventDefault();
        void control.runCells('advance');
        return;
      }
      if (key === 'Enter' && meta) {
        event.preventDefault();
        void control.runCells('in-place');
        return;
      }
      if (key === 'Enter' && event.altKey) {
        event.preventDefault();
        void control.runCells('insert-below');
        return;
      }
      if (meta && !event.shiftKey && key.toLowerCase() === 's') {
        event.preventDefault();
        void control.saveCheckpoint();
        return;
      }
      if (meta && event.shiftKey && key.toLowerCase() === 'c') {
        event.preventDefault();
        openPalette();
        return;
      }
      if (key === 'Escape') {
        event.preventDefault();
        control.enterCommand();
        if (selectedCell) focusCell(selectedCell.id);
        return;
      }
    }

    if (inEditor) {
      if (meta && event.shiftKey && (key === '-' || key === '_')) {
        event.preventDefault();
        splitAtCursor();
      }
      return;
    }
    if (inPlainField) return;
    if ((key === 'Enter' || key === ' ') && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;

    const last = cells.length - 1;
    if (key === 'ArrowUp' || key === 'k' || key === 'K') {
      event.preventDefault();
      control.select(Math.max(0, selection.index - 1), event.shiftKey && key === 'ArrowUp');
      return;
    }
    if (key === 'ArrowDown' || key === 'j' || key === 'J') {
      event.preventDefault();
      control.select(Math.min(last, selection.index + 1), event.shiftKey && key === 'ArrowDown');
      return;
    }
    if (!canEdit) return;

    if (key === 'Enter') {
      event.preventDefault();
      control.enterEdit();
      return;
    }
    if (key === 'a' || key === 'A') {
      event.preventDefault();
      void control.insertCell('above', 'code');
      return;
    }
    if (key === 'b' || key === 'B') {
      event.preventDefault();
      void control.insertCell('below', 'code');
      return;
    }
    if (key === 'M' && event.shiftKey) {
      event.preventDefault();
      void control.mergeCells();
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      void control.changeType('markdown');
      return;
    }
    if (key === 'y' || key === 'Y') {
      event.preventDefault();
      void control.changeType('code');
      return;
    }
    if (key === 'd' || key === 'D') {
      event.preventDefault();
      if (doublePress('d')) void control.deleteCells();
      return;
    }
    if (key === 'z' || key === 'Z') {
      event.preventDefault();
      void control.undoDelete();
      return;
    }
    if (key === 'c' || key === 'C') {
      event.preventDefault();
      control.copyCells();
      return;
    }
    if (key === 'x' || key === 'X') {
      event.preventDefault();
      void control.cutCells();
      return;
    }
    if (key === 'v' || key === 'V') {
      event.preventDefault();
      void control.pasteCells();
      return;
    }
    if (key === 'i' || key === 'I') {
      event.preventDefault();
      if (doublePress('i')) control.interrupt();
      return;
    }
    if (key === '0') {
      event.preventDefault();
      if (doublePress('0')) setDialog({ kind: 'restart' });
    }
  };

  /**
   * Command-mode keys answer wherever focus sits in the notebook, except inside
   * a text field, the editor in edit mode, an open menu or a dialog.
   */
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  /* Dragging a cell by its handle, with a drop line between cells. */
  const onHandlePointerDown = (cellId: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!canEdit) return;
    event.preventDefault();
    const gapFor = (clientY: number): number => {
      const articles = [...(cellsRef.current?.querySelectorAll<HTMLElement>('article.cell') ?? [])];
      let gap = articles.length;
      for (let index = 0; index < articles.length; index += 1) {
        const box = articles[index].getBoundingClientRect();
        if (clientY < box.top + box.height / 2) {
          gap = index;
          break;
        }
      }
      return gap;
    };
    setDrag({ cellId, gap: gapFor(event.clientY) });
    const onMove = (move: PointerEvent): void => setDrag({ cellId, gap: gapFor(move.clientY) });
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const gap = gapFor(up.clientY);
      const from = cells.findIndex((cell) => cell.id === cellId);
      setDrag(null);
      const position = gap > from ? gap - 1 : gap;
      if (from >= 0 && position !== from) void control.moveCell(cellId, position);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (control.notFound) {
    return (
      <div className="page">
        <WorkspaceHeader />
        <section className="band band-grey band-tall">
          <div className="container narrow">
            <div className="card form-card">
              <h1>Notebook not found</h1>
              <a
                className="inline-link"
                href="/notebooks"
                onClick={(event) => {
                  event.preventDefault();
                  app.navigate('/notebooks');
                }}
              >
                Back to your notebooks
              </a>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const notebook = control.notebook;
  const modeLabel = mode === 'view' ? 'View only' : mode === 'edit' ? 'Edit mode' : 'Command mode';
  const kernelText = control.connected ? KERNEL_WORDS[control.kernelStatus] : 'Reconnecting…';
  const sheetCell = dialog.kind === 'cell-actions' ? cells.find((cell) => cell.id === dialog.cellId) : undefined;

  const tocNavigation = (
    <nav className="toc" aria-label="Table of contents">
      <ol>
        {headings.map((heading, index) => (
          <li key={`${heading.cell_id}-${index}`} className={`toc-level-${heading.level}`}>
            <a
              href={`#cell-${heading.cell_id}`}
              onClick={(event) => {
                event.preventDefault();
                const index = cells.findIndex((cell) => cell.id === heading.cell_id);
                if (index >= 0) control.select(index);
                control.enterCommand();
                setDialog({ kind: 'none' });
                window.setTimeout(() => focusCell(heading.cell_id), 0);
              }}
            >
              {`${heading.number} ${heading.text}`}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <div className="page notebook-page">
      <WorkspaceHeader
        lead={
          <div className="notebook-ident">
            <h1>{notebook ? notebook.title : ''}</h1>
            <span className="mode-indicator">{modeLabel}</span>
            <span className="kernel-status">{kernelText}</span>
            <ul className="people-here" aria-label="People here">
              {[...new Map(control.present.map((entry) => [entry.display_name, entry])).values()].map(
                (entry) => (
                  <li key={entry.tab_id}>{entry.display_name}</li>
                ),
              )}
            </ul>
          </div>
        }
      >
        <Menu
          name="File"
          items={[
            { label: 'New notebook', onChoose: () => app.navigate('/notebooks') },
            { label: 'Import notebook', onChoose: () => app.navigate('/notebooks') },
            { label: 'Export', onChoose: () => void control.exportNotebook() },
            ...(notebook && notebook.imported
              ? [{ label: 'Download original', onChoose: () => void control.downloadOriginal() }]
              : []),
            { label: 'Save checkpoint', onChoose: () => void control.saveCheckpoint() },
          ]}
        />
        <Menu
          name="Edit"
          items={[
            { label: 'Cut cells', onChoose: () => void control.cutCells() },
            { label: 'Copy cells', onChoose: () => control.copyCells() },
            { label: 'Paste cells below', onChoose: () => void control.pasteCells() },
            { label: 'Delete cells', onChoose: () => void control.deleteCells() },
            { label: 'Undo delete', onChoose: () => void control.undoDelete() },
            { label: 'Merge selected cells', onChoose: () => void control.mergeCells() },
            { label: 'Split cell', onChoose: () => splitAtCursor() },
          ]}
        />
        <Menu
          name="Cell"
          items={[
            { label: 'Run', onChoose: () => void control.runCells('in-place') },
            { label: 'Run all', onChoose: () => void control.runAll() },
            { label: 'Change to code', onChoose: () => void control.changeType('code') },
            { label: 'Change to markdown', onChoose: () => void control.changeType('markdown') },
            {
              label: 'Move cell up',
              onChoose: () => {
                if (selectedCell && selection.index > 0) {
                  void control.moveCell(selectedCell.id, selection.index - 1);
                }
              },
            },
            {
              label: 'Move cell down',
              onChoose: () => {
                if (selectedCell && selection.index < cells.length - 1) {
                  void control.moveCell(selectedCell.id, selection.index + 1);
                }
              },
            },
            { label: 'Insert code cell below', onChoose: () => void control.insertCell('below', 'code') },
          ]}
        />
        <Menu
          name="Kernel"
          caret
          items={[
            { label: 'Interrupt kernel', onChoose: () => control.interrupt() },
            { label: 'Restart kernel', onChoose: () => setDialog({ kind: 'restart' }) },
          ]}
        />
        <button type="button" className="button-plain" onClick={() => setDialog({ kind: 'share' })}>
          Share
        </button>
      </WorkspaceHeader>

      <div className="toolbar" role="toolbar" aria-label="Notebook actions">
        <button
          type="button"
          className="button-embossed"
          disabled={!canEdit}
          onClick={() => void control.runCells('in-place')}
        >
          Run
        </button>
        <button type="button" className="button-plain" disabled={!canEdit} onClick={() => void control.runAll()}>
          Run all
        </button>
        <button type="button" className="button-plain" disabled={!canEdit} onClick={() => control.interrupt()}>
          Interrupt kernel
        </button>
        <button
          type="button"
          className="button-plain"
          disabled={!canEdit}
          onClick={() => setDialog({ kind: 'restart' })}
        >
          Restart kernel
        </button>
        <button
          type="button"
          className="button-embossed"
          disabled={!canEdit}
          onClick={() => void control.saveCheckpoint()}
        >
          Save checkpoint
        </button>
        <button
          type="button"
          className="button-plain"
          onClick={() => {
            setPanelOpen(!panelOpen);
            void control.reloadCheckpoints();
          }}
        >
          Checkpoints
        </button>
        <button type="button" className="button-plain" onClick={() => void control.exportNotebook()}>
          Export
        </button>
        {notebook && notebook.imported ? (
          <button type="button" className="button-plain" onClick={() => void control.downloadOriginal()}>
            Download original
          </button>
        ) : null}
        {phone ? (
          <button type="button" className="button-plain" onClick={() => setDialog({ kind: 'contents' })}>
            Show table of contents
          </button>
        ) : null}
      </div>

      <p className="live-region" role="status" aria-live="polite" aria-label="Notebook status">
        {control.status}
      </p>
      <p className="live-region" role="status" aria-live="polite" aria-label="Save status">
        {control.saveStatus}
      </p>
      {control.outage ? (
        <p className="outage-banner" role="alert">
          Storage is unavailable. Your edits are kept in this page and will be saved when storage returns.
        </p>
      ) : null}

      <div className={`notebook-layout ${panelOpen ? 'with-panel' : ''} ${comparing ? 'comparing' : ''}`}>
        {!phone && !comparing ? <div className="toc-column">{tocNavigation}</div> : null}
        <div className="cells-column" role="region" aria-label="Cells" ref={cellsRef} hidden={comparing}>
          {cells.map((cell, index) => (
            <CellView
              key={cell.id}
              ref={editorRef}
              notebookId={notebookId}
              cell={cell}
              index={index}
              selected={control.selectedIndices.includes(index)}
              editing={mode === 'edit' && selection.index === index}
              draft={control.drafts[cell.id]?.text ?? null}
              canEdit={canEdit}
              lockedBy={control.lockedBy(cell)}
              skipped={cell.run_state === 'not_run'}
              phone={phone}
              limits={app.limits}
              dropBefore={drag !== null && drag.gap === index}
              dropAfter={drag !== null && drag.gap === cells.length && index === cells.length - 1}
              onSelect={() => control.select(index)}
              onChange={(text) => control.setDraft(cell, text)}
              onEnterEdit={() => {
                control.select(index);
                control.enterEdit(index);
              }}
              onAnnounce={control.announce}
              onCellActions={() => setDialog({ kind: 'cell-actions', cellId: cell.id })}
              onHandlePointerDown={onHandlePointerDown(cell.id)}
            />
          ))}
        </div>
        {panelOpen ? (
          <CheckpointPanel
            notebookId={notebookId}
            checkpoints={control.checkpoints}
            canEdit={canEdit}
            onClose={() => {
              setPanelOpen(false);
              setComparing(false);
            }}
            onReverted={(label) => control.afterRevert(label)}
            onComparing={setComparing}
          />
        ) : null}
      </div>

      {dialog.kind === 'restart' ? (
        <Dialog name="Restart kernel?" onClose={() => setDialog({ kind: 'none' })}>
          <h2>Restart kernel?</h2>
          <p>All variables will be cleared. Outputs stay.</p>
          <div className="button-row">
            <button
              type="button"
              className="button-embossed"
              onClick={() => {
                setDialog({ kind: 'none' });
                void control.restart();
              }}
            >
              Restart
            </button>
            <button type="button" className="button-plain" onClick={() => setDialog({ kind: 'none' })}>
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}

      {control.conflictCellId !== null ? (
        <Dialog name="Notebook changed elsewhere" dismissable={false} onClose={() => undefined}>
          <h2>Notebook changed elsewhere</h2>
          <p>Someone saved this notebook after you started editing. Choose which version to keep.</p>
          <div className="button-row">
            <button
              type="button"
              className="button-embossed"
              onClick={() => {
                const cellId = control.conflictCellId;
                void control.reloadLatest().then(() => {
                  if (cellId) focusCell(cellId);
                });
              }}
            >
              Reload latest
            </button>
            <button
              type="button"
              className="button-plain"
              onClick={() => {
                const cellId = control.conflictCellId;
                void control.keepMyVersion().then(() => {
                  if (cellId) focusCell(cellId);
                });
              }}
            >
              Keep my version
            </button>
          </div>
        </Dialog>
      ) : null}

      {dialog.kind === 'share' ? (
        <ShareDialog notebookId={notebookId} onClose={() => setDialog({ kind: 'none' })} />
      ) : null}

      {dialog.kind === 'palette' ? (
        <CommandPalette commands={paletteCommands} onClose={() => setDialog({ kind: 'none' })} />
      ) : null}

      {dialog.kind === 'contents' ? (
        <Dialog name="Contents" variant="drawer" onClose={() => setDialog({ kind: 'none' })}>
          <h2>Contents</h2>
          {tocNavigation}
          <button type="button" className="button-plain" onClick={() => setDialog({ kind: 'none' })}>
            Close
          </button>
        </Dialog>
      ) : null}

      {dialog.kind === 'cell-actions' && sheetCell ? (
        <Dialog name="Cell actions" variant="sheet" onClose={() => setDialog({ kind: 'none' })}>
          <h2>Cell actions</h2>
          {canEdit ? (
            <div className="sheet-actions">
              <button
                type="button"
                className="button-embossed"
                onClick={() => {
                  const index = cells.findIndex((cell) => cell.id === sheetCell.id);
                  setDialog({ kind: 'none' });
                  control.select(index);
                  void control.runCells('in-place');
                }}
              >
                Run
              </button>
              <button
                type="button"
                className="button-plain"
                onClick={() => {
                  const index = cells.findIndex((cell) => cell.id === sheetCell.id);
                  setDialog({ kind: 'none' });
                  void control.insertCell('below', 'code', index);
                }}
              >
                Insert below
              </button>
              <button
                type="button"
                className="button-plain"
                onClick={() => {
                  setDialog({ kind: 'none' });
                  void control.changeType(sheetCell.cell_type === 'code' ? 'markdown' : 'code', [
                    sheetCell.id,
                  ]);
                }}
              >
                Change type
              </button>
              <button
                type="button"
                className="button-plain"
                onClick={() => {
                  const index = cells.findIndex((cell) => cell.id === sheetCell.id);
                  setDialog({ kind: 'none' });
                  if (index > 0) void control.moveCell(sheetCell.id, index - 1);
                }}
              >
                Move up
              </button>
              <button
                type="button"
                className="button-plain"
                onClick={() => {
                  const index = cells.findIndex((cell) => cell.id === sheetCell.id);
                  setDialog({ kind: 'none' });
                  if (index < cells.length - 1) void control.moveCell(sheetCell.id, index + 1);
                }}
              >
                Move down
              </button>
              <button
                type="button"
                className="button-plain"
                onClick={() => {
                  setDialog({ kind: 'none' });
                  void control.deleteCells([sheetCell.id]);
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
          <button type="button" className="button-plain" onClick={() => setDialog({ kind: 'none' })}>
            Close
          </button>
        </Dialog>
      ) : null}
    </div>
  );
}
