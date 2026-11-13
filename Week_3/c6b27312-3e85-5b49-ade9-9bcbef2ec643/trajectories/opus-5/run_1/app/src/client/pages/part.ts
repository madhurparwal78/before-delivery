import {
  ApiCallError,
  AppConfig,
  EvaluationResponse,
  ManifestEntry,
  Me,
  NoAnswerError,
  PartResponse,
  RevisionResponse,
  Solid,
  TapeResponse,
  appConfig,
  KeyedAction,
  me,
  send,
} from '../api';
import { all, clear, el, find, narrow, on, reducedMotion } from '../dom';
import { FindingOption, FindingsList } from '../findings';
import { BuildTape } from '../tape';
import { Viewport } from '../viewport';
import {
  Dialog,
  checkStorageHealth,
  labelledField,
  markStorageDependent,
  openLiveStream,
  pageAlert,
  removeAlerts,
  showStorageBanner,
  storageIsDown,
  fieldError,
} from '../ui';
import { ParameterControls } from '../params';
import {
  ParameterValue,
  Unit,
  Values,
  configString,
  defaultsOf,
  modifiedCount,
  parameterChangeLine,
  parseConfig,
  readUnit,
  sparseValues,
  valueOf,
  writeUnit,
} from '../values';
import { PreflightPanel, sameValues } from './part-preflight';
import { bboxText, volumeMm3 } from '../../shared/numbers';
import { boxOfBbox } from '../../shared/pose';
import { bodyHeight, opMesh, stepDifference } from '../mesh';

const DRAFT_PREFIX = 'tinework:draft:';

type Draft = { values: Values; message: string };

function draftKey(slug: string, headId: string): string {
  return `${DRAFT_PREFIX}${slug}:${headId}`;
}

function readDraft(slug: string): { key: string; base: string; draft: Draft } | null {
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(`${DRAFT_PREFIX}${slug}:`)) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key) ?? '') as Draft;
      return { key, base: key.slice(`${DRAFT_PREFIX}${slug}:`.length), draft };
    } catch {
      localStorage.removeItem(key);
    }
  }
  return null;
}

function clearDrafts(slug: string): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`${DRAFT_PREFIX}${slug}:`)) localStorage.removeItem(key);
  }
}

function writeDraft(slug: string, headId: string, draft: Draft): void {
  clearDrafts(slug);
  localStorage.setItem(draftKey(slug, headId), JSON.stringify(draft));
}

const GROUPS = ['Dimensions', 'Pre-flight', 'Revisions', 'Review'] as const;

type Group = { button: HTMLButtonElement; region: HTMLElement };

export async function mountPart(host: HTMLElement): Promise<void> {
  const slug = host.dataset.slug ?? '';
  const url = new URL(window.location.href);
  const settings: AppConfig = await appConfig();
  const viewer: Me = await me();
  const requested = url.searchParams.get('revision');

  const answer = await send<PartResponse>(
    `/api/parts/${encodeURIComponent(slug)}${requested ? `?revision=${encodeURIComponent(requested)}` : ''}`,
  );
  const part = answer.data;
  const manifest = part.manifest;
  const owner = viewer !== null && viewer.id === part.owner.id;
  let knownHead = part.headRevisionId;
  let loadedRevision = part.revision;
  let revisions: RevisionResponse[] = [];
  const viewerId = crypto.randomUUID();

  const defaults = defaultsOf(manifest);
  let unit: Unit = readUnit();
  const values: Values = { ...defaults };
  let droppedNames: string[] = [];

  const configParameter = url.searchParams.get('config');
  if (configParameter !== null) {
    const parsed = parseConfig(configParameter, manifest);
    Object.assign(values, parsed.values);
    droppedNames = parsed.dropped;
  } else {
    Object.assign(values, loadedRevision.values);
  }

  // Page chrome ------------------------------------------------------------
  const leader = find('[data-ui="dimension-leader"]');
  const heading = el('h1', {}, [part.title]);
  if (leader) heading.append(leader);
  const likeCount = el('span', { 'data-ui': 'like-count' });
  const likeButton = el(
    'button',
    { type: 'button', 'aria-pressed': part.liked ? 'true' : 'false', 'aria-label': `Like ${part.title}` },
    [`Like ${part.title}`, likeCount],
  );
  const saveButton = el('button', { type: 'button', class: 'button-primary' }, ['Save revision']);
  const zipButton = el('button', { type: 'button' }, ['Download ZIP']);
  const tarButton = el('button', { type: 'button' }, ['Download TAR']);
  markStorageDependent(zipButton);
  markStorageDependent(tarButton);

  const evaluationStatus = el('p', { role: 'status', 'aria-label': 'Evaluation', class: 'status-line' });
  const preflightStatus = el('p', { role: 'status', 'aria-label': 'Pre-flight', class: 'status-line' });
  const activityStatus = el('p', { role: 'status', 'aria-label': 'Part activity', class: 'status-line' });

  const viewport = new Viewport({
    epochKey: `tinework:epoch:part:${slug}`,
    fallbackSrc: `/api/solids/${loadedRevision.geometryDigest}/thumbnail.svg`,
    fallbackAlt: `${part.title}, ${loadedRevision.label}`,
  });
  viewport.setViewerId(viewerId);

  const volumeReadout = el('span', { 'data-ui': 'readout-volume' });
  const bboxReadout = el('span', { 'data-ui': 'readout-bbox' });
  const facesReadout = el('span', { 'data-ui': 'readout-faces' });
  const digestReadout = el('span', { 'data-ui': 'readout-digest' });
  const readouts = el('div', { class: 'readouts' }, [
    volumeReadout,
    bboxReadout,
    facesReadout,
    digestReadout,
  ]);
  const slowNotice = el('p', { 'data-ui': 'slow-notice', class: 'slow-notice', hidden: true }, [
    'Still evaluating. Large parts can take a few seconds.',
  ]);

  const labelOf = (name: string): string =>
    manifest.find((entry) => entry.name === name)?.label ?? name;

  const findings = new FindingsList(
    (option) => {
      if (option.pose) viewport.glideTo(option.pose);
    },
    (parameter) => {
      openGroup('Dimensions');
      controls.focusParameter(parameter);
    },
    labelOf,
  );

  const sourcePane = el('section', { class: 'source-pane', 'aria-label': 'Tine source' });
  const sourceLines = el('ol', { class: 'source-lines' });
  sourcePane.append(el('h2', { class: 'section-title' }, ['Source']), sourceLines);
  const paintSource = (source: string): void => {
    clear(sourceLines);
    source.split('\n').forEach((text, index) => {
      sourceLines.append(el('li', { 'data-line': index + 1, class: 'source-line' }, [text]));
    });
  };
  paintSource(part.source);

  const highlightLine = (line: number | null): void => {
    for (const node of all('.source-line', sourceLines)) {
      if (line !== null && node.getAttribute('data-line') === String(line)) {
        node.setAttribute('aria-current', 'true');
        node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
      } else {
        node.removeAttribute('aria-current');
      }
    }
  };

  const tape = new BuildTape({
    owner,
    onMove: (index) => void showTapeOperation(index),
    onFork: (index) => openForkDialog(index),
  });

  const main = el('div', { class: 'part-main' }, [
    readouts,
    slowNotice,
    findings.region,
    tape.root,
    evaluationStatus,
    preflightStatus,
    activityStatus,
  ]);

  const railGroups = new Map<string, Group>();
  const rail = el('aside', { class: 'part-rail' });

  const dimensionsHeader = el('div', { class: 'rail-header' });
  const modifiedText = el('span', { 'data-ui': 'modified-count' });
  const resetAll = el('button', { type: 'button', class: 'chip' }, ['Reset all']);
  const unitsGroup = el('div', { role: 'radiogroup', 'aria-label': 'Units', class: 'radio-row' });
  const mmRadio = el(
    'button',
    { type: 'button', role: 'radio', 'aria-label': 'Millimetres', class: 'radio-option' },
    ['mm'],
  );
  const inRadio = el(
    'button',
    { type: 'button', role: 'radio', 'aria-label': 'Inches', class: 'radio-option' },
    ['in'],
  );
  unitsGroup.append(mmRadio, inRadio);
  dimensionsHeader.append(modifiedText, resetAll, unitsGroup);

  const controls = new ParameterControls(manifest, values, unit, (name, value) =>
    commit(name, value),
  );

  const dimensionsBody = el('div', { class: 'rail-body' }, [
    dimensionsHeader,
    ...controls.build(manifest),
  ]);

  const preflight = new PreflightPanel({
    slug,
    revisionId: loadedRevision.id,
    signedIn: viewer !== null,
    limit: settings.preflightSignedOutLimit,
    left: part.preflightLeft,
    valuesNow: () => sparseValues(manifest, values),
    announce: (message) => {
      preflightStatus.textContent = message;
    },
    onReport: () => {
      paintFindings();
      paintPins();
    },
  });

  const revisionsList = el('ul', { class: 'revisions-list' });
  const revisionsBody = el('div', { class: 'rail-body' }, [
    el('div', { role: 'list', 'aria-label': 'Revisions', class: 'revisions-host' }, [revisionsList]),
    el('a', { href: `/tapes/${loadedRevision.id}`, class: 'chip' }, ['Open build tape']),
  ]);

  const reviewBody = el('div', { class: 'rail-body' });

  for (const name of GROUPS) {
    const region = el('div', { role: 'region', 'aria-label': name, class: 'rail-region' }, [
      name === 'Dimensions'
        ? dimensionsBody
        : name === 'Pre-flight'
          ? preflight.root
          : name === 'Revisions'
            ? revisionsBody
            : reviewBody,
    ]);
    const button = el(
      'button',
      { type: 'button', 'aria-expanded': 'true', class: 'rail-group-button' },
      [name],
    );
    on(button, 'click', () => toggleGroup(name));
    rail.append(el('section', { class: 'rail-group' }, [button, region]));
    railGroups.set(name, { button, region });
  }

  host.append(
    el('div', { class: 'part-head' }, [
      heading,
      el('p', { class: 'muted part-author' }, [`by ${part.owner.displayName}`]),
      el('div', { class: 'part-actions' }, [likeButton, saveButton, zipButton, tarButton]),
    ]),
    el('div', { class: 'part-layout' }, [main, rail, sourcePane]),
  );
  viewport.mount(main, 'prepend');

  function setGroupOpen(name: string, open: boolean): void {
    const group = railGroups.get(name);
    if (!group) return;
    group.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    group.region.hidden = !open;
  }

  function openGroup(name: string): void {
    if (narrow()) {
      for (const other of GROUPS) setGroupOpen(other, other === name);
    } else {
      setGroupOpen(name, true);
    }
  }

  function toggleGroup(name: string): void {
    const group = railGroups.get(name)!;
    const open = group.button.getAttribute('aria-expanded') === 'true';
    if (open) setGroupOpen(name, false);
    else openGroup(name);
  }

  const applyNarrowLayout = (): void => {
    if (!narrow()) {
      for (const name of GROUPS) setGroupOpen(name, true);
      return;
    }
    const alreadyOpen = GROUPS.find(
      (name) => railGroups.get(name)!.button.getAttribute('aria-expanded') === 'true',
    );
    openGroup(alreadyOpen ?? 'Dimensions');
  };
  applyNarrowLayout();
  on(window, 'resize', () => applyNarrowLayout());

  // Units ------------------------------------------------------------------
  function paintUnits(): void {
    mmRadio.setAttribute('aria-checked', unit === 'mm' ? 'true' : 'false');
    inRadio.setAttribute('aria-checked', unit === 'in' ? 'true' : 'false');
    mmRadio.setAttribute('tabindex', unit === 'mm' ? '0' : '-1');
    inRadio.setAttribute('tabindex', unit === 'in' ? '0' : '-1');
  }

  function setUnit(next: Unit): void {
    unit = next;
    writeUnit(next);
    paintUnits();
    controls.setUnit(next);
  }

  on(mmRadio, 'click', () => setUnit('mm'));
  on(inRadio, 'click', () => setUnit('in'));
  for (const radio of [mmRadio, inRadio]) {
    on(radio, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(keyboard.key)) {
        keyboard.preventDefault();
        setUnit(unit === 'mm' ? 'in' : 'mm');
        (unit === 'mm' ? mmRadio : inRadio).focus();
      }
    });
  }
  paintUnits();

  function setValues(next: Values): void {
    for (const name of Object.keys(values)) delete values[name];
    Object.assign(values, next);
  }

  on(resetAll, 'click', () => {
    setValues(defaults);
    controls.refresh();
    paintModified();
    preflight.refreshStaleness();
    paintFindings();
    updateTapeDisabled();
    if (tapeDriving) returnToLive();
    scheduleEvaluation();
  });

  function paintModified(): void {
    modifiedText.textContent = `${modifiedCount(manifest, values)} modified`;
  }

  /** Each press or typed value commits one clamped value and restarts the debounce. */
  function commit(name: string, value: ParameterValue): void {
    values[name] = value;
    controls.refresh();
    paintModified();
    preflight.refreshStaleness();
    paintFindings();
    updateTapeDisabled();
    if (tapeDriving) returnToLive();
    scheduleEvaluation();
  }

  // Evaluation -------------------------------------------------------------
  type Good = {
    solid: Solid | null;
    digest: string;
    volume: number;
    bbox: [number, number, number];
    faces: number;
  };

  let seq = 0;
  let appliedSeq = 0;
  let evalState = 'settled';
  let debounceTimer = 0;
  let slowTimer = 0;
  let settleTimer = 0;
  let inflight: AbortController | null = null;
  let lastGood: Good | null = null;
  let lastGoodAt: Date | null = null;
  let diagnostic: { message: string; parameter: string | null } | null = null;
  let tapeDriving = false;
  let firstPaintDone = false;

  function setEvalState(next: string): void {
    evalState = next;
    viewport.setEvalState(next);
  }

  /** `revision=<id>` comes before `config` when present; both stay literal. */
  function writeAddress(): void {
    const parts2: string[] = [];
    if (requested) parts2.push(`revision=${requested}`);
    parts2.push(`config=${configString(manifest, values)}`);
    history.replaceState(history.state, '', `${window.location.pathname}?${parts2.join('&')}`);
  }

  function paintReadouts(good: Good, tapeOperation: number | null): void {
    volumeReadout.textContent = `Volume ${volumeMm3(good.volume)}`;
    bboxReadout.textContent = `Bounding box ${bboxText(good.bbox)}`;
    facesReadout.textContent = `Faces ${good.faces}`;
    digestReadout.textContent = `Digest ${good.digest}`;
    viewport.setReadouts({
      digest: good.digest,
      volume: good.volume,
      bbox: good.bbox,
      faces: good.faces,
      seq: appliedSeq,
      tapeOperation,
    });
  }

  function scheduleEvaluation(): void {
    if (evalState === 'evaluating') {
      setEvalState('stale');
      abortInflight();
    } else if (evalState !== 'stale') {
      setEvalState('dirty');
    }
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void runEvaluation(), settings.evalDebounceMs);
  }

  /** A commit made while an evaluation is in flight aborts its request and cancels it. */
  function abortInflight(): void {
    if (!inflight) return;
    inflight.abort();
    inflight = null;
    window.clearTimeout(slowTimer);
    slowNotice.hidden = true;
    evaluationStatus.textContent = 'Superseded by a newer change.';
    void send('/api/evaluations/cancel', { method: 'POST', body: { viewerId } }).catch(() => undefined);
  }

  async function runEvaluation(): Promise<void> {
    seq += 1;
    const mySeq = seq;
    setEvalState('evaluating');
    writeAddress();
    const controller = new AbortController();
    inflight = controller;
    window.clearTimeout(slowTimer);
    slowTimer = window.setTimeout(() => {
      slowNotice.hidden = false;
    }, settings.slowEvalNoticeMs);
    try {
      const result = await send<EvaluationResponse>('/api/evaluations', {
        method: 'POST',
        body: {
          partSlug: slug,
          revisionId: loadedRevision.id,
          values: sparseValues(manifest, values),
          seq: mySeq,
          viewerId,
        },
        signal: controller.signal,
      });
      if (inflight === controller) inflight = null;
      window.clearTimeout(slowTimer);
      slowNotice.hidden = true;
      applyEvaluation(result.data, mySeq);
    } catch (error) {
      window.clearTimeout(slowTimer);
      slowNotice.hidden = true;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (error instanceof ApiCallError) {
        setEvalState('failed');
        evaluationStatus.textContent = `Could not evaluate: ${error.failure.message}`;
      }
    }
  }

  function applyEvaluation(result: EvaluationResponse, mySeq: number): void {
    if (result.status === 'cancelled') return;
    if (mySeq < appliedSeq) return;
    appliedSeq = mySeq;
    if (result.status === 'failed') {
      diagnostic = result.diagnostics[0] ?? null;
      setEvalState('failed');
      evaluationStatus.textContent = `Could not evaluate: ${diagnostic?.message ?? ''}`;
      paintFindings();
      return;
    }
    diagnostic = null;
    const good: Good = {
      solid: result.solid,
      digest: result.geometryDigest ?? '',
      volume: result.volume,
      bbox: result.bbox,
      faces: result.faces,
    };
    lastGood = good;
    lastGoodAt = new Date();
    tapeDriving = false;
    viewport.setSolid(result.solid, { crossfade: firstPaintDone });
    viewport.setDefaultPose(boxPose(result.bbox), !firstPaintDone);
    paintReadouts(good, null);
    viewport.paint();
    firstPaintDone = true;
    setEvalState('settling');
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(
      () => {
        if (evalState === 'settling') setEvalState('settled');
      },
      reducedMotion() ? 0 : 150,
    );
    evaluationStatus.textContent = `Updated: ${volumeMm3(result.volume)}`;
    paintFindings();
    paintPins();
    highlightLine(null);
  }

  function boxPose(bbox: [number, number, number]): ReturnType<typeof viewport.poseForBox> {
    return viewport.poseForBox(boxOfBbox(bbox));
  }

  // Findings ---------------------------------------------------------------
  function paintFindings(): void {
    const options: FindingOption[] = [];
    if (diagnostic) {
      options.push({
        id: 'finding-diagnostic',
        severity: 'Blocking',
        text: diagnostic.message,
        parameters: diagnostic.parameter ? [diagnostic.parameter] : [],
        pose: null,
      });
    }
    if (droppedNames.length > 0) {
      options.push({
        id: 'finding-dropped',
        severity: 'Advisory',
        text: `Dropped from the link: ${droppedNames.join(', ')}`,
        parameters: [],
        pose: null,
      });
    }
    const report = preflight.currentReport();
    if (report && report.status === 'complete') {
      for (const finding of report.findings) {
        options.push({
          id: `finding-${finding.id.replace(/[^a-zA-Z0-9]+/g, '-')}`,
          severity: finding.severity,
          text: finding.message,
          parameters: finding.parameters,
          pose: finding.pose,
        });
      }
    }
    findings.setOptions(options, preflight.isStale());
  }

  function paintPins(): void {
    const report = preflight.currentReport();
    const stored = tapeData?.preflight ?? null;
    const source =
      report && report.status === 'complete' && sameValues(report.values, sparseValues(manifest, values))
        ? report
        : stored;
    if (!source) {
      viewport.setPins([]);
      return;
    }
    const playhead = tape.current();
    viewport.setPins(
      source.findings
        .filter((finding) => finding.severity !== 'Pass' && finding.operation <= playhead)
        .map((finding) => ({
          point: finding.pose.target,
          kind: 'finding-pin',
          label: finding.message,
        })),
    );
  }

  // Build tape -------------------------------------------------------------
  let tapeData: TapeResponse | null = null;
  const solidCache = new Map<string, Solid>();

  async function storedSolid(digest: string): Promise<Solid> {
    const cached = solidCache.get(digest);
    if (cached) return cached;
    const result = await send<Solid>(`/api/solids/${digest}`);
    solidCache.set(digest, result.data);
    return result.data;
  }

  function facesOf(solid: Solid): number {
    let faces = 0;
    for (const op of solid.ops) {
      if (op.op === 'box') faces += 6;
      else if (op.op === 'cylinder') faces += 3;
      else if (op.op === 'boss') faces += 2;
      else if (op.op === 'hole') faces += 1;
      else faces += 4;
    }
    return faces;
  }

  function lastGoodLine(): string {
    if (!lastGoodAt) return 'Last good solid: none yet';
    const hours = String(lastGoodAt.getHours()).padStart(2, '0');
    const minutes = String(lastGoodAt.getMinutes()).padStart(2, '0');
    return `Last good solid: ${hours}:${minutes}`;
  }

  /** The tape belongs to the revision the page loaded, compared on resolved values. */
  function updateTapeDisabled(): void {
    const loaded = { ...defaults, ...(loadedRevision.values as Values) };
    const same = manifest.every(
      (entry) => entry.derived || valueOf(entry, values) === loaded[entry.name],
    );
    tape.setDisabled(
      !same,
      same ? '' : `The tape shows ${loadedRevision.label}; save to record a tape for these values.`,
    );
  }

  /** The viewport replays each step from the stored solid, never a recomputed one. */
  async function showTapeOperation(index: number): Promise<void> {
    if (!tapeData) return;
    const operation = tapeData.operations[index];
    if (!operation) return;
    try {
      const solid = await storedSolid(operation.digest);
      const previous = index > 0 ? await storedSolid(tapeData.operations[index - 1].digest) : null;
      const difference = stepDifference(previous, solid);
      const height = bodyHeight(solid);
      const extraLayers = [
        ...difference.added.map((op) => viewport.accentLayer(opMesh(op, height))),
        ...difference.removed.map((op) => viewport.ghostLayer(opMesh(op, height))),
      ];
      tapeDriving = true;
      viewport.setOutage(false, '');
      viewport.setSolid(solid, { crossfade: true, extraLayers });
      paintReadouts(
        {
          solid,
          digest: operation.digest,
          volume: operation.volume,
          bbox: operation.bbox,
          faces: facesOf(solid),
        },
        index,
      );
      viewport.paint();
      highlightLine(operation.line);
      paintPins();
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.code === 'storage_unavailable') {
        showStorageBanner();
        viewport.setOutage(true, lastGoodLine());
      }
    }
  }

  function returnToLive(): void {
    tapeDriving = false;
    viewport.setOutage(false, '');
    if (lastGood) {
      viewport.setSolid(lastGood.solid);
      paintReadouts(lastGood, null);
    }
    highlightLine(null);
  }

  async function loadTape(startAt: number | null): Promise<void> {
    const result = await send<TapeResponse>(`/api/revisions/${loadedRevision.id}/tape`);
    tapeData = result.data;
    const last = result.data.operations.length - 1;
    const start = startAt !== null && Number.isInteger(startAt) && startAt >= 0 && startAt <= last ? startAt : last;
    tape.setOperations(result.data.operations, start);
    updateTapeDisabled();
    tape.noteLine(result.data.preflight ? '' : `No pre-flight report for ${loadedRevision.label} yet.`);
    if (startAt !== null && start === startAt) await showTapeOperation(start);
    paintPins();
  }

  function openForkDialog(index: number): void {
    const bodyIndex = (tapeData?.operations ?? []).findIndex((operation) => operation.kind === 'body');
    const fork = el('button', { type: 'button', class: 'button-primary' }, ['Fork']);
    const cancel = el('button', { type: 'button' }, ['Cancel']);
    const dialog = new Dialog(
      `Fork from operation ${index}?`,
      [el('p', {}, [`The new revision keeps operations 0 to ${index} and drops the rest.`])],
      [fork, cancel],
    );
    if (bodyIndex === -1 || index < bodyIndex) fork.setAttribute('aria-disabled', 'true');
    markStorageDependent(fork);
    on(cancel, 'click', () => dialog.close());
    on(fork, 'click', () => {
      if (fork.getAttribute('aria-disabled') === 'true') {
        if (storageIsDown()) {
          dialog.message(
            'Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
            'alert',
          );
        }
        return;
      }
      void runFork(index, dialog, fork);
    });
  }

  const forkAction = new KeyedAction();

  async function runFork(index: number, dialog: Dialog, button: HTMLElement): Promise<void> {
    const body = { operation: index };
    button.setAttribute('aria-disabled', 'true');
    try {
      const result = await send<RevisionResponse>(`/api/revisions/${loadedRevision.id}/fork`, {
        method: 'POST',
        body,
        headers: { 'If-Match': `"${knownHead ?? ''}"`, 'Idempotency-Key': forkAction.keyFor(body) },
      });
      forkAction.settled();
      window.location.assign(`/parts/${slug}?revision=${result.data.id}&operation=${index}`);
    } catch (error) {
      button.removeAttribute('aria-disabled');
      if (error instanceof NoAnswerError) return;
      if (error instanceof ApiCallError) {
        forkAction.settled();
        if (error.failure.code === 'storage_unavailable') {
          dialog.message(error.failure.message, 'alert');
          return;
        }
        if (error.failure.code === 'head_moved') {
          dialog.close();
          showConflict(error.failure.body);
          return;
        }
        dialog.message(error.failure.message, 'alert');
      }
    }
  }

  // Revisions --------------------------------------------------------------
  function paintRevisions(): void {
    clear(revisionsList);
    const headLabel = revisions[0]?.label ?? loadedRevision.label;
    for (const revision of revisions) {
      const row = el('li', { role: 'listitem', class: 'revision-row' });
      if (revision.id === loadedRevision.id) row.setAttribute('aria-current', 'true');
      row.append(
        el('a', { href: `/parts/${slug}?revision=${revision.id}` }, [revision.label]),
        el('span', { class: 'muted' }, [
          ` · ${revision.message} · ${part.owner.displayName}`,
        ]),
      );
      if (revision.id !== revisions[0]?.id) {
        row.append(
          el(
            'a',
            {
              href: `/parts/${slug}/compare?base=${revision.id}&head=${revisions[0].id}&view=overlay`,
              class: 'chip',
            },
            [`Compare ${revision.label} with ${headLabel}`],
          ),
        );
        if (owner) {
          const restore = el('button', { type: 'button', class: 'chip' }, [`Restore ${revision.label}`]);
          markStorageDependent(restore);
          on(restore, 'click', () => openRestoreDialog(revision));
          row.append(restore);
        }
      }
      revisionsList.append(row);
    }
  }

  const restoreAction = new KeyedAction();

  function openRestoreDialog(revision: RevisionResponse): void {
    const confirm = el('button', { type: 'button', class: 'button-primary' }, ['Restore']);
    const cancel = el('button', { type: 'button' }, ['Cancel']);
    const dialog = new Dialog(
      `Restore ${revision.label} as a new revision?`,
      [el('p', {}, ['The current head stays in the history.'])],
      [confirm, cancel],
    );
    markStorageDependent(confirm);
    on(cancel, 'click', () => dialog.close());
    on(confirm, 'click', async () => {
      if (confirm.getAttribute('aria-disabled') === 'true') {
        dialog.message(
          'Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
          'alert',
        );
        return;
      }
      try {
        const result = await send<RevisionResponse>(
          `/api/parts/${slug}/revisions/${revision.id}/restore`,
          {
            method: 'POST',
            body: {},
            headers: {
              'If-Match': `"${knownHead ?? ''}"`,
              'Idempotency-Key': restoreAction.keyFor({ revision: revision.id }),
            },
          },
        );
        restoreAction.settled();
        dialog.close();
        knownHead = result.data.id;
        await refreshRevisions();
        activityStatus.textContent = `Saved ${result.data.label}.`;
      } catch (error) {
        if (error instanceof NoAnswerError) return;
        restoreAction.settled();
        if (error instanceof ApiCallError) {
          if (error.failure.code === 'head_moved') {
            dialog.close();
            showConflict(error.failure.body);
            return;
          }
          dialog.message(error.failure.message, 'alert');
        }
      }
    });
  }

  async function refreshRevisions(): Promise<void> {
    const result = await send<{ revisions: RevisionResponse[] }>(`/api/parts/${slug}/revisions`);
    revisions = result.data.revisions;
    paintRevisions();
  }

  // Review -----------------------------------------------------------------
  const roomAction = new KeyedAction();

  async function paintReview(): Promise<void> {
    clear(reviewBody);
    if (owner) {
      const start = el('button', { type: 'button', class: 'chip' }, ['Start review']);
      on(start, 'click', () => openReviewDialog());
      reviewBody.append(start);
    }
    if (!viewer) return;
    try {
      const result = await send<{
        rooms: { id: string; title: string; partSlug: string }[];
      }>('/api/dashboard');
      for (const room of result.data.rooms.filter((candidate) => candidate.partSlug === slug)) {
        reviewBody.append(el('a', { href: `/rooms/${room.id}`, class: 'chip' }, [room.title]));
      }
    } catch {
      /* rooms are listed for signed-in people only */
    }
  }

  function openReviewDialog(): void {
    const title = labelledField('Room title');
    const emails = labelledField('Reviewer emails');
    const create = el('button', { type: 'button', class: 'button-primary' }, ['Create room']);
    const cancel = el('button', { type: 'button' }, ['Cancel']);
    const dialog = new Dialog(
      'Start a review',
      [title.row, emails.row, el('p', { class: 'muted' }, ['Separate addresses with commas.'])],
      [create, cancel],
    );
    on(cancel, 'click', () => dialog.close());
    on(create, 'click', async () => {
      const body = {
        title: title.input.value,
        reviewers: emails.input.value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      };
      try {
        const result = await send<{ id: string }>(`/api/parts/${slug}/rooms`, {
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': roomAction.keyFor(body) },
        });
        roomAction.settled();
        window.location.assign(`/rooms/${result.data.id}`);
      } catch (error) {
        if (error instanceof NoAnswerError) return;
        roomAction.settled();
        if (error instanceof ApiCallError) {
          fieldError(title.row, error.failure.errors?.title ?? null);
          fieldError(emails.row, error.failure.errors?.reviewers ?? null);
          if (!error.failure.errors) dialog.message(error.failure.message, 'alert');
        }
      }
    });
  }

  // Saving -----------------------------------------------------------------
  const saveAction = new KeyedAction();
  let pendingMessage = '';

  function openSignUpDialog(): void {
    const email = labelledField('Email');
    const name = labelledField('Display name');
    const password = labelledField('Password', { type: 'password' });
    const create = el('button', { type: 'button', class: 'button-primary' }, [
      'Create account and send link',
    ]);
    const existing = el('a', { href: '#' }, ['I already have an account']);
    const dialog = new Dialog(
      'Sign up to save',
      [email.row, name.row, password.row],
      [create, existing],
    );
    const next = `${window.location.pathname}?config=${configString(manifest, values)}&save=1`;
    on(existing, 'click', (event) => {
      event.preventDefault();
      dialog.close();
      window.location.assign(`/signin?next=${encodeURIComponent(next)}`);
    });
    on(create, 'click', async () => {
      try {
        await send('/api/auth/signup', {
          method: 'POST',
          body: {
            email: email.input.value,
            displayName: name.input.value,
            password: password.input.value,
            next,
          },
        });
        dialog.message(
          `Check your inbox: we sent a link to ${email.input.value}. It brings you back to this exact configuration.`,
        );
      } catch (error) {
        if (error instanceof ApiCallError) {
          fieldError(email.row, error.failure.errors?.email ?? null);
          fieldError(name.row, error.failure.errors?.displayName ?? null);
          fieldError(password.row, error.failure.errors?.password ?? null);
          if (!error.failure.errors) dialog.message(error.failure.message, 'alert');
        }
      }
    });
  }

  function openSaveDialog(): void {
    if (!viewer) {
      openSignUpDialog();
      return;
    }
    const message = labelledField('Message', {}, 'textarea');
    message.input.value = pendingMessage;
    const save = el('button', { type: 'button', class: 'button-primary' }, ['Save']);
    const cancel = el('button', { type: 'button' }, ['Cancel']);
    const content: (Node | string)[] = [message.row];
    if (!owner) {
      content.push(
        el('p', { class: 'muted' }, [
          `This part belongs to ${part.owner.displayName}. Saving makes your own copy: ${part.title} (my configuration).`,
        ]),
      );
    }
    const dialog = new Dialog('Save revision', content, [save, cancel]);
    markStorageDependent(save);
    on(cancel, 'click', () => dialog.close());
    on(save, 'click', () => {
      if (save.getAttribute('aria-disabled') === 'true') {
        dialog.message(
          'Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
          'alert',
        );
        return;
      }
      void runSave(dialog, save, message.input.value);
    });
  }

  async function runSave(dialog: Dialog, button: HTMLButtonElement, message: string): Promise<void> {
    const body = { values: sparseValues(manifest, values), message };
    const path = owner ? `/api/parts/${slug}/revisions` : `/api/parts/${slug}/copies`;
    const headers: Record<string, string> = { 'Idempotency-Key': saveAction.keyFor(body) };
    if (owner) headers['If-Match'] = `"${knownHead ?? ''}"`;
    const label = button.textContent ?? 'Save';
    button.textContent = 'Saving...';
    button.disabled = true;
    try {
      const result = await send<RevisionResponse | { slug: string; revision: RevisionResponse }>(path, {
        method: 'POST',
        body,
        headers,
      });
      saveAction.settled();
      clearDrafts(slug);
      pendingMessage = '';
      dialog.close();
      if (owner) {
        const revision = result.data as RevisionResponse;
        knownHead = revision.id;
        loadedRevision = revision;
        await refreshRevisions();
        await loadTape(null);
        activityStatus.textContent = `Saved ${revision.label}.`;
      } else {
        const copy = result.data as { slug: string; revision: RevisionResponse };
        sessionStorage.setItem(`tinework:saved:${copy.slug}`, copy.revision.label);
        window.location.assign(`/parts/${copy.slug}?config=${configString(manifest, values)}`);
      }
    } catch (error) {
      button.textContent = label;
      button.disabled = false;
      if (error instanceof NoAnswerError) return;
      saveAction.settled();
      if (!(error instanceof ApiCallError)) return;
      if (error.failure.code === 'head_moved') {
        pendingMessage = message;
        writeDraft(slug, knownHead ?? '', { values: sparseValues(manifest, values), message });
        dialog.close();
        showConflict(error.failure.body);
        return;
      }
      if (error.failure.code === 'storage_unavailable') {
        showStorageBanner();
        dialog.message(error.failure.message, 'alert');
        return;
      }
      dialog.message(error.failure.message, 'alert');
    }
  }

  on(saveButton, 'click', () => openSaveDialog());

  // Conflict ---------------------------------------------------------------
  function changeLines(before: Values, after: Values): string[] {
    const lines: string[] = [];
    for (const entry of manifest) {
      if (entry.derived) continue;
      const left = Object.prototype.hasOwnProperty.call(before, entry.name)
        ? before[entry.name]
        : entry.default;
      const right = Object.prototype.hasOwnProperty.call(after, entry.name)
        ? after[entry.name]
        : entry.default;
      if (left === right) continue;
      lines.push(parameterChangeLine(entry, left, right));
    }
    return lines;
  }

  function showConflict(failure: Record<string, unknown>): void {
    const head = failure.head as RevisionResponse;
    const message = String(failure.message ?? '');
    const knownValues =
      revisions.find((revision) => revision.id === knownHead)?.values ?? loadedRevision.values;
    const lines = changeLines(knownValues as Values, head.values as Values);
    const list = el('ul', { role: 'list', 'aria-label': `Changes in ${head.label}`, class: 'change-list' });
    if (lines.length === 0) list.append(el('li', {}, ['No parameter changes.']));
    for (const line of lines) list.append(el('li', {}, [line]));
    const open = el('button', { type: 'button' }, [`Open ${head.label}`]);
    const keep = el('button', { type: 'button' }, [`Keep my values on ${head.label}`]);
    const existing = find('[data-ui="conflict-alert"]');
    existing?.remove();
    const alert = pageAlert(message, [list, open, keep]);
    alert.setAttribute('data-ui', 'conflict-alert');
    on(open, 'click', () => {
      clearDrafts(slug);
      pendingMessage = '';
      window.location.assign(`/parts/${slug}?revision=${head.id}`);
    });
    on(keep, 'click', () => {
      knownHead = head.id;
      writeDraft(slug, head.id, { values: sparseValues(manifest, values), message: pendingMessage });
      activityStatus.textContent = `Your values now build on ${head.label}.`;
      alert.remove();
    });
  }

  // Likes, downloads -------------------------------------------------------
  function paintLikes(count: number, liked: boolean): void {
    likeCount.textContent = count === 1 ? '1 like' : `${count} likes`;
    likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
  }
  paintLikes(part.likes, part.liked);

  if (!viewer) {
    likeButton.setAttribute('aria-disabled', 'true');
    const tooltip = el('span', { role: 'tooltip', class: 'tooltip', hidden: true }, [
      'Sign in to like parts',
    ]);
    likeButton.after(tooltip);
    for (const event of ['pointerenter', 'focus']) {
      on(likeButton, event, () => {
        tooltip.hidden = false;
      });
    }
    for (const event of ['pointerleave', 'blur']) {
      on(likeButton, event, () => {
        tooltip.hidden = true;
      });
    }
  }

  on(likeButton, 'click', async () => {
    if (!viewer) return;
    const liked = likeButton.getAttribute('aria-pressed') === 'true';
    const result = await send<{ liked: boolean; likes: number }>(`/api/parts/${slug}/like`, {
      method: liked ? 'DELETE' : 'PUT',
    });
    paintLikes(result.data.likes, result.data.liked);
  });

  async function download(format: 'zip' | 'tar', button: HTMLElement): Promise<void> {
    if (button.getAttribute('aria-disabled') === 'true') {
      pageAlert(
        'Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
      );
      return;
    }
    try {
      const response = await fetch(`/api/revisions/${loadedRevision.id}/archive.${format}`);
      if (!response.ok) {
        showStorageBanner();
        pageAlert(
          'Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
        );
        return;
      }
      const blob = await response.blob();
      const link = el('a', {
        href: URL.createObjectURL(blob),
        download: `${slug}-${loadedRevision.label}.${format}`,
      });
      document.body.append(link);
      link.click();
      link.remove();
      removeAlerts();
    } catch {
      pageAlert(
        'Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes.',
      );
    }
  }

  on(zipButton, 'click', () => void download('zip', zipButton));
  on(tarButton, 'click', () => void download('tar', tarButton));

  // Live updates -----------------------------------------------------------
  openLiveStream(slug, {
    revision: (data) => {
      const revision = data.revision as RevisionResponse;
      const author = String(data.authorDisplayName ?? '');
      if (!revisions.some((candidate) => candidate.id === revision.id)) {
        revisions = [revision, ...revisions];
        paintRevisions();
      }
      activityStatus.textContent = `New revision ${revision.label} by ${author}.`;
    },
    like: (data) => {
      if (data.partSlug !== slug) return;
      paintLikes(Number(data.likes), likeButton.getAttribute('aria-pressed') === 'true');
    },
  });

  // Start ------------------------------------------------------------------
  paintModified();
  paintFindings();
  await refreshRevisions();
  await paintReview();
  void checkStorageHealth();

  const savedLabel = sessionStorage.getItem(`tinework:saved:${slug}`);
  if (savedLabel) {
    sessionStorage.removeItem(`tinework:saved:${slug}`);
    activityStatus.textContent = `Saved ${savedLabel}.`;
  }

  const draft = readDraft(slug);
  if (draft && draft.base !== knownHead) {
    setValues({ ...defaults, ...draft.draft.values });
    pendingMessage = draft.draft.message;
    controls.refresh();
    paintModified();
    const head = revisions.find((revision) => revision.id === knownHead);
    if (head) {
      showConflict({
        message: `This part changed since you opened it. ${head.label} is now the latest revision.`,
        head,
      });
    }
  }

  const operationParameter = url.searchParams.get('operation');
  const operationStart =
    operationParameter !== null && /^-?(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(operationParameter)
      ? Number(operationParameter)
      : null;

  if (configParameter === null) writeAddress();
  else if (droppedNames.length > 0) writeAddress();

  await runEvaluation();
  await loadTape(operationStart);
  if (operationParameter !== null) writeAddress();

  if (url.searchParams.get('save') === '1' && viewer) {
    openSaveDialog();
    writeAddress();
  }

}
