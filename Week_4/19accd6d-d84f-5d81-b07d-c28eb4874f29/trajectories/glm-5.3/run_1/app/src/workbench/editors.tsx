import { useEffect, useRef, type ReactNode } from 'react';
import { countLines, byteCountText } from '../../shared/text.js';
import type { InputTab } from '../lib/app-state.js';
import { Icon } from '../ui/icons.js';

export function InputPane({
  tab,
  tabs,
  activeTabId,
  onTextChange,
  onEncodingChange,
  onSelectTab,
  onNewTab,
  onOpenFile,
  onClearInput,
  suggestion,
  onAcceptSuggestion,
  alertText,
  encodingError,
  onSelection,
  phoneMode,
}: {
  tab: InputTab | undefined;
  tabs: InputTab[];
  activeTabId: string;
  onTextChange: (text: string) => void;
  onEncodingChange: (enc: InputTab['encoding']) => void;
  onSelectTab: (id: string) => void;
  onNewTab: () => void;
  onOpenFile: () => void;
  onClearInput: () => void;
  suggestion: string | null;
  onAcceptSuggestion: (op: string) => void;
  alertText: string | null;
  encodingError: string | null;
  onSelection: (sel: { start: number; end: number } | null) => void;
  phoneMode: boolean;
}): ReactNode {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Keep each tab's caret and selection when switching tabs.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !tab) return;
    const sel = tab.selection;
    if (sel) {
      try { editor.setSelectionRange(sel.start, sel.end); } catch { /* detached */ }
    }
  }, [activeTabId]);

  // Span carry tracks the selection within one frame of the change (Business rules).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const report = () => {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      onSelection(start === end ? null : { start, end });
    };
    const onSelect = () => report();
    const onFrame = () => report();
    document.addEventListener('selectionchange', onFrame);
    editor.addEventListener('select', onSelect);
    return () => {
      document.removeEventListener('selectionchange', onFrame);
      editor.removeEventListener('select', onSelect);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelection]);

  const status = encodingError ? 'Not encodable' : tab ? (() => {
    const text = tab.text;
    let bytes = 0;
    if (tab.encoding === 'UTF-8') bytes = new TextEncoder().encode(text).length;
    else if (tab.encoding === 'UTF-16LE') bytes = text.length * 2;
    else bytes = text.length;
    if (tab.file) bytes = tab.file.bytes.length;
    const lines = tab.file ? countLines(tab.file.bytes) : countLines(new TextEncoder().encode(text));
    return byteCountText(bytes, lines);
  })() : '';

  return (
    <section className="pane" aria-label="Input" tabIndex={-1} data-pane="input"
      onDragOver={(e) => { if (!tab?.file) { e.preventDefault(); } }}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFileDropped(f, onOpenFile); }}>
      <div role="tablist" aria-label="Inputs" className="tab-row">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === activeTabId} className="tab"
            tabIndex={t.id === activeTabId ? 0 : -1}
            onClick={() => onSelectTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const at = tabs.findIndex((x) => x.id === activeTabId);
                const next = e.key === 'ArrowLeft' ? at - 1 : at + 1;
                if (next >= 0 && next < tabs.length) onSelectTab(tabs[next].id);
              }
            }}>
            {t.name}
          </button>
        ))}
        <button className="tab" aria-label="New input" onClick={onNewTab} disabled={tabs.length >= 10}>+</button>
      </div>
      <div className="pane-title">
        <h2>Input</h2>
        <div className="tools">
          <button className="icon-btn" aria-label="Open file" onClick={onOpenFile} title="Open file"><Icon name="folder" /></button>
          <button className="icon-btn" aria-label="Clear input" onClick={onClearInput} title="Clear input"><Icon name="x" /></button>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
            <span className="sr-only">Input encoding</span>
            <select
              aria-label="Input encoding"
              value={tab?.encoding ?? 'UTF-8'}
              onChange={(e) => onEncodingChange(e.target.value as InputTab['encoding'])}
              style={{ border: '1px solid var(--divider)', padding: '4px 6px', background: 'var(--surface)' }}
            >
              <option value="UTF-8">UTF-8</option>
              <option value="UTF-16LE">UTF-16LE</option>
              <option value="ISO-8859-1">ISO-8859-1</option>
            </select>
          </label>
        </div>
      </div>
      {tab?.file ? (
        <div className="pane-notice">File: {tab.file.name} · {tab.file.bytes.length} bytes</div>
      ) : null}
      <textarea
        ref={editorRef}
        className="editor"
        aria-label="Input"
        placeholder={phoneMode ? 'Paste input…' : 'Paste your input here…'}
        value={tab?.text ?? ''}
        readOnly={Boolean(tab?.file)}
        onChange={(e) => onTextChange(e.target.value)}
      />
      {suggestion !== null ? (
        <button className="btn" style={{ margin: '0 12px 6px' }} onClick={() => onAcceptSuggestion(suggestion)}>
          Suggested: {suggestion}
        </button>
      ) : null}
      {alertText !== null ? <div className="pane-alert" role="alert">{alertText}</div> : null}
      <div className="pane-status" aria-label="Input status">{status}</div>
    </section>
  );
}

function onFileDropped(file: File, onOpenFile: () => void): void {
  void file;
  onOpenFile();
}

export function OutputPane({
  view,
  onViewChange,
  text,
  notUtf8,
  truncated,
  totalBytes,
  cap,
  onDownload,
  spanSuffix,
  error,
  phoneMode,
}: {
  view: 'Text' | 'Hex';
  onViewChange: (v: 'Text' | 'Hex') => void;
  text: string;
  notUtf8: boolean;
  truncated: boolean;
  totalBytes: number;
  cap: number;
  onDownload: () => void;
  spanSuffix: string | null;
  error: boolean;
  phoneMode: boolean;
}): ReactNode {
  const bytes = error ? 0 : totalBytes;
  const lines = error ? 0 : countLines(new TextEncoder().encode(text));
  const base = error ? 'No output' : byteCountText(bytes, lines);
  const status = spanSuffix ? `${base} · ${spanSuffix}` : base;
  return (
    <section className="pane" aria-label="Output" tabIndex={-1} data-pane="output">
      <div className="pane-title">
        <h2>Output</h2>
        <div className="tools">
          <button className="icon-btn" aria-label="Download output" onClick={onDownload} title="Download output"><Icon name="download" /></button>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
            <span className="sr-only">Output view</span>
            <select
              aria-label="Output view"
              value={view}
              onChange={(e) => onViewChange(e.target.value as 'Text' | 'Hex')}
              style={{ border: '1px solid var(--divider)', padding: '4px 6px', background: 'var(--surface)' }}
            >
              <option value="Text">Text</option>
              <option value="Hex">Hex</option>
            </select>
          </label>
        </div>
      </div>
      <textarea className="editor" aria-label="Output" readOnly value={text} placeholder={phoneMode ? 'Bake to see output' : ''} />
      {notUtf8 ? <div className="pane-notice">Output is not valid UTF-8; showing hex.</div> : null}
      {truncated ? <div className="pane-notice">Showing the first {cap} of {totalBytes} bytes. Download output for all of it.</div> : null}
      <div className="pane-status" aria-label="Output status">{status}</div>
    </section>
  );
}
