import { el, clear, uid, announce } from '../dom.js';
import { api } from '../api.js';
import type { GraphNode } from '../api.js';
import { openDialogWith, closeActiveDialog } from '../dialogs.js';
import { barBeatString, TICKS_PER_BAR } from '../beattime.js';
import { commitOp, layerOf, KEYABLE_PROPERTIES, type EditorContext } from './context.js';

export const TABS = ['Timeline', 'Shader editor', 'Node graph', 'Script editor', 'Console'] as const;

export function buildTimelineDock (ctx: EditorContext): { tabs: HTMLElement; panel: HTMLElement } {
  const tabs = el('div', { class: 'timeline-tabs', role: 'tablist', 'aria-label': 'Workbench tabs' });
  const panel = el('div', { style: 'flex: 1; min-height: 0; position: relative; overflow: hidden;' });
  ctx.rebuildTabs = (): void => rebuildTabs(ctx, tabs, panel);
  ctx.rebuildTimeline = () => { if (ctx.activeTab === 'timeline') renderTimeline(ctx, panel); };
  ctx.rebuildGraph = () => { if (ctx.activeTab === 'node-graph') renderGraph(ctx, panel); };
  ctx.rebuildConsole = () => { if (ctx.activeTab === 'console') renderConsole(ctx, panel); };
  return { tabs, panel };
}

function rebuildTabs (ctx: EditorContext, tabs: HTMLElement, panel: HTMLElement): void {
  clear(tabs);
  TABS.forEach((name, index) => {
    const key = name.toLowerCase().replace(' editor', '').replace(' ', '-');
    const selected = key === ctx.activeTab;
    const tab = el('button', {
      role: 'tab', text: name, id: `tab-${index}`,
      'aria-selected': String(selected),
      tabindex: selected ? '0' : '-1',
      'aria-controls': `tabpanel-${index}`,
    });
    tab.addEventListener('click', () => { ctx.activeTab = key; rebuildTabs(ctx, tabs, panel); });
    tabs.append(tab);
  });
  renderActive(ctx, panel);
}

function renderActive (ctx: EditorContext, panel: HTMLElement): void {
  switch (ctx.activeTab) {
    case 'timeline': renderTimeline(ctx, panel); break;
    case 'shader': renderShaderEditor(ctx, panel); break;
    case 'node-graph': renderGraph(ctx, panel); break;
    case 'script': renderScriptEditor(ctx, panel); break;
    case 'console': renderConsole(ctx, panel); break;
    default: renderTimeline(ctx, panel); break;
  }
}

// ---------- Timeline ----------
const TIMELINE_LEFT = 110;

export const playheadNode = el('span', { class: 'playhead-readout', role: 'timer', 'aria-label': 'Playhead position', text: '1:1 0.000 s' });
const playheadLine = el('div', { class: 'playhead-line' });

function renderTimeline (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const body = el('div', { class: 'timeline-body', role: 'region', 'aria-label': 'Beat timeline' });
  const doc = ctx.store.getDocument();
  if (doc !== null) {
    const width = Math.max(200, body.clientWidth - 130);
    const ruler = el('div', { class: 'timeline-ruler' });
    for (let bar = 0; bar < 64; bar += 4) {
      const left = TIMELINE_LEFT + (bar * TICKS_PER_BAR / 24_576) * width;
      ruler.append(el('div', { class: 'bar-tick', style: `left: ${left}px` }));
      ruler.append(el('span', { class: 'bar-label', style: `left: ${left + 3}px`, text: `${bar + 1}` }));
    }
    body.append(ruler);
    const selected = layerOf(ctx, ctx.selectedLayerId);
    const layerKeys = selected !== null ? doc.keys.filter((key) => key.layer_id === selected.id) : [];
    const properties = [...new Set(layerKeys.map((key) => key.property))];
    for (const property of properties) {
      const keys = layerKeys.filter((key) => key.property === property);
      const lane = el('div', { class: 'beat-lane' }, el('span', { class: 'lane-label', text: property }));
      for (const key of keys) {
        const left = TIMELINE_LEFT + (key.tick / 24_576) * width;
        const diamond = el('button', {
          class: 'key-diamond', style: `left: ${left}px`,
          'aria-label': `Key ${property} at ${barBeatString(key.tick)}`,
        });
        diamond.addEventListener('click', () => { ctx.transport.tick = key.tick; ctx.transport.pause(); ctx.redrawOnce(); ctx.updatePlayhead(key.tick, doc.set.bpm); });
        diamond.addEventListener('keydown', (event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            const layerId = ctx.selectedLayerId;
            if (layerId === null) return;
            void commitOp(ctx, {
              target: layerId,
              baseVersion: ctx.store.layerVersion(layerId),
              type: 'key.remove',
              payload: { property: key.property, tick: key.tick },
            }, () => {
              const d = ctx.store.getDocument();
              if (d === null) return;
              d.keys = d.keys.filter((k) => !(k.layer_id === layerId && k.property === key.property && k.tick === key.tick));
            }).then(() => { ctx.rebuildTimeline(); ctx.rebuildInspector(); });
          }
        });
        lane.append(diamond);
      }
      body.append(lane);
    }
    if (selected !== null && layerKeys.length === 0) {
      body.append(el('div', { class: 'beat-lane' }, el('span', { class: 'lane-label', text: `${selected.name} — no keys yet` })));
    }
  }
  body.append(playheadLine, playheadNode);
  panel.append(body);
  ctx.updatePlayhead(ctx.transport.currentTick(), ctx.store.getDocument()?.set.bpm ?? 120);
}

export function updatePlayhead (ctx: EditorContext, tick: number, bpm: number): void {
  playheadNode.textContent = `${barBeatString(tick)} ${(tick / 96 * 60 / bpm).toFixed(3)} s`;
  const lane = document.querySelector('.timeline-body');
  if (lane instanceof HTMLElement) {
    const width = Math.max(200, lane.clientWidth - 130);
    playheadLine.style.left = `${TIMELINE_LEFT + (tick / 24_576) * width}px`;
  }
}

// ---------- Shader editor ----------
function renderShaderEditor (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const shaderLayer = ctx.store.getDocument()?.layers.find((l) => l.kind === 'shader');
  const source = el('textarea', { class: 'code-editor', 'aria-label': 'GLSL source', spellcheck: 'false' }) as unknown as HTMLTextAreaElement;
  if (shaderLayer !== undefined) {
    if (shaderLayer.shader_source !== undefined) {
      source.value = shaderLayer.shader_source;
    } else if (shaderLayer.id !== undefined) {
      // The layer's latest saved source is version 1, the starter program.
      void api.get<{ source: string }>(`/api/sets/${ctx.setId}/layers/${shaderLayer.id}/shader/versions/${shaderLayer.shader_version ?? 1}`)
        .then((result) => {
          if (result.ok && source.value === '') source.value = result.body.source;
        })
        .catch(() => {});
    }
  }
  const save = el('button', { class: 'row-button primary', text: 'Save shader', style: 'position:absolute; top:4px; right:8px; z-index:2;' });
  save.addEventListener('click', () => saveShader(ctx, source, history));
  const history = el('div', { role: 'list', 'aria-label': 'Shader history', style: 'position:absolute; top:34px; right:0; bottom:0; width: 30%; overflow:auto; border-left: 1px solid #000; padding: 4px;' });
  const wrap = el('div', { style: 'position:absolute; inset:0; right:30%;' }, source);
  panel.append(wrap, save, history);
  if (shaderLayer !== undefined) void loadShaderHistory(ctx, shaderLayer.id, history);
  source.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveShader(ctx, source, history);
    }
  });
}

async function loadShaderHistory (ctx: EditorContext, layerId: string, history: HTMLElement): Promise<void> {
  const result = await api.get<{ versions: { number: number; author: { display_name: string }; created_at: string; restored_from: number | null }[] }>(`/api/sets/${ctx.setId}/layers/${layerId}/shader/versions`);
  if (!result.ok) return;
  clear(history);
  for (const version of result.body.versions) {
    const row = el('div', { class: 'shader-history-row', role: 'listitem' });
    const time = new Date(version.created_at);
    row.append(el('span', { text: `Version ${version.number}` }));
    row.append(el('span', { text: `${version.author.display_name} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}` }));
    if (version.restored_from !== null) row.append(el('span', { text: `Restored from version ${version.restored_from}` }));
    row.append(el('button', {
      class: 'row-button', text: `Restore version ${version.number}`,
      click: () => {
        void commitOp(ctx, {
          target: layerId,
          baseVersion: ctx.store.layerVersion(layerId),
          type: 'shader.restore',
          payload: { from_version: version.number },
        }, () => {
          // The restored source becomes the layer's working source.
          void api.get<{ source: string }>(`/api/sets/${ctx.setId}/layers/${layerId}/shader/versions/${version.number}`)
            .then((fetched) => {
              if (!fetched.ok) return;
              const layer = ctx.store.getDocument()?.layers.find((l) => l.id === layerId);
              if (layer !== undefined) layer.shader_source = fetched.body.source;
              const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="GLSL source"]');
              if (editor !== null) editor.value = fetched.body.source;
            })
            .catch(() => {});
        }).then(() => {
          const layer = ctx.store.getDocument()?.layers.find((l) => l.id === layerId);
          if (layer !== undefined) layer.shader_version = (layer.shader_version ?? 0) + 1;
          void loadShaderHistory(ctx, layerId, history);
          const editor = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="GLSL source"]');
          if (editor !== null && layer?.shader_source !== undefined) editor.value = layer.shader_source;
        });
      },
    }));
    history.append(row);
  }
}

function saveShader (ctx: EditorContext, source: HTMLTextAreaElement, history?: HTMLElement): void {
  const shaderLayer = ctx.store.getDocument()?.layers.find((l) => l.kind === 'shader');
  if (shaderLayer === undefined) return;
  announce(ctx.regions['Shader compile'], 'Compiling');
  const text = source.value;
  if (ctx.renderer !== null) {
    const error = ctx.renderer.shaderError(text);
    if (error !== null) {
      announce(ctx.regions['Shader compile'], `Line ${error.line}: ${error.message}`);
    } else {
      announce(ctx.regions['Shader compile'], 'Compiled');
      ctx.renderer.setShaderProgram(shaderLayer.id, ctx.renderer.compileFragment(text));
    }
  }
  void commitOp(ctx, {
    target: shaderLayer.id,
    baseVersion: ctx.store.layerVersion(shaderLayer.id),
    type: 'shader.save',
    payload: { source: text },
  }, () => {
    shaderLayer.shader_source = text;
    shaderLayer.shader_version = (shaderLayer.shader_version ?? 0) + 1;
  }).then(() => {
    if (history !== undefined) void loadShaderHistory(ctx, shaderLayer.id, history);
  });
}

// ---------- Node graph ----------
function renderGraph (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const canvas = el('div', { class: 'graph-canvas' });
  const addNode = el('button', { class: 'row-button', text: 'Add node', style: 'position:absolute; top:4px; right:8px; z-index:3;' });
  addNode.addEventListener('click', (event) => { event.stopPropagation(); openAddNodeMenu(ctx, canvas); });
  canvas.append(addNode);
  const doc = ctx.store.getDocument();
  const wiresSvg = el('svg', { class: 'graph-wires' });
  canvas.append(wiresSvg);
  if (doc !== null) {
    for (const node of doc.graph.nodes) {
      canvas.append(graphNodeBox(ctx, node));
    }
    for (const wire of doc.graph.wires) {
      const from = doc.graph.nodes.find((n) => n.node_id === wire.from.node_id);
      const to = doc.graph.nodes.find((n) => n.node_id === wire.to.node_id);
      if (from === undefined || to === undefined) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${from.x + 130} ${from.y + 12} C ${from.x + 170} ${from.y + 12}, ${to.x - 40} ${to.y + 12}, ${to.x} ${to.y + 12}`);
      wiresSvg.append(path);
    }
  }
  panel.append(canvas);
}

function graphNodeBox (ctx: EditorContext, node: GraphNode): HTMLElement {
  const ports = ctx.evaluator.portsOf(node.type);
  const box = el('div', {
    class: 'graph-node', role: 'button', tabindex: '0',
    'aria-label': `${node.type} node`,
    style: `left: ${node.x}px; top: ${node.y}px;`,
  });
  box.append(el('div', { class: 'node-title', text: node.type }));
  for (const input of ports.inputs) box.append(el('div', { class: 'graph-port' }, el('span', { text: input }), el('span', { class: 'port-dot' })));
  for (const output of ports.outputs) box.append(el('div', { class: 'graph-port' }, el('span', { class: 'port-dot' }), el('span', { text: output })));
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key.toLowerCase() === 'c') {
      event.preventDefault();
      openConnectWireDialog(ctx, node);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      void commitOp(ctx, {
        target: 'graph',
        type: 'graph.node.remove',
        baseVersion: ctx.store.graphVersion,
        payload: { node_id: node.node_id },
      }, () => {
        const doc = ctx.store.getDocument();
        if (doc === null) return;
        doc.graph.nodes = doc.graph.nodes.filter((n) => n.node_id !== node.node_id);
        doc.graph.wires = doc.graph.wires.filter((w) => w.from.node_id !== node.node_id && w.to.node_id !== node.node_id);
      }).then(() => ctx.rebuildGraph());
    }
  });
  return box;
}

function openAddNodeMenu (ctx: EditorContext, canvas: HTMLElement): void {
  const menu = el('div', { class: 'menu-popover', role: 'menu', style: 'position:absolute; top:36px; right:8px; z-index:30;' });
  const types = ['Beat clock', 'LFO', 'Remap', 'Layer property'];
  const addNode = (type: string): void => {
    const params = type === 'LFO'
      ? { shape: 'sine', rate_beats: 1 }
      : type === 'Remap'
        ? { in_min: -1, in_max: 1, out_min: 0, out_max: 1 }
        : type === 'Layer property'
          ? { layer_id: ctx.selectedLayerId ?? '', property: 'props.twist' }
          : {};
    const nodeId = uid('node');
    void commitOp(ctx, {
      target: 'graph',
      type: 'graph.node.add',
      baseVersion: undefined,
      payload: { node_id: nodeId, type, params, x: 60, y: 60 },
    }, () => {
      const doc = ctx.store.getDocument();
      if (doc === null) return;
      doc.graph.nodes.push({ node_id: nodeId, type, params, x: 60, y: 60 });
    }).then(() => ctx.rebuildGraph());
    menu.remove();
  };
  for (const type of types) menu.append(el('button', { role: 'menuitem', text: type, click: () => addNode(type) }));
  for (const plugin of ctx.pluginNodes) menu.append(el('button', { role: 'menuitem', text: plugin.typeName, click: () => addNode(plugin.typeName) }));
  canvas.append(menu);
  const dismiss = (event: Event): void => {
    if (!menu.contains(event.target as Node)) { menu.remove(); document.removeEventListener('click', dismiss, true); }
  };
  document.addEventListener('click', dismiss, true);
  menu.querySelector('button')?.focus();
}

function openConnectWireDialog (ctx: EditorContext, fromNode: GraphNode): void {
  const doc = ctx.store.getDocument();
  if (doc === null) return;
  const fromPorts = ctx.evaluator.portsOf(fromNode.type).outputs;
  const others = doc.graph.nodes.filter((n) => n.node_id !== fromNode.node_id);
  const toOptions = others.flatMap((node) => ctx.evaluator.portsOf(node.type).inputs.map((port) => ({ node_id: node.node_id, port })));
  let fromIndex = 0;
  let toIndex = 0;
  const fromList = el('div', { role: 'listbox', 'aria-label': 'From port', tabindex: '0' });
  const toList = el('div', { role: 'listbox', 'aria-label': 'To port', tabindex: '0' });
  const render = (): void => {
    clear(fromList); clear(toList);
    fromPorts.forEach((port, index) => fromList.append(el('div', { class: 'listbox-row', role: 'option', 'aria-selected': String(index === fromIndex), text: port })));
    toOptions.forEach((option, index) => toList.append(el('div', { class: 'listbox-row', role: 'option', 'aria-selected': String(index === toIndex), text: `${option.port} of ${doc.graph.nodes.find((n) => n.node_id === option.node_id)?.type}` })));
  };
  render();
  fromList.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { fromIndex = Math.min(fromPorts.length - 1, fromIndex + 1); render(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { fromIndex = Math.max(0, fromIndex - 1); render(); event.preventDefault(); }
  });
  toList.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') { toIndex = Math.min(toOptions.length - 1, toIndex + 1); render(); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { toIndex = Math.max(0, toIndex - 1); render(); event.preventDefault(); }
  });
  const connect = el('button', { type: 'submit', class: 'row-button primary', text: 'Connect' });
  const form = el('form', {},
    el('label', { text: 'From port' }), fromList,
    el('label', { text: 'To port' }), toList,
    connect);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const target = toOptions[toIndex];
    const port = fromPorts[fromIndex];
    if (target !== undefined && port !== undefined) {
      const wireId = uid('wire');
      void commitOp(ctx, {
        target: 'graph',
        type: 'graph.wire.add',
        baseVersion: undefined,
        payload: { wire_id: wireId, from: { node_id: fromNode.node_id, port }, to: target },
      }, () => {
        const doc = ctx.store.getDocument();
        if (doc === null) return;
        doc.graph.wires.push({ wire_id: wireId, from: { node_id: fromNode.node_id, port }, to: target });
      }).then(() => ctx.rebuildGraph());
    }
    closeActiveDialog();
  });
  openDialogWith({ title: 'Connect wire', form });
}

// ---------- Script editor ----------
function renderScriptEditor (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const list = el('div', { role: 'list', 'aria-label': 'Scripts', style: 'position:absolute; top:0; bottom:0; left:0; width:26%; overflow:auto; border-right:1px solid #000; padding:4px;' });
  const source = el('textarea', { class: 'code-editor', 'aria-label': 'Script source', spellcheck: 'false', style: 'position:absolute; top:0; bottom:40px; left:26%; right:0; border:none;' }) as unknown as HTMLTextAreaElement;
  const newScript = el('button', { class: 'row-button', text: 'New script', style: 'margin-bottom:4px;' });
  const save = el('button', { class: 'row-button primary', text: 'Save script', style: 'position:absolute; bottom:6px; left:calc(26% + 8px);' });
  const usesAssets = el('button', { class: 'row-button', text: 'Uses assets', style: 'position:absolute; bottom:6px; left:calc(26% + 110px);' });
  let activeScriptId: string | null = null;
  const pickScript = (): void => {
    const doc = ctx.store.getDocument();
    if (activeScriptId !== null && doc?.scripts.some((s) => s.id === activeScriptId) === true) return;
    activeScriptId = doc?.scripts[0]?.id ?? null;
    const current = doc?.scripts.find((s) => s.id === activeScriptId);
    if (current !== undefined) source.value = current.source;
  };

  const renderList = (): void => {
    clear(list);
    newScript.remove();
    list.append(newScript);
    const doc = ctx.store.getDocument();
    if (doc === null) return;
    if (doc.scripts.length === 0) list.append(el('div', { class: 'empty-state', text: 'No scripts yet' }));
    for (const script of doc.scripts) {
      const row = el('div', { class: 'script-row', role: 'listitem', tabindex: '0', text: script.name });
      row.addEventListener('click', () => { activeScriptId = script.id; source.value = script.source; });
      list.append(row);
    }
  };
  renderList();
  pickScript();
  newScript.addEventListener('click', () => {
    const scriptId = uid('script');
    const starterSource = 'function onBeat(ctx) {\n  ctx.set("Cube", "scale.x", 1.5);\n}\n';
    void commitOp(ctx, {
      target: scriptId,
      type: 'script.add',
      baseVersion: undefined,
      payload: { name: 'Pulse script', source: starterSource },
    }, () => {
      const doc = ctx.store.getDocument();
      if (doc === null) return;
      doc.scripts.push({ id: scriptId, name: 'Pulse script', version: 1, source: starterSource, asset_ids: [] });
      activeScriptId = scriptId;
      source.value = starterSource;
    }).then(() => { renderList(); ctx.runAllScripts(); });
  });
  save.addEventListener('click', () => {
    const doc = ctx.store.getDocument();
    if (doc === null) return;
    pickScript();
    const text = source.value;
    if (activeScriptId !== null) {
      const script = doc.scripts.find((s) => s.id === activeScriptId);
      if (script !== undefined) {
        void commitOp(ctx, {
          target: script.id,
          baseVersion: ctx.store.scriptVersion(script.id),
          type: 'script.save',
          payload: { source: text, asset_ids: script.asset_ids },
        }, () => {
          script.source = text;
          script.version += 1;
        }).then(() => ctx.runAllScripts());
        return;
      }
    }
  });
  usesAssets.addEventListener('click', () => openScriptAssetsDialog(ctx, activeScriptId));
  source.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save.click();
    }
  });
  panel.append(list, source, save, usesAssets);
}

function openScriptAssetsDialog (ctx: EditorContext, scriptId: string | null): void {
  const doc = ctx.store.getDocument();
  const script = doc?.scripts.find((s) => s.id === scriptId);
  const textures = ctx.currentAssets.filter((a) => a.kind === 'texture' && a.status === 'ready');
  const boxes = textures.map((asset) => {
    const box = el('input', { type: 'checkbox', ...(script?.asset_ids.includes(asset.id) ? { checked: true } : {}) }) as unknown as HTMLInputElement;
    return { asset, box };
  });
  const form = el('form', {},
    ...boxes.map((b) => el('div', { class: 'radio-row' }, b.box, el('label', { text: b.asset.name }))),
    el('button', { type: 'submit', class: 'row-button primary', text: 'Done' }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const assetIds = boxes.filter((b) => b.box.checked).map((b) => b.asset.id);
    if (script !== undefined) {
      const source = (document.querySelector('textarea[aria-label="Script source"]') as HTMLTextAreaElement | null)?.value ?? script.source;
      void commitOp(ctx, {
        target: script.id,
        baseVersion: ctx.store.scriptVersion(script.id),
        type: 'script.save',
        payload: { source, asset_ids: assetIds },
      }, () => {
        script.asset_ids = assetIds;
      }).then(() => ctx.runAllScripts());
    }
    closeActiveDialog();
  });
  openDialogWith({ title: 'Script assets', form });
}

// ---------- Console ----------
function renderConsole (ctx: EditorContext, panel: HTMLElement): void {
  clear(panel);
  const log = el('div', { class: 'console-log', role: 'log', 'aria-label': 'Console' });
  for (const line of ctx.consoleLines.slice(-100)) {
    log.append(el('div', { class: line.error ? 'error' : '', text: `${line.scriptName}: ${line.text.replace(`${line.scriptName}: `, '')}` }));
  }
  panel.append(log);
}

