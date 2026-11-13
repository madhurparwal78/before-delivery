import { api } from './api';
import { h, chip } from './ui';
import { COPY } from '../bench/copy';
import { KIND_SPECS, type SceneDocument } from '../bench/scene';
import { makeBody, runSteps, stepZeroState, stateHashInput, type Body } from '../bench/sim';
import { sha256Hex } from '../bench/hash';
import { readoutsForObject, formatReadout } from '../bench/readouts';
import { stepStateFor } from './editor-util';
import { StageRenderer } from './render';

type LabData = {
  lab: {
    sceneName: string;
    bundleHash: string;
    publishedAt: string;
    exposed: Array<{ key: string; label: string; min: number; max: number; step: number; unit: string; value: number }>;
  };
  document: SceneDocument;
};

export function labScreen(root: HTMLElement, token: string): void {
  document.title = 'Lab - Rampwright';
  const shell = h('div', { class: 'app-root', style: { height: '100vh', overflow: 'hidden' } });
  const stageHost = h('div', { class: 'stage-root' });
  shell.append(stageHost);
  root.append(shell);
  void (async () => {
    const result = await api('GET', `/api/labs/${token}`);
    if (!result.ok) {
      if (result.error.status === 503) {
        shell.replaceChildren(h('div', { style: { padding: '20px' } },
          h('h1', {}, COPY.pages.labStorage[0]),
          h('p', {}, COPY.pages.labStorage[1])));
        return;
      }
      shell.replaceChildren(h('div', { style: { padding: '20px' } },
        h('h1', {}, COPY.pages.missingLab[0]),
        h('p', {}, COPY.pages.missingLab[1])));
      return;
    }
    const data = result.body as LabData;
    document.title = `${data.lab.sceneName} - Rampwright`;
    let renderer: StageRenderer | null = null;
    try {
      const canvas = h('canvas', { class: 'stage-canvas', role: 'application', 'aria-label': 'Stage', tabindex: '0' }) as HTMLCanvasElement;
      stageHost.append(canvas);
      renderer = new StageRenderer(canvas);
    } catch {
      stageHost.append(h('div', { style: { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 15%', textAlign: 'center' } }, COPY.pages.noWebgl));
    }
    let doc = structuredClone(data.document);
    const values = new Map<string, number>(data.lab.exposed.map((e) => [e.key, e.value]));

    const heading = h('h1', { style: { position: 'absolute', top: '38px', left: '8px', margin: '0', fontSize: '16px', zIndex: '20', background: 'rgba(22,26,38,0.8)', padding: '4px 8px', borderRadius: '6px' } }, data.lab.sceneName);
    stageHost.append(heading);

    const telemetry = h('div', { class: 'telemetry-card', role: 'group', 'aria-label': 'Run telemetry', style: { top: '38px' } });
    const fpsLine = h('div', { class: 'fps-go', style: { fontWeight: '700' } }, 'fps 0');
    const msLine = h('div', {}, 'ms 0.0');
    const stepLine = h('div', {}, 'step 0');
    const hashLine = h('div', {}, 'hash 0');
    telemetry.append(fpsLine, msLine, stepLine, hashLine);
    stageHost.append(telemetry);

    const bar = h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools', style: { position: 'absolute', top: '0', left: '0', right: '0', zIndex: '30' } });
    let mode: 'edit' | 'run' = 'edit';
    let paused = false;
    let bodies: Body[] = [];
    let stepCount = 0;
    let runHash = '';
    let raf: number | null = null;
    const frameTimes: number[] = [];
    const runBtn = chip('Run', { onClick: () => void run() });
    const pauseBtn = chip('Pause', { disabled: true, onClick: () => togglePause() });
    const stepBtn = chip('Step', { disabled: true, onClick: () => stepOnce() });
    bar.append(runBtn, pauseBtn, stepBtn, h('span', { class: 'tb-spacer' }), h('span', { class: 'wordmark' }, 'Rampwright'));
    shell.append(bar);
    const modePill = h('div', { class: 'mode-pill', role: 'status', 'aria-label': 'Mode', style: { display: 'none' } }, 'RUNNING');
    stageHost.append(modePill);
    const centreMark = h('div', { class: 'centre-mark', role: 'img', 'aria-label': 'Centre mark', style: { display: 'none' } });
    stageHost.append(centreMark);

    const paramsPanel = h('div', { class: 'dock-panel', role: 'region', 'aria-label': 'Lab parameters', style: { position: 'absolute', right: '8px', top: '90px', width: '270px', maxHeight: '60%', zIndex: '20' } });
    const paramsBody = h('div', { class: 'dock-panel-body' });
    paramsPanel.append(h('div', { class: 'dock-panel-head' }, h('span', { class: 'panel-title' }, 'Lab parameters')), paramsBody);
    const readoutsPanel = h('div', { class: 'dock-panel', role: 'region', 'aria-label': 'Derived readouts', style: { position: 'absolute', right: '8px', top: 'calc(90px + 220px)', width: '270px', zIndex: '20' } });
    const readoutsBody = h('div', { class: 'dock-panel-body' });
    readoutsPanel.append(h('div', { class: 'dock-panel-head' }, h('span', { class: 'panel-title' }, 'Derived readouts')), readoutsBody);

    const sliders: Array<HTMLInputElement> = [];
    const valuesHost = new Map<string, HTMLElement>();
    for (const exposed of data.lab.exposed) {
      const line = h('div', { style: { margin: '6px 0' } });
      const label = h('label', { style: { display: 'block', fontSize: '11.5px' } }, exposed.label);
      const slider = h('input', { type: 'range', 'aria-label': exposed.label, min: String(exposed.min), max: String(exposed.max), step: String(exposed.step), value: String(exposed.value), style: { width: '100%' } }) as HTMLInputElement;
      sliders.push(slider);
      const valueLabel = h('span', { class: 'muted', style: { fontSize: '11px' } }, `${exposed.value} ${exposed.unit}`);
      valuesHost.set(exposed.key, valueLabel);
      slider.addEventListener('input', () => {
        const num = Number(slider.value);
        values.set(exposed.key, num);
        valueLabel.textContent = `${num} ${exposed.unit}`;
        applyParam(exposed.key, num);
        draw();
      });
      line.append(label, slider, valueLabel);
      paramsBody.append(line);
    }

    const dockedHost = h('div', {});
    shell.append(dockedHost);
    const applyPanels = (): void => {
      const width = window.innerWidth;
      if (width >= 1000) {
        paramsPanel.style.display = 'block';
        readoutsPanel.style.display = 'block';
        paramsPanel.style.visibility = 'visible';
        readoutsPanel.style.visibility = 'visible';
        paramsPanel.style.position = 'absolute';
        paramsPanel.style.width = '270px';
        paramsPanel.style.maxHeight = '60%';
        paramsPanel.style.top = '90px';
        stageHost.append(paramsPanel, readoutsPanel);
        dockedHost.style.display = 'none';
        const sheetHost = (dockedHost as HTMLElement & { sheetHost?: HTMLElement }).sheetHost;
        if (sheetHost) sheetHost.style.display = 'none';
      } else if (width >= 600) {
        paramsPanel.style.display = 'block';
        readoutsPanel.style.display = 'block';
        paramsPanel.style.visibility = 'visible';
        readoutsPanel.style.visibility = 'visible';
        paramsPanel.style.position = 'relative';
        paramsPanel.style.top = '';
        paramsPanel.style.width = '';
        paramsPanel.style.maxHeight = '';
        dockedHost.style.display = 'flex';
        dockedHost.replaceChildren(paramsPanel, readoutsPanel);
      } else {
        dockedHost.style.display = 'none';
        let sheetHost = (dockedHost as HTMLElement & { sheetHost?: HTMLElement }).sheetHost;
        if (!sheetHost) {
          sheetHost = h('div', { style: 'position:absolute;left:0;right:0;bottom:0;max-height:60%;z-index:22;display:flex;flex-direction:column' });
          const tabs = h('div', { class: 'phone-tabs', role: 'tablist', 'aria-label': 'Lab panels' });
          const sheetBody = h('div', { class: 'phone-sheet' });
          const paramsTab = h('button', { role: 'tab', 'aria-selected': 'true' }, 'Parameters');
          const readoutsTab = h('button', { role: 'tab', 'aria-selected': 'false' }, 'Readouts');
          paramsTab.addEventListener('click', () => { paramsTab.setAttribute('aria-selected', 'true'); readoutsTab.setAttribute('aria-selected', 'false'); sheetBody.replaceChildren(paramsPanel); });
          readoutsTab.addEventListener('click', () => { readoutsTab.setAttribute('aria-selected', 'true'); paramsTab.setAttribute('aria-selected', 'false'); sheetBody.replaceChildren(readoutsPanel); });
          tabs.append(paramsTab, readoutsTab);
          sheetBody.append(paramsPanel);
          sheetHost.append(tabs, sheetBody);
          (dockedHost as HTMLElement & { sheetHost?: HTMLElement }).sheetHost = sheetHost;
          shell.append(sheetHost);
          (sheetHost as HTMLElement & { body?: HTMLElement }).body = sheetBody;
        }
        sheetHost.style.display = 'flex';
        paramsPanel.style.display = 'block';
        readoutsPanel.style.display = 'block';
        paramsPanel.style.position = 'relative';
        paramsPanel.style.top = '';
        paramsPanel.style.width = '';
        paramsPanel.style.maxHeight = '';
        const sheetBody = (sheetHost as HTMLElement & { body?: HTMLElement }).body!;
        if (!sheetBody.contains(paramsPanel) && !sheetBody.contains(readoutsPanel)) {
          sheetBody.replaceChildren(paramsPanel);
        }
      }
    };
    applyPanels();
    window.addEventListener('resize', applyPanels);

    function applyParam(key: string, value: number): void {
      const [objectId, param] = key.split('.');
      const object = doc.objects.find((o) => o.id === objectId);
      if (!object) return;
      object.params = { ...object.params, [param ?? '']: value };
      renderReadouts();
    }

    function renderReadouts(): void {
      readoutsBody.replaceChildren();
      for (const object of doc.objects) {
        const rows = readoutsForObject(object, doc.gravity);
        for (const row of rows) {
          readoutsBody.append(h('div', { class: 'readout-rows' }, formatReadout(row)));
        }
      }
    }

    function draw(): void {
      if (!renderer) return;
      renderer.draw(doc, false, null);
      renderReadouts();
    }
    draw();

    async function hashAt(step: number, bodyList: Body[]): Promise<string> {
      const state = stepStateFor(doc, bodyList, step);
      return sha256Hex(stateHashInput(state));
    }

    async function run(): Promise<void> {
      if (!renderer || mode === 'run') {
        if (mode === 'run') await stop();
        return;
      }
      mode = 'run';
      paused = false;
      stepCount = 0;
      bodies = doc.objects.map((o) => makeBody(o, Object.fromEntries([...values.entries()])));
      runBtn.textContent = 'Stop';
      runBtn.classList.add('go');
      pauseBtn.disabled = false;
      stepBtn.disabled = false;
      for (const slider of sliders) slider.disabled = true;
      modePill.style.display = 'block';
      centreMark.style.display = 'block';
      paramsPanel.style.visibility = 'hidden';
      readoutsPanel.style.visibility = 'hidden';
      const tick = (): void => {
        if (mode !== 'run') return;
        const start = performance.now();
        if (!paused) {
          runSteps(bodies, 2);
          stepCount += 2;
        }
        frameTimes.push(performance.now() - start);
        if (frameTimes.length > 60) frameTimes.shift();
        drawRun();
        updateTelemetry();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    function drawRun(): void {
      if (!renderer) return;
      const doc2: SceneDocument = { ...doc, objects: doc.objects.map((o, i) => ({ ...o, position: bodies[i]?.position ?? o.position })) };
      renderer.draw(doc2, false, null);
    }

    async function stop(): Promise<void> {
      if (raf !== null) cancelAnimationFrame(raf);
      mode = 'edit';
      paused = false;
      stepCount = 0;
      // restart from the current slider values
      doc = restartDoc();
      bodies = [];
      runBtn.textContent = 'Run';
      runBtn.classList.remove('go');
      pauseBtn.disabled = true;
      stepBtn.disabled = true;
      for (const slider of sliders) slider.disabled = false;
      modePill.style.display = 'none';
      centreMark.style.display = 'none';
      paramsPanel.style.visibility = 'visible';
      readoutsPanel.style.visibility = 'visible';
      runHash = await hashStep0();
      draw();
      updateTelemetry();
    }

    function restartDoc(): SceneDocument {
      const next = structuredClone(data.document);
      for (const [key, value] of values.entries()) {
        const [objectId, param] = key.split('.');
        const object = next.objects.find((o) => o.id === objectId);
        if (object && param) object.params = { ...object.params, [param]: value };
      }
      return next;
    }

    async function hashStep0(): Promise<string> {
      return sha256Hex(stateHashInput(stepZeroState(doc)));
    }

    function togglePause(): void {
      if (mode !== 'run') return;
      paused = !paused;
      modePill.textContent = paused ? 'PAUSED' : 'RUNNING';
      pauseBtn.textContent = paused ? 'Resume' : 'Pause';
      if (paused) {
        void hashAt(stepCount, bodies).then((hash) => { runHash = hash; updateTelemetry(); });
      }
    }

    function stepOnce(): void {
      if (mode !== 'run') return;
      if (!paused) togglePause();
      runSteps(bodies, 1);
      stepCount += 1;
      void hashAt(stepCount, bodies).then((hash) => { runHash = hash; updateTelemetry(); });
      drawRun();
    }

    function updateTelemetry(): void {
      const avg = frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0;
      const fps = avg > 0 ? Math.min(999, Math.round(1000 / Math.max(0.1, avg))) : 0;
      fpsLine.textContent = `fps ${mode === 'run' ? fps : 0}`;
      fpsLine.className = fps >= 50 ? 'fps-go' : fps >= 30 ? 'fps-warn' : 'fps-bad';
      fpsLine.style.fontWeight = '700';
      msLine.textContent = `ms ${avg.toFixed(1)}`;
      stepLine.textContent = `step ${stepCount}`;
      hashLine.textContent = `hash ${runHash.slice(0, 12)}`;
    }
    void hashStep0().then((hash) => { runHash = hash; updateTelemetry(); });
  })();
}
