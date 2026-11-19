import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Code, History, Layers, MonitorPlay, ScrollText, Workflow } from 'lucide-react';
import { api } from '../api.js';
import { store, type DockTab, type RigTab } from '../store.js';
import { Dialog, LiveRegions, Menu, useStoreState } from './common.js';
import { LayerTree } from './LayerTree.js';
import { Inspector } from './Inspector.js';
import { AssetShelf, ActivityPanel, ShowsPanel } from './Panels.js';
import { Stage } from './Stage.js';
import { Timeline } from './Timeline.js';
import { ShaderEditor } from './ShaderEditor.js';
import { NodeGraph } from './NodeGraph.js';
import { ConsolePanel, ScriptEditor } from './ScriptEditor.js';
import { children, findLayer } from '../document.js';
import { STARTER_SHADER_SOURCE, type LayerKind } from '../../shared/domain.js';

export const WORKBENCH: { label: string; icon: ReactNode; rig?: RigTab; dock?: DockTab }[] = [
  { label: 'Layers', icon: <Layers size={18} />, rig: 'layers' },
  { label: 'Assets', icon: <Box size={18} />, rig: 'assets' },
  { label: 'Shaders', icon: <Code size={18} />, dock: 'shader' },
  { label: 'Graph', icon: <Workflow size={18} />, dock: 'graph' },
  { label: 'Scripts', icon: <ScrollText size={18} />, dock: 'script' },
  { label: 'Shows', icon: <MonitorPlay size={18} />, rig: 'shows' },
  { label: 'Activity', icon: <History size={18} />, rig: 'activity' },
];

const DOCK_TABS: { tab: DockTab; label: string }[] = [
  { tab: 'timeline', label: 'Timeline' },
  { tab: 'shader', label: 'Shader editor' },
  { tab: 'graph', label: 'Node graph' },
  { tab: 'script', label: 'Script editor' },
  { tab: 'console', label: 'Console' },
];

const ADD_ITEMS: { label: string; kind: LayerKind }[] = [
  { label: 'Group', kind: 'group' },
  { label: 'Cube', kind: 'cube' },
  { label: 'Sphere', kind: 'sphere' },
  { label: 'Plane', kind: 'plane' },
  { label: 'Torus', kind: 'torus' },
  { label: 'Tube', kind: 'tube' },
  { label: 'Camera', kind: 'camera' },
  { label: 'Light', kind: 'light' },
  { label: 'Model', kind: 'model' },
  { label: 'Shader layer', kind: 'shader' },
];

const COLOUR_VALUES: Record<string, string> = {
  blue: '#4ea8ff',
  green: '#35d05a',
  yellow: '#f2e59a',
  violet: '#b8a4e0',
  orange: '#e09a4e',
  red: '#e4594f',
};

export function Shell({ children: extra }: { children?: ReactNode }) {
  const state = useStoreState();
  const [filter, setFilter] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [newSet, setNewSet] = useState(false);
  const [newSetName, setNewSetName] = useState('Tonight');
  const importInput = useRef<HTMLInputElement | null>(null);
  const doc = state.doc;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      const typing =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target.getAttribute('role') !== 'spinbutton') ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (typing) return;
      if (event.key === ' ') {
        event.preventDefault();
        store.togglePlay();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'w') store.patch({ gizmoMode: 'move' });
      if (key === 'e') store.patch({ gizmoMode: 'rotate' });
      if (key === 'r') store.patch({ gizmoMode: 'scale' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const addLayer = (kind: LayerKind, label: string): void => {
    if (doc === null) return;
    const selected = findLayer(doc, state.selection);
    const parentId = selected === null ? null : selected.kind === 'group' ? selected.id : selected.parent_id;
    const id = crypto.randomUUID();
    store.commit(
      {
        target: id,
        type: 'layer.add',
        payload: { parent_id: parentId, index: children(doc, parentId).length, name: label, kind },
      },
      kind === 'shader' ? () => void store.refreshShaderVersions(id) : undefined,
    );
    if (kind === 'shader') store.shaderSources.set(id, STARTER_SHADER_SOURCE);
    store.select(id);
  };

  const exportSet = async (): Promise<void> => {
    store.region('exportStatus', 'Preparing export');
    try {
      const result = await api.createExport(store.setId);
      store.region('exportStatus', 'Export ready');
      const link = document.createElement('a');
      link.href = result.export.download_url;
      link.download = '';
      document.body.append(link);
      link.click();
      link.remove();
      await store.refreshActivity();
    } catch {
      store.region('exportStatus', 'Asset storage is unreachable. Uploads and publishing are paused.');
    }
  };

  const rigTitle =
    state.rigTab === 'layers'
      ? 'Layers'
      : state.rigTab === 'assets'
        ? 'Assets'
        : state.rigTab === 'shows'
          ? 'Shows'
          : 'Activity';

  return (
    <div className="shell">
      <nav className="workbench" aria-label="Workbench">
        {WORKBENCH.map((tile) => (
          <button
            key={tile.label}
            type="button"
            aria-current={
              (tile.rig !== undefined && state.rigTab === tile.rig && tile.dock === undefined) ||
              (tile.dock !== undefined && state.dockTab === tile.dock)
            }
            onClick={() => {
              if (tile.rig !== undefined) store.patch({ rigTab: tile.rig });
              if (tile.dock !== undefined) store.patch({ dockTab: tile.dock });
              if (tile.rig !== undefined) setDrawerOpen(true);
            }}
          >
            {tile.icon}
            <span className="caption">{tile.label}</span>
          </button>
        ))}
      </nav>

      <div className="menubar">
        <div className="menubar-menus" role="menubar" aria-label="Set menu">
          <Menu
            label="Set"
            items={[
              { label: 'New set', action: () => setNewSet(true) },
              { label: 'Open workspace', action: () => window.location.assign('/workspace') },
              { label: 'Export set', action: () => void exportSet(), disabled: state.demo },
              { label: 'Import set', action: () => importInput.current?.click() },
            ]}
          />
          <Menu
            label="Edit"
            items={[
              {
                label: 'Delete layer',
                action: () => {
                  const layer = findLayer(doc, state.selection);
                  if (layer === null) return;
                  store.commit({
                    target: layer.id,
                    type: 'layer.remove',
                    payload: {},
                    baseVersion: layer.version,
                  });
                },
              },
              {
                label: 'Take lock',
                action: () => {
                  if (state.selection !== null) void store.takeLock(state.selection);
                },
                disabled: state.demo,
              },
              {
                label: 'Release lock',
                action: () => {
                  if (state.selection !== null) void store.releaseLock(state.selection);
                },
                disabled: state.demo,
              },
            ]}
          />
          <Menu
            label="Add"
            items={ADD_ITEMS.map((item) => ({
              label: item.label,
              action: () => addLayer(item.kind, item.label),
            }))}
          />
          <Menu
            label="Stage"
            items={[
              { label: 'Move gizmo', action: () => store.patch({ gizmoMode: 'move' }) },
              { label: 'Rotate gizmo', action: () => store.patch({ gizmoMode: 'rotate' }) },
              { label: 'Scale gizmo', action: () => store.patch({ gizmoMode: 'scale' }) },
              { label: 'Grid snap', action: () => store.patch({ gridSnap: !state.gridSnap }) },
              { label: 'Angle snap', action: () => store.patch({ angleSnap: !state.angleSnap }) },
            ]}
          />
          <Menu
            label="Timeline"
            items={[
              { label: 'Play', action: () => store.play() },
              { label: 'Pause', action: () => store.pause() },
              { label: 'Step beat', action: () => store.stepBeat() },
              { label: 'Stop', action: () => store.stop() },
            ]}
          />
          <Menu
            label="Share"
            items={[
              { label: 'Members and shows', action: () => store.patch({ rigTab: 'shows' }) },
              {
                label: 'Copy show link',
                action: () => {
                  const url = state.shows?.show_url;
                  if (url !== undefined) void navigator.clipboard?.writeText(`${window.location.origin}${url}`);
                },
              },
            ]}
          />
          <Menu
            label="Help"
            items={[{ label: 'Keyboard shortcuts', action: () => setShortcuts(true) }]}
          />
        </div>

        <div className="transport" role="group" aria-label="Beat transport">
          <button type="button" aria-pressed={state.playing} onClick={() => store.play()}>
            Play
          </button>
          <button type="button" onClick={() => store.pause()}>
            Pause
          </button>
          <button type="button" onClick={() => store.stepBeat()}>
            Step beat
          </button>
          <button type="button" onClick={() => store.stop()}>
            Stop
          </button>
        </div>

        <div className="menubar-spacer" />

        <ul className="presence" aria-label="In this set">
          {state.presence.map((member) => {
            const selected = findLayer(doc, member.selection);
            return (
              <li key={member.user_id}>
                <span>{member.display_name}</span>
                <span
                  className="dot"
                  role="img"
                  aria-label={`Cursor colour ${member.colour}`}
                  style={{ background: COLOUR_VALUES[member.colour] ?? '#4ea8ff' }}
                />
                <span className="dim">{selected?.name ?? 'nothing selected'}</span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="row-button rig-toggle"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          Rig panel
        </button>

        {state.user === null ? null : (
          <Menu
            label={state.user.display_name}
            name="Account"
            items={[{ label: 'Sign out', action: () => void store.signOut() }]}
          />
        )}
      </div>

      <div className="centre">
        <div className="banner-strip">
          <div
            className={state.regions.connection === '' ? 'live-regions' : 'banner'}
            role="status"
            aria-live="polite"
            aria-label="Connection"
          >
            {state.regions.connection}
          </div>
          <div
            className={state.regions.serviceStatus === '' ? 'live-regions' : 'banner'}
            role="status"
            aria-live="polite"
            aria-label="Service status"
          >
            {state.regions.serviceStatus}
          </div>
        </div>
        <Stage />
        <div className="dock">
          <div className="tabs" role="tablist" aria-label="Workbench tabs">
            {DOCK_TABS.map((tab) => (
              <button
                key={tab.tab}
                type="button"
                role="tab"
                aria-selected={state.dockTab === tab.tab}
                onClick={() => store.patch({ dockTab: tab.tab })}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="dock-body">
            {state.dockTab === 'timeline' ? <Timeline /> : null}
            {state.dockTab === 'shader' ? <ShaderEditor /> : null}
            {state.dockTab === 'graph' ? <NodeGraph /> : null}
            {state.dockTab === 'script' ? <ScriptEditor /> : null}
            {state.dockTab === 'console' ? <ConsolePanel /> : null}
          </div>
        </div>
      </div>

      <aside className={drawerOpen ? 'rig open' : 'rig'} aria-label="Rig panel">
        <div className="rig-title">
          <h3>{rigTitle}</h3>
          <span className="dim">{doc?.set.name ?? ''}</span>
        </div>
        <div className="rig-search">
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <div className="rig-body">
          {state.rigTab === 'layers' ? (
            <>
              <LayerTree filter={filter} />
              <Inspector />
            </>
          ) : null}
          {state.rigTab === 'assets' ? <AssetShelf /> : null}
          {state.rigTab === 'shows' ? <ShowsPanel /> : null}
          {state.rigTab === 'activity' ? <ActivityPanel /> : null}
        </div>
      </aside>

      <input
        ref={importInput}
        type="file"
        accept=".zip"
        aria-label="Choose an Afterglass export"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          void api.importSet(file).then((document) => window.location.assign(`/sets/${document.set.id}`));
        }}
      />

      <LiveRegions regions={state.regions} inBanner />

      {state.conflict === null ? null : (
        <Dialog title="Someone changed this layer first" alert onClose={() => store.resolveConflict('theirs')}>
          <p className="alert-body">
            {`${state.conflict.changedBy} changed ${state.conflict.layerName} before your edit arrived.`}
          </p>
          <div className="dialog-actions">
            <button type="button" className="row-button" onClick={() => store.resolveConflict('theirs')}>
              Keep theirs
            </button>
            <button type="button" className="row-button" onClick={() => store.resolveConflict('mine')}>
              Reapply mine
            </button>
          </div>
        </Dialog>
      )}

      {shortcuts ? (
        <Dialog title="Keyboard shortcuts" onClose={() => setShortcuts(false)}>
          <ul>
            <li>Space plays or pauses the transport</li>
            <li>K keys the focused row&#39;s property</li>
            <li>W, E and R choose Move, Rotate and Scale</li>
            <li>Ctrl+S or Cmd+S saves in the shader or script editor</li>
            <li>Enter or C opens Connect wire on a focused graph node</li>
          </ul>
          <div className="dialog-actions">
            <button type="button" className="row-button" onClick={() => setShortcuts(false)}>
              Close
            </button>
          </div>
        </Dialog>
      ) : null}

      {newSet ? (
        <Dialog title="New set" onClose={() => setNewSet(false)}>
          <div className="form-row">
            <span className="label">Set name</span>
            <input
              type="text"
              aria-label="Set name"
              value={newSetName}
              onChange={(event) => setNewSetName(event.target.value)}
            />
          </div>
          <label className="checkrow">
            <input type="radio" name="starter" defaultChecked aria-label="Blank stage" />
            Blank stage
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="row-button"
              onClick={() => {
                void api.createSet(newSetName).then((document) => {
                  window.location.assign(`/sets/${document.set.id}`);
                });
              }}
            >
              Create set
            </button>
          </div>
        </Dialog>
      ) : null}

      {extra}
    </div>
  );
}
