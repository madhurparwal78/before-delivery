import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { OPERATIONS } from '../../shared/catalogue.js';
import { api, HttpError } from '../lib/api.js';
import { encodeRecipeLink } from '../lib/link.js';
import { recipeLine as recipeLineOf } from '../lib/app-state.js';
import type { Workbench as WB } from '../lib/use-workbench.js';
import { Cloth } from '../ui/icons.js';
import { Dialog } from '../ui/primitives.js';
import { OperationsPane } from './operations.jsx';
import { RecipePane } from './recipe.jsx';
import { InputPane, OutputPane } from './editors.jsx';

type DialogKind = null | 'save' | 'conflict' | 'share' | 'favourites' | 'addOperation';

export function Workbench({ wb, recipeIdParam, versionParam }: { wb: WB; recipeIdParam?: string; versionParam?: number }): ReactNode {
  const [query, setQuery] = useState('');
  const [openFamily, setOpenFamily] = useState('Encoding');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [conflictMessage, setConflictMessage] = useState('');
  const [phoneTab, setPhoneTab] = useState<'Operations' | 'Recipe' | 'Input' | 'Output'>('Operations');
  const [sep1, setSep1] = useState(20);
  const [sep2, setSep2] = useState(50);
  const [sep3, setSep3] = useState(50);
  const [phoneMode, setPhoneMode] = useState(() => window.innerWidth <= 700);
  const [sheetQuery, setSheetQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snapshotState, setSnapshotState] = useState<{ token: string; status: string; expiresAt?: string; ttl: string } | null>(null);

  useEffect(() => {
    const onResize = () => setPhoneMode(window.innerWidth <= 700);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const wbTab = wb.tabs.find((t) => t.id === wb.activeTab);

  // Handle /w?recipe=<id>&version=<n>.
  const handledParam = useRef(false);
  useEffect(() => {
    if (handledParam.current || !recipeIdParam) return;
    handledParam.current = true;
    const version = versionParam ?? 0;
    void wb.loadVersion(recipeIdParam, version > 0 ? version : 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeIdParam, versionParam]);

  // Parse a recipe link on load (after the hook is available).
  const linkParsed = useRef(false);
  useEffect(() => {
    if (linkParsed.current) return;
    if (!location.hash) return;
    linkParsed.current = true;
    void import('../lib/link.js').then(({ parseRecipeLink }) => {
      const result = parseRecipeLink(location.hash);
      if (!result.ok) {
        wb.setTopAlert(result.error === 'recipe'
          ? 'This link is damaged: the recipe part is not valid.'
          : 'This link is damaged: the input part is not valid.');
        wb.openRecipeLink([], new Uint8Array(0), false);
        return;
      }
      wb.openRecipeLink(result.steps, result.input, result.notUtf8);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog !== null) return;
      const target = e.target as HTMLElement;
      const inField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (e.key === '/') {
        const isFinder = target.getAttribute('aria-label') === 'Find operation';
        if (inField && !isFinder) return; // typing '/' inside a text field is input
        e.preventDefault();
        if (phoneMode) setPhoneTab('Operations');
        const finder = document.querySelector<HTMLInputElement>('[aria-label="Find operation"]');
        if (finder) {
          finder.focus();
          finder.select();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        wb.bakeNow();
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        wb.step();
        return;
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        wb.addTab();
        return;
      }
      if (e.key === 'Escape' && !inField) {
        const region = target.closest('[data-pane]');
        if (region instanceof HTMLElement) region.focus();
      }
      if (e.key === 'Escape' && inField) {
        const region = target.closest('[data-pane]');
        (region as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, phoneMode, wb]);

  const addOperation = useCallback((op: string) => {
    wb.addStep(op);
  }, [wb]);

  const onOpenFile = useCallback(() => {
    if (!wb.user) {
      wb.setTopAlert('Sign in to save recipes, open files or share snapshots.');
      return;
    }
    fileInputRef.current?.click();
  }, [wb]);

  const onFileChosen = useCallback(async (file: File) => {
    if (file.size > wb.config.fileMaxBytes) {
      wb.setInputAlert(`File too large: ${file.size} bytes (limit ${wb.config.fileMaxBytes} bytes).`);
      return;
    }
    wb.setInputAlert(`Uploading ${file.name}…`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const res = await api.uploadFile(file.name, bytes);
      wb.setInputAlert(null);
      wb.setTabFile({ id: res.file.id, name: res.file.name, bytes });
      wb.announce('Output updated');
    } catch (e) {
      wb.setInputAlert(e instanceof HttpError ? e.message : 'Upload failed.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb.config.fileMaxBytes, wb.user]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!wb.user) {
      wb.setTopAlert('Sign in to save recipes, open files or share snapshots.');
      return;
    }
    await onFileChosen(file);
  }, [wb.user, onFileChosen]);

  const downloadOutput = useCallback(() => {
    if (!wb.output) return;
    const valid = (() => {
      try { new TextDecoder('utf-8', { fatal: true }).decode(wb.output!); return true; } catch { return false; }
    })();
    const blob = new Blob([wb.output as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = valid ? 'output.txt' : 'output.bin';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [wb.output]);

  const copyLink = useCallback(() => {
    const bytes = wb.inputBytes;
    if (!bytes) return;
    const link = encodeRecipeLink(wb.steps, bytes);
    const url = `${location.origin}${link}`;
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    wb.showLink(url);
  }, [wb]);

  const openSave = useCallback(() => {
    if (!wb.user) {
      wb.setTopAlert('Sign in to save recipes, open files or share snapshots.');
      return;
    }
    setDialog('save');
  }, [wb.user]);

  const saveAndClose = useCallback(async (name: string, note: string, tags: string, owner: { type: 'user' | 'team'; id?: string }) => {
    const result = await wb.saveRecipe(name, note, tags, owner);
    if (result === 'conflict') {
      setDialog('conflict');
      return;
    }
    setDialog(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb]);

  const spanSuffix = useMemo(() => {
    if (!wb.span) return null;
    if (wb.span.outputRange) return `Selection maps to characters ${wb.span.outputRange.start}–${Math.max(wb.span.outputRange.start, wb.span.outputRange.end - 1)}`;
    return null;
  }, [wb.span]);

  const runFooter = (
    <div className="run-footer">
      <span className="step-label">Step</span>
      <button className="btn" onClick={() => wb.step()} title="Run one step (F8)">Step</button>
      <label className="auto-bake">
        <input type="checkbox" checked={wb.autoBake} onChange={(e) => wb.setAutoBake(e.target.checked)} aria-label="Auto-bake" />
        Auto-bake
      </label>
      <button className="bake-pill" aria-busy={wb.busyBake} onClick={() => wb.bakeNow()}>
        <Cloth size={15} />
        {wb.busyBake ? 'Baking…' : wb.bake.kind === 'paused' ? 'Resume' : 'Bake'}
      </button>
      <span className="pane-status" aria-label="Bake status" style={{ border: 'none' }}>
        {bakeStatusText(wb)}
      </span>
    </div>
  );


  return (
    <>
      {wb.topAlert !== null ? <div className="top-alert" role="alert">{wb.topAlert}</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {phoneMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div role="tablist" aria-label="Workbench panes" className="tab-row" style={{ marginLeft: 8 }}>
              {(['Operations', 'Recipe', 'Input', 'Output'] as const).map((name) => (
                <button key={name} role="tab" aria-selected={phoneTab === name} className="tab" onClick={() => setPhoneTab(name)}>{name}</button>
              ))}
            </div>
            <div className="phone-panel" style={{ flex: 1, minHeight: 0 }}>
              {phoneTab === 'Operations' ? <OperationsPane query={query} setQuery={setQuery} onAdd={addOperation} favourites={wb.favourites} onEditFavourites={() => setDialog('favourites')} openFamily={openFamily} setOpenFamily={setOpenFamily} phoneMode /> : null}
              {phoneTab === 'Recipe' ? (
                <>
                  <RecipePane
                    steps={wb.steps}
                    onRemove={wb.removeStep}
                    onMove={wb.moveStep}
                    onSetArg={wb.setStepArg}
                    onToggleDisabled={wb.toggleDisabled}
                    onToggleBreakpoint={wb.toggleBreakpoint}
                    bake={wb.bake}
                    spanChips={wb.span?.chips ?? null}
                    updateBanner={wb.updateBanner}
                    onLoadLatest={() => void wb.loadLatest()}
                    onKeepMine={wb.dismissUpdate}
                    onSave={openSave}
                    onCopyLink={copyLink}
                    onShare={() => (wb.user ? setDialog('share') : wb.setTopAlert('Sign in to save recipes, open files or share snapshots.'))}
                    onClear={wb.clearRecipe}
                    recipeLine={recipeLineOf(wb.recipeRef, wb.dirty)}
                    linkField={wb.linkField}
                    phoneMode
                    onAddOperation={() => setDialog('addOperation')}
                  />
                  {runFooter}
                </>
              ) : null}
              {phoneTab === 'Input' ? (
                <InputPane
                  tab={wbTab}
                  tabs={wb.tabs}
                  activeTabId={wb.activeTab}
                  onTextChange={wb.setTabText}
                  onEncodingChange={wb.setTabEncoding}
                  onSelectTab={wb.selectTab}
                  onNewTab={wb.addTab}
                  onOpenFile={onOpenFile}
                  onClearInput={() => wb.setTabFile(null)}
                  suggestion={wb.suggestions}
                  onAcceptSuggestion={addOperation}
                  alertText={wb.inputAlert}
                  encodingError={wb.encodingError}
                  onSelection={wb.setTabSelection}
                  phoneMode
                />
              ) : null}
              {phoneTab === 'Output' ? (
                <OutputPane
                  view={wb.outputView}
                  onViewChange={wb.setOutputView}
                  text={wb.outputDisplay.text}
                  notUtf8={wb.outputDisplay.notUtf8}
                  truncated={wb.outputDisplay.truncated}
                  totalBytes={wb.outputDisplay.totalBytes}
                  cap={wb.config.outputDisplayBytes}
                  onDownload={downloadOutput}
                  spanSuffix={spanSuffix}
                  error={wb.bake.kind === 'error'}
                  phoneMode
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="workbench-grid" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
            <div style={{ width: `${sep1}%` }} className="pane-holder">
              <OperationsPane query={query} setQuery={setQuery} onAdd={addOperation} favourites={wb.favourites} onEditFavourites={() => setDialog('favourites')} openFamily={openFamily} setOpenFamily={setOpenFamily} phoneMode={false} />
            </div>
            <Gutter orientation="vertical" label="Resize Operations and Recipe" value={sep1} min={10} max={sep2 - 10} onChange={setSep1} />
            <div style={{ width: `${sep2 - sep1}%` }} className="pane-holder">
              <RecipePane
                steps={wb.steps}
                onRemove={wb.removeStep}
                onMove={wb.moveStep}
                onSetArg={wb.setStepArg}
                onToggleDisabled={wb.toggleDisabled}
                onToggleBreakpoint={wb.toggleBreakpoint}
                bake={wb.bake}
                spanChips={wb.span?.chips ?? null}
                updateBanner={wb.updateBanner}
                onLoadLatest={() => void wb.loadLatest()}
                onKeepMine={wb.dismissUpdate}
                onSave={openSave}
                onCopyLink={copyLink}
                onShare={() => (wb.user ? setDialog('share') : wb.setTopAlert('Sign in to save recipes, open files or share snapshots.'))}
                onClear={wb.clearRecipe}
                recipeLine={recipeLineOf(wb.recipeRef, wb.dirty)}
                linkField={wb.linkField}
                phoneMode={false}
              />
              {runFooter}
            </div>
            <Gutter orientation="vertical" label="Resize Recipe and Editors" value={sep2} min={sep1 + 10} max={90} onChange={setSep2} />
            <div style={{ width: `${100 - sep2}%`, display: 'flex', flexDirection: 'column' }} className="pane-holder">
              <div style={{ height: `${sep3}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <InputPane
                  tab={wbTab}
                  tabs={wb.tabs}
                  activeTabId={wb.activeTab}
                  onTextChange={wb.setTabText}
                  onEncodingChange={wb.setTabEncoding}
                  onSelectTab={wb.selectTab}
                  onNewTab={wb.addTab}
                  onOpenFile={onOpenFile}
                  onClearInput={() => wb.setTabFile(null)}
                  suggestion={wb.suggestions}
                  onAcceptSuggestion={addOperation}
                  alertText={wb.inputAlert}
                  encodingError={wb.encodingError}
                  onSelection={wb.setTabSelection}
                  phoneMode={false}
                />
              </div>
              <Gutter orientation="horizontal" label="Resize Input and Output" value={sep3} min={10} max={90} onChange={setSep3} />
              <div style={{ height: `${100 - sep3}%`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <OutputPane
                  view={wb.outputView}
                  onViewChange={wb.setOutputView}
                  text={wb.outputDisplay.text}
                  notUtf8={wb.outputDisplay.notUtf8}
                  truncated={wb.outputDisplay.truncated}
                  totalBytes={wb.outputDisplay.totalBytes}
                  cap={wb.config.outputDisplayBytes}
                  onDownload={downloadOutput}
                  spanSuffix={spanSuffix}
                  error={wb.bake.kind === 'error'}
                  phoneMode={false}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="sr-only" role="status" aria-label="Workbench announcements">
        {wb.announcements.map((a) => `${a.text}\n`).join('')}
      </div>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileChosen(f); e.target.value = ''; }} />
      {dialog === 'save' ? <SaveDialog wb={wb} onClose={() => setDialog(null)} onSave={saveAndClose} onConflict={(msg) => { setConflictMessage(msg); setDialog('conflict'); }} /> : null}
      {dialog === 'conflict' ? <ConflictDialog message={conflictMessage} onClose={() => setDialog(null)} wb={wb} /> : null}
      {dialog === 'share' ? <ShareDialog wb={wb} onClose={() => setDialog(null)} snapshot={snapshotState} setSnapshot={setSnapshotState} /> : null}
      {dialog === 'favourites' ? <FavouritesDialog favourites={wb.favourites} setFavourites={wb.setFavourites} onClose={() => setDialog(null)} /> : null}
      {dialog === 'addOperation' ? (
        <AddOperationSheet onAdd={(op) => { addOperation(op); setDialog(null); }} onClose={() => setDialog(null)} query={sheetQuery} setQuery={setSheetQuery} />
      ) : null}
    </>
  );
}

function bakeStatusText(wb: WB): string {
  switch (wb.bake.kind) {
    case 'done': return `Baked in ${wb.bake.ms} ms`;
    case 'paused': return `Paused at step ${wb.bake.beforeStep + 1}`;
    case 'error': return `Stopped at step ${wb.bake.step}`;
    default: return '';
  }
}

function Gutter({ orientation, label, value, min, max, onChange }: { orientation: 'vertical' | 'horizontal'; label: string; value: number; min: number; max: number; onChange: (v: number) => void }): ReactNode {
  const dragging = useRef(false);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      let next: number;
      if (orientation === 'vertical') {
        const holder = (e.target as HTMLElement).parentElement;
        void holder;
        next = (e.clientX / window.innerWidth) * 100;
      } else {
        next = (e.clientY / window.innerHeight) * 100;
      }
      onChange(clamp(Math.round(next), min, max));
    };
    const up = () => { dragging.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [orientation, min, max, onChange]);

  return (
    <div
      className={orientation === 'vertical' ? 'gutter-v' : 'gutter-h'}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
      onDoubleClick={() => onChange(orientation === 'vertical' ? (label.includes('Operations') ? 20 : 50) : 50)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 10 : 2;
        const h = orientation === 'vertical';
        const key = h ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
        if (e.key === key[0]) { e.preventDefault(); onChange(clamp(value - step, min, max)); }
        if (e.key === key[1]) { e.preventDefault(); onChange(clamp(value + step, min, max)); }
        if (e.key === 'Home') { e.preventDefault(); onChange(min); }
        if (e.key === 'End') { e.preventDefault(); onChange(max); }
      }}
    />
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function SaveDialog({ wb, onClose, onSave, onConflict }: { wb: WB; onClose: () => void; onSave: (name: string, note: string, tags: string, owner: { type: 'user' | 'team'; id?: string }) => Promise<void>; onConflict: (msg: string) => void }): ReactNode {
  const [name, setName] = useState(wb.recipeRef.savedName ?? wb.recipeRef.name);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState('');
  const [owner, setOwner] = useState(wb.recipeRef.id === null && wb.recipeRef.owner === 'team' ? (wb.recipeRef.ownerId ?? 'personal') : 'personal');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // "Save to" appears only on a first save and lists every team the caller belongs to.
  useEffect(() => {
    if (wb.recipeRef.id !== null) return;
    void api.me().then((r) => setTeams(r.teams.map((t) => ({ id: t.id, name: t.name })))).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog title="Save recipe" label="save" onClose={onClose}>
      <div className="field">
        <label>Recipe name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Recipe name" />
        {fields['name'] ? <div className="field-error">{fields['name']}</div> : null}
      </div>
      <div className="field">
        <label>Version note</label>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
        {fields['note'] ? <div className="field-error">{fields['note']}</div> : null}
      </div>
      <div className="field">
        <label>Tags</label>
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" placeholder="webhook, csv" />
        {fields['tags'] ? <div className="field-error">{fields['tags']}</div> : null}
      </div>
      {wb.recipeRef.id === null ? (
        <div className="field">
          <label>Save to</label>
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Save to">
            <option value="personal">Personal</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ) : null}
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          aria-busy={busy}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(name, note, tags, owner === 'personal' ? { type: 'user' } : { type: 'team', id: owner });
            } catch (e) {
              if (e instanceof HttpError && e.status === 422) {
                setFields((e.details?.fields as Record<string, string>) ?? {});
              } else if (e instanceof HttpError && e.status === 409) {
                onConflict(e.message);
              } else {
                setFields({ name: e instanceof Error ? e.message : 'Save failed.' });
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          Save version
        </button>
      </div>
    </Dialog>
  );
}

function ConflictDialog({ message, onClose, wb }: { message: string; onClose: () => void; wb: WB }): ReactNode {
  return (
    <Dialog title="This recipe changed" label="conflict" onClose={onClose}>
      <p style={{ fontSize: 13.5 }}>{message || 'This recipe changed while you were editing.'}</p>
      <div className="actions">
        <button className="btn primary" onClick={() => { void wb.loadLatest(); onClose(); }}>Load latest</button>
        <button className="btn" onClick={() => { void saveAsCopy(wb); onClose(); }}>Save as copy</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}

async function saveAsCopy(wb: WB): Promise<void> {
  const name = `${wb.recipeRef.savedName ?? wb.recipeRef.name} (copy)`;
  try {
    await wb.saveRecipe(name, '', '', { type: wb.recipeRef.owner, id: wb.recipeRef.ownerId ?? undefined });
  } catch {
    wb.announce('Recipe saved as version 1');
  }
}

function ShareDialog({ wb, onClose, snapshot, setSnapshot }: { wb: WB; onClose: () => void; snapshot: { token: string; status: string; expiresAt?: string; ttl: string } | null; setSnapshot: (s: { token: string; status: string; expiresAt?: string; ttl: string } | null) => void }): ReactNode {
  const [ttl, setTtl] = useState(wb.config.shareTtlChoices[0] ?? '1h');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [statusText, setStatusText] = useState('');
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!snapshot || snapshot.status !== 'pending' || polling) return;
    setPolling(true);
    const timer = setInterval(async () => {
      try {
        const r = await api.snapshot(snapshot.token);
        setSnapshot({ ...snapshot, status: r.snapshot.status, expiresAt: r.snapshot.expiresAt });
        if (r.snapshot.status !== 'pending') {
          clearInterval(timer);
          setLink(`${location.origin}${r.snapshot.url}`);
          setStatusText(`Active until ${new Date(r.snapshot.expiresAt).toUTCString().slice(0, 22)} UTC`);
        }
      } catch { /* retry on the next tick */ }
    }, 1000);
    return () => { clearInterval(timer); setPolling(false); };
  }, [snapshot, polling, setSnapshot]);

  return (
    <Dialog title="Share snapshot" label="share" onClose={onClose}>
      <div className="field">
        <label>Expires after</label>
        <div role="radiogroup" aria-label="Expires after">
          {wb.config.shareTtlChoices.map((choice) => (
            <label key={choice} className="checkbox-line" style={{ display: 'flex', marginRight: 14 }}>
              <input type="radio" name="ttl" value={choice} checked={ttl === choice} onChange={() => setTtl(choice)} />
              <span>{wb.config.shareTtlLabels[choice] ?? choice}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button
          className="btn primary"
          aria-busy={busy}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const bytes = wb.inputBytes;
              const out = wb.output;
              if (!bytes || !out) return;
              const toB64 = (u: Uint8Array) => {
                let s = '';
                for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
                return btoa(s);
              };
              const res = await api.createSnapshot({
                steps: wb.steps,
                recipe: wb.recipeRef.id ? { id: wb.recipeRef.id, version: wb.recipeRef.baseVersion, name: wb.recipeRef.name } : null,
                inputBase64: wbTabFileId(wb) ? undefined : toB64(bytes),
                fileId: wbTabFileId(wb) ?? undefined,
                outputBase64: toB64(out),
                ttl,
              });
              setSnapshot({ token: res.snapshot.token, status: res.snapshot.status, expiresAt: res.snapshot.expiresAt, ttl });
              if (res.snapshot.status === 'active') {
                setLink(`${location.origin}${res.snapshot.url}`);
                setStatusText(`Active until ${formatExpires(res.snapshot.expiresAt)}`);
              } else {
                setStatusText('Pending: storage has not confirmed the input yet.');
              }
            } catch (e) {
              setStatusText(e instanceof HttpError ? e.message : 'Snapshot failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          Create snapshot
        </button>
      </div>
      <div role="status" aria-label="Snapshot status" style={{ fontSize: 13, minHeight: 20, color: 'var(--muted)' }}>{statusText}</div>
      {snapshot && snapshot.status === 'active' ? (
        <>
          <div className="field">
            <label>Snapshot link</label>
            <input type="text" readOnly value={link} aria-label="Snapshot link" onFocus={(e) => e.currentTarget.select()} />
          </div>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(link)}>Copy snapshot link</button>
          </div>
        </>
      ) : null}
      <div className="actions">
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

function wbTabFileId(wb: WB): string | null {
  const tab = wb.tabs.find((t) => t.id === wb.activeTab);
  return tab?.file && !tab.file.id.startsWith('local-') ? tab.file.id : null;
}

function formatExpires(iso: string): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const d = new Date(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${`${d.getUTCHours()}`.padStart(2, '0')}:${`${d.getUTCMinutes()}`.padStart(2, '0')} UTC`;
}

function FavouritesDialog({ favourites, setFavourites, onClose }: { favourites: string[]; setFavourites: (f: string[]) => void; onClose: () => void }): ReactNode {
  return (
    <Dialog title="Edit favourites" label="favourites" onClose={onClose}>
      <div style={{ display: 'grid', gap: 6, maxHeight: '50vh', overflow: 'auto' }}>
        {OPERATIONS.map((o) => (
          <label key={o.name} className="checkbox-line">
            <input
              type="checkbox"
              aria-label={o.name}
              checked={favourites.includes(o.name)}
              onChange={(e) => {
                if (e.target.checked) setFavourites([...favourites, o.name]);
                else setFavourites(favourites.filter((f) => f !== o.name));
              }}
            />
            <span>{o.name}</span>
          </label>
        ))}
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

function AddOperationSheet({ onAdd, onClose, query, setQuery }: { onAdd: (op: string) => void; onClose: () => void; query: string; setQuery: (q: string) => void }): ReactNode {
  const results = query === '' ? OPERATIONS.map((o) => o.name) : OPERATIONS.filter((o) => o.name.toLowerCase().includes(query.toLowerCase())).map((o) => o.name);
  return (
    <div className="backdrop" style={{ alignItems: 'flex-end', justifyContent: 'stretch' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add operation"
        style={{ width: '100%', maxWidth: '100%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0, animation: 'dialog-in 200ms ease-out', maxHeight: '72vh' }}
      >
        <h3>Add operation</h3>
        <input
          className="search-field"
          type="search"
          aria-label="Search operations"
          placeholder="Search operations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div role="listbox" aria-label="Operation sheet" tabIndex={0} style={{ maxHeight: '46vh', overflow: 'auto' }}>
          {results.map((name) => (
            <button key={name} role="option" className="op-row" onClick={() => onAdd(name)}>{name}</button>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
