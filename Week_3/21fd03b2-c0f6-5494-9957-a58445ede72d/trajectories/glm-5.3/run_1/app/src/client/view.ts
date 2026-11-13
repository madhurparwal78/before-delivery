import { api } from './api';
import { h, chip } from './ui';
import { COPY } from '../bench/copy';
import { KIND_SPECS, type SceneDocument } from '../bench/scene';
import { readoutsForObject, formatReadout } from '../bench/readouts';
import { makeBody, runSteps, stepZeroState, stateHashInput, type Body } from '../bench/sim';
import { sha256Hex } from '../bench/hash';
import { StageRenderer } from './render';
import { stepStateFor } from './editor-util';

type ViewProject = { project: { name: string }; scenes: Array<{ id: string; name: string; stateHash: string }> };
type ViewScene = { scene: { id: string; name: string; status: string; revision: number; stateHash: string }; document: SceneDocument; assets: Array<{ id: string; name: string; sha256: string; kind: string; extentMetres: number | null }> };

const DEAD_LINK_HEADING = COPY.pages.deadLink;

export function viewScreen(root: HTMLElement, token: string): void {
  document.title = 'Shared project - Rampwright';
  const shell = h('div', { class: 'app-root' });
  root.append(shell);
  void (async () => {
    const result = await api('GET', `/api/view/${token}`);
    if (!result.ok) {
      deadLink(shell);
      return;
    }
    const data = result.body as ViewProject;
    shell.append(h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools' },
      h('span', { class: 'wordmark' }, 'Rampwright')));
    const panel = h('div', { class: 'dock-panel', role: 'region', 'aria-label': 'Scenes', style: { width: 'min(760px, calc(100% - 24px))', margin: '24px auto', padding: '14px' } },
      h('h1', { style: { fontSize: '16px', margin: '0 0 8px' } }, data.project.name),
      h('ul', { style: { listStyle: 'none', padding: '0' } },
        ...data.scenes.map((s) => h('li', { class: 'row' }, h('a', { href: `/view/${token}/s/${s.id}` }, s.name)))),
    );
    shell.append(panel);
    watchLink(token, shell);
  })();
}

export function viewSceneScreen(root: HTMLElement, token: string, sid: string): void {
  document.title = 'Shared scene - Rampwright';
  const shell = h('div', { class: 'app-root', style: { height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' } });
  root.append(shell);
  void (async () => {
    const result = await api('GET', `/api/view/${token}/scenes/${sid}`);
    if (!result.ok) {
      shell.replaceChildren();
      deadLink(shell);
      return;
    }
    const data = result.body as ViewScene;
    document.title = `${data.scene.name} - Rampwright`;
    let doc = data.document;
    const bar = h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools', style: { flex: '0 0 auto' } });
    let mode: 'edit' | 'run' = 'edit';
    let paused = false;
    let bodies: Body[] = [];
    let stepCount = 0;
    let runHash = data.scene.stateHash;
    let raf: number | null = null;
    const frameTimes: number[] = [];
    const runBtn = chip('Run', { onClick: () => void run() });
    const pauseBtn = chip('Pause', { disabled: true, onClick: () => togglePause() });
    const stepBtn = chip('Step', { disabled: true, onClick: () => stepOnce() });
    bar.append(runBtn, pauseBtn, stepBtn, h('span', { class: 'tb-spacer' }), h('span', { class: 'wordmark' }, 'Rampwright'));
    shell.append(bar);
    const stageHost = h('div', { class: 'stage-root' });
    shell.append(stageHost);
    let renderer: StageRenderer | null = null;
    try {
      const canvas = h('canvas', { class: 'stage-canvas', role: 'application', 'aria-label': 'Stage', tabindex: '0' }) as HTMLCanvasElement;
      stageHost.append(canvas);
      renderer = new StageRenderer(canvas);
    } catch {
      stageHost.append(h('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 15%', textAlign: 'center' } }, COPY.pages.noWebgl));
    }
    const telemetry = h('div', { class: 'telemetry-card', role: 'group', 'aria-label': 'Run telemetry', style: { top: '4px' } });
    const fpsLine = h('div', { class: 'fps-go', style: { fontWeight: '700' } }, 'fps 0');
    const msLine = h('div', {}, 'ms 0.0');
    const stepLine = h('div', {}, 'step 0');
    const hashLine = h('div', {}, `hash ${runHash.slice(0, 12)}`);
    telemetry.append(fpsLine, msLine, stepLine, hashLine);
    stageHost.append(telemetry);
    const modePill = h('div', { class: 'mode-pill', role: 'status', 'aria-label': 'Mode', style: { display: 'none' } }, 'RUNNING');
    stageHost.append(modePill);

    const outlinePanel = h('div', { class: 'dock-panel', role: 'region', 'aria-label': 'Outline', style: { position: 'absolute', right: '8px', top: '50px', width: '250px', maxHeight: '45%', zIndex: '20' } });
    const inspectorPanel = h('div', { class: 'dock-panel', role: 'region', 'aria-label': 'Inspector', style: { position: 'absolute', right: '8px', top: 'calc(50px + 220px)', width: '250px', maxHeight: '40%', zIndex: '20' } });
    const outlineBody = h('div', { class: 'dock-panel-body' });
    const inspectorBody = h('div', { class: 'dock-panel-body' });
    outlinePanel.append(h('div', { class: 'dock-panel-head' }, h('span', { class: 'panel-title' }, 'Outline')), outlineBody);
    inspectorPanel.append(h('div', { class: 'dock-panel-head' }, h('span', { class: 'panel-title' }, 'Inspector')), inspectorBody);
    stageHost.append(outlinePanel, inspectorPanel);
    let selected: string | null = null;

    const renderPanels = (): void => {
      outlineBody.replaceChildren();
      const tree = h('div', { role: 'tree', 'aria-label': 'Scene outline' });
      for (const object of doc.objects) {
        tree.append(h('div', {
          class: `row${object.id === selected ? ' selected' : ''}`,
          role: 'treeitem', 'aria-selected': String(object.id === selected), tabindex: '-1',
          onclick: () => { selected = object.id; renderPanels(); },
        }, object.name));
      }
      outlineBody.append(tree);
      inspectorBody.replaceChildren();
      const object = selected ? doc.objects.find((o) => o.id === selected) : null;
      const rows: Array<[string, string]> = [];
      if (!object) {
        rows.push(['Scene name', doc.name], ['Gravity (m/s²)', String(doc.gravity)]);
      } else {
        for (const [i, label] of ['Position X (m)', 'Position Y (m)', 'Position Z (m)'].entries()) {
          rows.push([label, String(object.position[i])]);
        }
        for (const spec of KIND_SPECS[object.kind].params) {
          rows.push([spec.label, String(object.params[spec.key] ?? '')]);
        }
      }
      for (const [label, value] of rows) {
        inspectorBody.append(h('div', { class: 'row', style: { justifyContent: 'space-between' } },
          h('span', { class: 'muted' }, label), h('span', {}, value)));
      }
      if (object) {
        const readouts = h('div', { role: 'region', 'aria-label': 'Derived readouts' });
        for (const row of readoutsForObject(object, doc.gravity)) {
          readouts.append(h('div', { class: 'readout-rows' }, formatReadout(row)));
        }
        inspectorBody.append(readouts);
      }
      const viewOnly = h('span', { role: 'status', 'aria-label': 'View only', class: 'chip', style: { pointerEvents: 'none', position: 'absolute', top: '6px', left: '50%', transform: 'translateX(-50%)', zIndex: '25' } }, 'View only');
      if (!stageHost.contains(viewOnly)) stageHost.append(viewOnly);
    };
    renderPanels();
    if (renderer) renderer.draw(doc, true, null);

    const applyPanels = (): void => {
      const width = window.innerWidth;
      if (width >= 600) {
        outlinePanel.style.position = 'absolute';
        inspectorPanel.style.position = 'absolute';
        stageHost.append(outlinePanel, inspectorPanel);
      } else {
        outlinePanel.style.position = 'relative';
        inspectorPanel.style.position = 'relative';
        const sheet = stageHost.querySelector('[data-view-sheet]') as HTMLElement | null;
        if (sheet) {
          sheet.replaceChildren(outlinePanel, inspectorPanel);
        }
      }
    };
    applyPanels();
    window.addEventListener('resize', applyPanels);

    async function hashAt(step: number, bodyList: Body[]): Promise<string> {
      const state = stepStateFor(doc, bodyList, step);
      return sha256Hex(stateHashInput(state));
    }

    async function run(): Promise<void> {
      if (!renderer) return;
      if (mode === 'run') { await stop(); return; }
      mode = 'run';
      paused = false;
      stepCount = 0;
      bodies = doc.objects.map((o) => makeBody(o));
      runBtn.textContent = 'Stop';
      runBtn.classList.add('go');
      pauseBtn.disabled = false;
      stepBtn.disabled = false;
      modePill.style.display = 'block';
      outlinePanel.style.visibility = 'hidden';
      inspectorPanel.style.visibility = 'hidden';
      const tick = (): void => {
        if (mode !== 'run') return;
        const start = performance.now();
        if (!paused) {
          runSteps(bodies, 2);
          stepCount += 2;
        }
        frameTimes.push(performance.now() - start);
        if (frameTimes.length > 60) frameTimes.shift();
        if (renderer) {
          const doc2: SceneDocument = { ...doc, objects: doc.objects.map((o, i) => ({ ...o, position: bodies[i]?.position ?? o.position })) };
          renderer.draw(doc2, false, null);
        }
        const avg = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
        const fps = avg > 0 ? Math.min(999, Math.round(1000 / Math.max(0.1, avg))) : 0;
        fpsLine.textContent = `fps ${fps}`;
        fpsLine.className = fps >= 50 ? 'fps-go' : fps >= 30 ? 'fps-warn' : 'fps-bad';
        fpsLine.style.fontWeight = '700';
        msLine.textContent = `ms ${avg.toFixed(1)}`;
        stepLine.textContent = `step ${stepCount}`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    async function stop(): Promise<void> {
      if (raf !== null) cancelAnimationFrame(raf);
      mode = 'edit';
      paused = false;
      stepCount = 0;
      bodies = [];
      runBtn.textContent = 'Run';
      runBtn.classList.remove('go');
      pauseBtn.disabled = true;
      stepBtn.disabled = true;
      modePill.style.display = 'none';
      outlinePanel.style.visibility = 'visible';
      inspectorPanel.style.visibility = 'visible';
      if (renderer) renderer.draw(doc, true, null);
      stepLine.textContent = 'step 0';
      hashLine.textContent = `hash ${runHash.slice(0, 12)}`;
    }

    function togglePause(): void {
      if (mode !== 'run') return;
      paused = !paused;
      modePill.textContent = paused ? 'PAUSED' : 'RUNNING';
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      if (paused) {
        void hashAt(stepCount, bodies).then((hash) => { runHash = hash; hashLine.textContent = `hash ${runHash.slice(0, 12)}`; });
      }
    }

    function stepOnce(): void {
      if (mode !== 'run') return;
      if (!paused) togglePause();
      runSteps(bodies, 1);
      stepCount += 1;
      stepLine.textContent = `step ${stepCount}`;
      void hashAt(stepCount, bodies).then((hash) => { runHash = hash; hashLine.textContent = `hash ${runHash.slice(0, 12)}`; });
    }

    // live revision updates and dead-link switch
    const sse = new EventSource(`/api/view/${token}/scenes/${sid}/live`);
    sse.addEventListener('revision', async (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as { revision: number; stateHash: string };
      const fresh = await api('GET', `/api/view/${token}/scenes/${sid}`);
      if (!fresh.ok) { sse.close(); shell.replaceChildren(); deadLink(shell); return; }
      doc = (fresh.body as ViewScene).document;
      renderPanels();
      if (renderer && mode !== 'run') renderer.draw(doc, true, null);
      runHash = payload.stateHash;
      hashLine.textContent = `hash ${runHash.slice(0, 12)}`;
    });
    sse.addEventListener('link_dead', () => {
      sse.close();
      shell.replaceChildren();
      deadLink(shell);
    });
    window.addEventListener('beforeunload', () => sse.close());
  })();
}

function deadLink(host: HTMLElement): void {
  const heading = h('h1', {}, DEAD_LINK_HEADING);
  host.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto', padding: '14px' } }, heading));
}

function watchLink(token: string, shell: HTMLElement): void {
  const sse = new EventSource(`/api/view/${token}/scenes/none/live`);
  sse.addEventListener('link_dead', () => {
    sse.close();
    shell.replaceChildren();
    deadLink(shell);
  });
  window.addEventListener('beforeunload', () => sse.close());
}
